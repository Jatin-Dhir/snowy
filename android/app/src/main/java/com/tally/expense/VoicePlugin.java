package com.tally.expense;

import android.Manifest;
import android.app.StatusBarManager;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.drawable.Icon;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Taily's own speech recognition, on the phone's recognizer (Google's, on most
 * phones). Replaced @capacitor-community/speech-recognition, which resolved on
 * the end of speech with the last live caption (never the final transcript),
 * swallowed every error once listening began, and gave no signal for when the
 * microphone was actually open. The rules live in VoiceSession; this is the
 * Android side of it.
 *
 * Events, all on "voice": {session, seq, type: state | level | partial | result | failed, ...}.
 * A launch from the widget, the tile or the shortcut starts listening here, before the
 * web app has loaded; the web app picks it up with takeLaunch().
 */
@CapacitorPlugin(
  name = "Voice",
  permissions = { @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }) }
)
public class VoicePlugin extends Plugin {

  /** Set by MainActivity when Android recreates the activity: its old intent must not start listening again. */
  static boolean restoring = false;

  private static final String EVENT = "voice";
  private static final String LAUNCH_EVENT = "voiceLaunch";
  private static final String DEFAULT_LANGUAGE = "en-IN";

  private final Handler main = new Handler(Looper.getMainLooper());
  private final Map<Integer, Runnable> timers = new HashMap<>();

  private SpeechRecognizer recognizer;
  /** Counts recognizer instances, so a late callback from a torn-down one is ignored. */
  private int generation = 0;
  private VoiceSession session;
  private int sessionId = 0;
  private int seq = 0;
  private boolean hold = false;
  private String language = DEFAULT_LANGUAGE;
  /** The current session as the web app would rebuild it: state, caption, result or failure. */
  private JSObject snapshot;
  /** A launch from outside the app that the web app hasn't picked up yet. */
  private JSObject pendingLaunch;

  @Override
  public void load() {
    Intent intent = getActivity().getIntent();
    if (restoring) {
      if (intent != null) intent.putExtra(VoiceLaunch.HANDLED, true);
      return;
    }
    handleLaunch(intent, false);
  }

  @Override
  protected void handleOnNewIntent(Intent intent) {
    super.handleOnNewIntent(intent);
    handleLaunch(intent, true);
  }

  @Override
  protected void handleOnPause() {
    super.handleOnPause();
    // Android takes the microphone from an app that leaves the screen; end the session cleanly instead
    if (session != null && !session.isDone()) {
      int id = sessionId;
      session.cancel();
      JSObject data = new JSObject().put("reason", "interrupted").put("code", 0);
      if (snapshot != null) snapshot.put("error", "interrupted");
      emit(id, "failed", data);
    }
  }

  @Override
  protected void handleOnDestroy() {
    super.handleOnDestroy();
    clearTimers();
    if (session != null && !session.isDone()) session.cancel();
    releaseRecognizer();
  }

  /* ------------------------------------------------------------------ methods */

  @PluginMethod
  public void available(PluginCall call) {
    call.resolve(new JSObject().put("available", SpeechRecognizer.isRecognitionAvailable(getContext())));
  }

  @PluginMethod
  public void start(PluginCall call) {
    if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
      call.reject("Speech recognition isn't available on this phone", "unavailable");
      return;
    }
    if (getPermissionState("microphone") != PermissionState.GRANTED) {
      call.reject("Taily needs the microphone", "denied");
      return;
    }
    boolean holdToTalk = Boolean.TRUE.equals(call.getBoolean("hold", false));
    String lang = call.getString("language", DEFAULT_LANGUAGE);
    main.post(() -> {
      startSession(holdToTalk, lang, "app", false);
      call.resolve(new JSObject().put("session", sessionId));
    });
  }

  @PluginMethod
  public void stop(PluginCall call) {
    int id = call.getInt("session", -1);
    main.post(() -> {
      if (id == sessionId && session != null) session.stop();
      call.resolve();
    });
  }

  @PluginMethod
  public void cancel(PluginCall call) {
    int id = call.getInt("session", -1);
    main.post(() -> {
      if (id == sessionId && session != null) session.cancel();
      call.resolve();
    });
  }

  /** The launch from the widget, tile or shortcut that opened the app, once; with its session if one started. */
  @PluginMethod
  public void takeLaunch(PluginCall call) {
    main.post(() -> {
      JSObject res = new JSObject();
      if (pendingLaunch == null) {
        res.put("launched", false);
      } else {
        res.put("launched", true).put("source", pendingLaunch.getString("source"));
        Integer launched = pendingLaunch.getInteger("session");
        if (launched != null && snapshot != null && launched.equals(snapshot.getInteger("session"))) {
          res.put("snapshot", snapshot);
        }
        pendingLaunch = null;
      }
      call.resolve(res);
    });
  }

  /**
   * What a launch from outside the app needs and can't read for itself: whether
   * to listen at once (not while app lock is on), haptics, the language, and
   * the accent the widget wears. Nothing from the ledger itself.
   */
  @PluginMethod
  public void setPrefs(PluginCall call) {
    SharedPreferences.Editor edit = VoiceLaunch.prefs(getContext()).edit();
    Boolean instant = call.getBoolean("instant");
    if (instant != null) edit.putBoolean("instant", instant);
    Boolean haptics = call.getBoolean("haptics");
    if (haptics != null) edit.putBoolean("haptics", haptics);
    String lang = call.getString("language");
    if (lang != null) edit.putString("language", lang);
    JSObject look = call.getObject("appearance");
    boolean restyle = false;
    if (look != null) {
      for (String key : new String[] { "accent", "onAccent", "accentNight", "onAccentNight" }) {
        Integer color = parseColor(look.getString(key));
        if (color != null) {
          edit.putInt(key, color);
          restyle = true;
        }
      }
    }
    edit.apply();
    if (restyle) VoiceWidget.refreshAll(getContext());
    call.resolve();
  }

  @PluginMethod
  public void openSettings(PluginCall call) {
    Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", getContext().getPackageName(), null))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    getActivity().startActivity(intent);
    call.resolve();
  }

  /** Which of "add the widget" and "add the tile" this phone can offer from inside the app. */
  @PluginMethod
  public void shortcuts(PluginCall call) {
    boolean widget = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
        && AppWidgetManager.getInstance(getContext()).isRequestPinAppWidgetSupported();
    boolean tile = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU;
    call.resolve(new JSObject().put("widget", widget).put("tile", tile));
  }

  @PluginMethod
  public void pinWidget(PluginCall call) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      call.resolve(new JSObject().put("shown", false));
      return;
    }
    AppWidgetManager manager = AppWidgetManager.getInstance(getContext());
    boolean shown = manager.isRequestPinAppWidgetSupported()
        && manager.requestPinAppWidget(new ComponentName(getContext(), VoiceWidget.class), null, null);
    call.resolve(new JSObject().put("shown", shown));
  }

  @PluginMethod
  public void addTile(PluginCall call) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
      call.resolve(new JSObject().put("result", "unsupported"));
      return;
    }
    Context context = getContext();
    StatusBarManager bar = context.getSystemService(StatusBarManager.class);
    if (bar == null) {
      call.resolve(new JSObject().put("result", "unsupported"));
      return;
    }
    bar.requestAddTileService(
        new ComponentName(context, VoiceTileService.class),
        context.getString(R.string.tile_voice_label),
        Icon.createWithResource(context, R.drawable.ic_tile_voice),
        context.getMainExecutor(),
        (result) -> {
          String said = result == StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ADDED
              ? "added"
              : result == StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ALREADY_ADDED
                  ? "already"
                  : result == StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_NOT_ADDED ? "dismissed" : "error";
          call.resolve(new JSObject().put("result", said));
        });
  }

  /* ------------------------------------------------------------------ sessions */

  private void handleLaunch(Intent intent, boolean live) {
    String source = VoiceLaunch.voiceSource(intent);
    if (source == null) return;
    intent.putExtra(VoiceLaunch.HANDLED, true);
    pendingLaunch = new JSObject().put("source", source);
    SharedPreferences prefs = VoiceLaunch.prefs(getContext());
    // listening starts now, while the web app is still loading, so nothing said is lost
    boolean instant = prefs.getBoolean("instant", true);
    if (
      instant &&
      SpeechRecognizer.isRecognitionAvailable(getContext()) &&
      getPermissionState("microphone") == PermissionState.GRANTED
    ) {
      startSession(false, prefs.getString("language", DEFAULT_LANGUAGE), source, prefs.getBoolean("haptics", true));
      pendingLaunch.put("session", sessionId);
    }
    if (live) notifyListeners(LAUNCH_EVENT, new JSObject().put("source", source));
  }

  /** Main thread only. */
  private void startSession(boolean holdToTalk, String lang, String source, boolean tickWhenReady) {
    if (session != null && !session.isDone()) session.cancel();
    clearTimers();
    releaseRecognizer();
    sessionId++;
    hold = holdToTalk;
    language = lang == null || lang.isEmpty() ? DEFAULT_LANGUAGE : lang;
    snapshot = new JSObject().put("session", sessionId).put("source", source).put("state", "starting");
    session = new VoiceSession(new Bridge(sessionId, tickWhenReady));
    session.begin();
    listen(sessionId, listenIntent(true, false));
  }

  /**
   * The request to the recognizer. A fresh start after a failure sends the
   * plainest request there is (no dictation mode), in case the recognizer on
   * this phone didn't like it.
   */
  private Intent listenIntent(boolean full, boolean defaultLanguage) {
    String lang = defaultLanguage ? Locale.getDefault().toLanguageTag() : language;
    Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
    intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
    intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
    intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, lang);
    intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5);
    intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
    intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getContext().getPackageName());
    // no connection: use the on-device model when the phone has one, rather than failing at the end
    if (!online()) intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
    // holding the button: keep listening through a pause until it's let go
    if (full && hold) intent.putExtra("android.speech.extra.DICTATION_MODE", true);
    // hands-free: a breath before the amount ("Jio recharge... 299") mustn't end it. A recognizer that doesn't
    // take these ignores them; the JS side's own pause (SILENCE_MS in VoiceOverlay) is 2200 ms
    if (full && !hold) {
      intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 2000L);
      intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 1500L);
    }
    return intent;
  }

  /** Main thread only: a new recognizer for this session, listening. */
  private void listen(int id, Intent intent) {
    releaseRecognizer();
    int gen = ++generation;
    try {
      recognizer = SpeechRecognizer.createSpeechRecognizer(getActivity());
      recognizer.setRecognitionListener(new Listener(id, gen));
      recognizer.startListening(intent);
    } catch (Exception e) {
      if (id == sessionId && session != null) session.onError(VoiceSession.ERROR_CLIENT);
    }
  }

  /** Main thread only. */
  private void releaseRecognizer() {
    SpeechRecognizer old = recognizer;
    recognizer = null;
    if (old == null) return;
    generation++;
    try {
      old.cancel();
    } catch (Exception ignored) {
      // already gone
    }
    // after the callback that may be running right now has returned
    main.post(() -> {
      try {
        old.destroy();
      } catch (Exception ignored) {
        // already gone
      }
    });
  }

  private void clearTimers() {
    for (Runnable r : timers.values()) main.removeCallbacks(r);
    timers.clear();
  }

  private void emit(int id, String type, JSObject data) {
    seq++;
    data.put("session", id).put("seq", seq).put("type", type);
    if (snapshot != null && Integer.valueOf(id).equals(snapshot.getInteger("session"))) snapshot.put("seq", seq);
    notifyListeners(EVENT, data);
  }

  /** What VoiceSession asks for, done on Android for one session. */
  private final class Bridge implements VoiceSession.Actions {
    private final int id;
    private final boolean tickWhenReady;

    Bridge(int id, boolean tickWhenReady) {
      this.id = id;
      this.tickWhenReady = tickWhenReady;
    }

    private boolean current() {
      return id == sessionId;
    }

    @Override
    public void state(String state) {
      if (!current()) return;
      // launched from the widget, the screen may still be loading: the tick says "speak now"
      if (tickWhenReady && "ready".equals(state)) tick();
      snapshot.put("state", state);
      emit(id, "state", new JSObject().put("state", state));
    }

    @Override
    public void level(float level) {
      if (!current()) return;
      notifyListeners(EVENT, new JSObject().put("session", id).put("type", "level").put("level", (double) level));
    }

    @Override
    public void partial(String text) {
      if (!current()) return;
      snapshot.put("partial", text);
      emit(id, "partial", new JSObject().put("text", text));
    }

    @Override
    public void result(List<String> matches, float[] confidences) {
      if (!current()) return;
      JSArray texts = new JSArray();
      JSArray scores = new JSArray();
      for (int i = 0; i < matches.size(); i++) {
        texts.put(matches.get(i));
        try {
          scores.put((double) confidences[i]);
        } catch (Exception e) {
          scores.put(-1);
        }
      }
      JSObject data = new JSObject().put("matches", texts).put("confidences", scores);
      snapshot.put("result", data);
      emit(id, "result", data);
    }

    @Override
    public void failed(String reason, int code) {
      if (!current()) return;
      snapshot.put("error", reason);
      emit(id, "failed", new JSObject().put("reason", reason).put("code", code));
    }

    @Override
    public void restart(long delayMs, boolean defaultLanguage) {
      if (!current()) return;
      releaseRecognizer();
      Intent plain = listenIntent(false, defaultLanguage);
      main.postDelayed(() -> {
        if (current() && session != null && !session.isDone()) listen(id, plain);
      }, delayMs);
    }

    @Override
    public void stopRecognizer() {
      if (!current() || recognizer == null) return;
      try {
        recognizer.stopListening();
      } catch (Exception e) {
        session.onError(VoiceSession.ERROR_CLIENT);
      }
    }

    @Override
    public void cancelRecognizer() {
      if (!current() || recognizer == null) return;
      try {
        recognizer.cancel();
      } catch (Exception ignored) {
        // already gone
      }
    }

    @Override
    public void schedule(int timer, long delayMs) {
      unschedule(timer);
      Runnable fire = () -> {
        timers.remove(timer);
        if (current() && session != null) session.onTimer(timer);
      };
      timers.put(timer, fire);
      main.postDelayed(fire, delayMs);
    }

    @Override
    public void unschedule(int timer) {
      Runnable r = timers.remove(timer);
      if (r != null) main.removeCallbacks(r);
    }

    @Override
    public void finished() {
      if (current()) releaseRecognizer();
    }
  }

  /** Android's callbacks, on the main thread, for one recognizer instance. */
  private final class Listener implements RecognitionListener {
    private final int id;
    private final int gen;

    Listener(int id, int gen) {
      this.id = id;
      this.gen = gen;
    }

    private VoiceSession live() {
      return id == sessionId && gen == generation && session != null && !session.isDone() ? session : null;
    }

    @Override
    public void onReadyForSpeech(Bundle params) {
      VoiceSession s = live();
      if (s != null) s.onReady();
    }

    @Override
    public void onBeginningOfSpeech() {
      VoiceSession s = live();
      if (s != null) s.onBeginningOfSpeech();
    }

    @Override
    public void onRmsChanged(float rmsdB) {
      VoiceSession s = live();
      if (s != null) s.onRms(rmsdB, SystemClock.elapsedRealtime());
    }

    @Override
    public void onBufferReceived(byte[] buffer) {}

    @Override
    public void onEndOfSpeech() {
      VoiceSession s = live();
      if (s != null) s.onEndOfSpeech();
    }

    @Override
    public void onError(int error) {
      VoiceSession s = live();
      if (s != null) s.onError(error);
    }

    @Override
    public void onResults(Bundle results) {
      VoiceSession s = live();
      if (s == null) return;
      s.onResults(results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION), results.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES));
    }

    @Override
    public void onPartialResults(Bundle partialResults) {
      VoiceSession s = live();
      if (s != null) s.onPartial(partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION));
    }

    @Override
    public void onEvent(int eventType, Bundle params) {}
  }

  /* ------------------------------------------------------------------ helpers */

  private boolean online() {
    try {
      ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
      if (cm == null) return true;
      NetworkCapabilities caps = cm.getNetworkCapabilities(cm.getActiveNetwork());
      return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    } catch (Exception e) {
      return true;
    }
  }

  @SuppressWarnings("deprecation")
  private void tick() {
    if (!VoiceLaunch.prefs(getContext()).getBoolean("haptics", true)) return;
    Vibrator vibrator = (Vibrator) getContext().getSystemService(Context.VIBRATOR_SERVICE);
    if (vibrator == null || !vibrator.hasVibrator()) return;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      vibrator.vibrate(VibrationEffect.createOneShot(12, VibrationEffect.DEFAULT_AMPLITUDE));
    } else {
      vibrator.vibrate(12);
    }
  }

  private static Integer parseColor(String hex) {
    if (hex == null || !hex.matches("#[0-9a-fA-F]{6}")) return null;
    return 0xFF000000 | Integer.parseInt(hex.substring(1), 16);
  }
}
