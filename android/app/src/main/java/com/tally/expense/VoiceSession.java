package com.tally.expense;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * One listening session's rules, kept apart from Android's SpeechRecognizer so
 * they run as plain Java in VoiceSessionTest. VoicePlugin feeds in the
 * recognizer's callbacks and the person's stop/cancel, and carries out what
 * this asks for through {@link Actions}.
 *
 * What it guarantees, each one a failure the old plugin had:
 * - the answer is the recognizer's final transcript, with its alternates, not
 *   the last live caption (a caption is only the fallback when no final one comes);
 * - every way a session can end reaches JS exactly once, as a result or a
 *   reason, so the screen never says "Listening..." to a recognizer that has quit;
 * - a recognizer that is busy, fails to start or never answers gets one fresh start;
 * - letting go finishes the session; it never waits on the recognizer's own timeout.
 */
final class VoiceSession {
  // android.speech.SpeechRecognizer's error codes, repeated so this stays plain Java
  static final int ERROR_NETWORK_TIMEOUT = 1;
  static final int ERROR_NETWORK = 2;
  static final int ERROR_AUDIO = 3;
  static final int ERROR_SERVER = 4;
  static final int ERROR_CLIENT = 5;
  static final int ERROR_SPEECH_TIMEOUT = 6;
  static final int ERROR_NO_MATCH = 7;
  static final int ERROR_RECOGNIZER_BUSY = 8;
  static final int ERROR_INSUFFICIENT_PERMISSIONS = 9;
  static final int ERROR_TOO_MANY_REQUESTS = 10;
  static final int ERROR_SERVER_DISCONNECTED = 11;
  static final int ERROR_LANGUAGE_NOT_SUPPORTED = 12;
  static final int ERROR_LANGUAGE_UNAVAILABLE = 13;

  static final int TIMER_READY = 1;
  static final int TIMER_RESULT = 2;
  static final int TIMER_LIMIT = 3;

  /** The microphone has this long to open before the recognizer gets a fresh start. */
  static final long READY_TIMEOUT_MS = 5000;
  /** After the end of speech, the final transcript has this long to arrive. */
  static final long RESULT_TIMEOUT_MS = 3500;
  /** No sentence about an expense runs longer; past this the session finishes itself. */
  static final long LIMIT_MS = 30000;
  /** A fresh start waits this long, so the recognizer service can let go of the old one. */
  static final long RETRY_DELAY_MS = 300;
  /** Microphone level updates, at most this often. */
  static final long LEVEL_EVERY_MS = 50;

  interface Actions {
    /** starting · ready (the microphone is open) · speech · processing */
    void state(String state);

    /** 0..1, how loud the person is right now */
    void level(float level);

    /** the live caption */
    void partial(String text);

    void result(List<String> matches, float[] confidences);

    /** nothing · denied · network · busy · audio · unavailable · error */
    void failed(String reason, int code);

    /** Tear the recognizer down and start a fresh one after a delay, optionally in the phone's own language. */
    void restart(long delayMs, boolean defaultLanguage);

    /** Finish listening: what was said so far is recognized. */
    void stopRecognizer();

    /** Stop without an answer. */
    void cancelRecognizer();

    void schedule(int timer, long delayMs);

    void unschedule(int timer);

    /** The session is over: release the recognizer. Called exactly once. */
    void finished();
  }

  private enum Phase { STARTING, READY, SPEAKING, ENDING, DONE }

  private final Actions out;
  private Phase phase = Phase.STARTING;
  private String heard = null;
  private String lastPartial = null;
  private long lastLevelAt = -LEVEL_EVERY_MS;
  private boolean stopRequested = false;
  private boolean restarted = false;
  private boolean languageFallback = false;

  VoiceSession(Actions out) {
    this.out = out;
  }

  void begin() {
    out.state("starting");
    out.schedule(TIMER_READY, READY_TIMEOUT_MS);
    out.schedule(TIMER_LIMIT, LIMIT_MS);
  }

  boolean isDone() {
    return phase == Phase.DONE;
  }

  void onReady() {
    if (phase != Phase.STARTING) return;
    phase = Phase.READY;
    out.unschedule(TIMER_READY);
    out.state("ready");
  }

  void onBeginningOfSpeech() {
    if (phase != Phase.STARTING && phase != Phase.READY) return;
    // some recognition services never call onReadyForSpeech
    out.unschedule(TIMER_READY);
    phase = Phase.SPEAKING;
    out.state("speech");
  }

  void onRms(float rmsDb, long nowMs) {
    if (phase == Phase.DONE || nowMs - lastLevelAt < LEVEL_EVERY_MS) return;
    lastLevelAt = nowMs;
    // the Google recognizer reports roughly -2 dB (silence) to 10 dB (speaking up)
    out.level(Math.max(0f, Math.min(1f, (rmsDb + 2f) / 12f)));
  }

  void onPartial(List<String> matches) {
    if (phase == Phase.DONE) return;
    String top = firstText(matches);
    if (top == null) return;
    heard = top;
    if (phase == Phase.STARTING || phase == Phase.READY) onBeginningOfSpeech();
    if (!top.equals(lastPartial)) {
      lastPartial = top;
      out.partial(top);
    }
  }

  void onEndOfSpeech() {
    if (phase == Phase.DONE || phase == Phase.ENDING) return;
    phase = Phase.ENDING;
    out.unschedule(TIMER_READY);
    out.state("processing");
    out.schedule(TIMER_RESULT, RESULT_TIMEOUT_MS);
  }

  /** The person let go, or tapped Done. */
  void stop() {
    if (phase == Phase.DONE) return;
    stopRequested = true;
    if (phase == Phase.ENDING) return;
    phase = Phase.ENDING;
    out.unschedule(TIMER_READY);
    out.state("processing");
    out.schedule(TIMER_RESULT, RESULT_TIMEOUT_MS);
    // last: a recognizer that fails right here ends the session from inside this call
    out.stopRecognizer();
  }

  /** The person cancelled: no answer, nothing more sent. */
  void cancel() {
    if (phase == Phase.DONE) return;
    phase = Phase.DONE;
    unscheduleAll();
    out.cancelRecognizer();
    out.finished();
  }

  void onResults(List<String> matches, float[] confidences) {
    if (phase == Phase.DONE) return;
    List<String> texts = new ArrayList<>();
    List<Float> scores = new ArrayList<>();
    if (matches != null) {
      for (int i = 0; i < matches.size(); i++) {
        String m = matches.get(i) == null ? "" : matches.get(i).trim();
        if (m.isEmpty() || texts.contains(m)) continue;
        texts.add(m);
        scores.add(confidences != null && i < confidences.length ? confidences[i] : -1f);
      }
    }
    if (texts.isEmpty()) {
      endWithHeardOr("nothing", ERROR_NO_MATCH);
      return;
    }
    float[] conf = new float[scores.size()];
    for (int i = 0; i < conf.length; i++) conf[i] = scores.get(i);
    complete(texts, conf);
  }

  void onError(int code) {
    if (phase == Phase.DONE) return;
    switch (code) {
      case ERROR_NO_MATCH:
      case ERROR_SPEECH_TIMEOUT:
        endWithHeardOr("nothing", code);
        return;
      case ERROR_INSUFFICIENT_PERMISSIONS:
        fail("denied", code);
        return;
      case ERROR_AUDIO:
        endWithHeardOr("audio", code);
        return;
      case ERROR_RECOGNIZER_BUSY:
      case ERROR_CLIENT:
      case ERROR_SERVER_DISCONNECTED:
        if (heard != null) {
          complete(Collections.singletonList(heard), new float[] { -1f });
        } else if (stopRequested) {
          fail("nothing", code);
        } else if (!restarted && (phase == Phase.STARTING || phase == Phase.READY)) {
          restart(false);
        } else {
          fail(code == ERROR_RECOGNIZER_BUSY ? "busy" : "error", code);
        }
        return;
      case ERROR_TOO_MANY_REQUESTS:
        endWithHeardOr("busy", code);
        return;
      case ERROR_NETWORK:
      case ERROR_NETWORK_TIMEOUT:
      case ERROR_SERVER:
        endWithHeardOr("network", code);
        return;
      case ERROR_LANGUAGE_NOT_SUPPORTED:
      case ERROR_LANGUAGE_UNAVAILABLE:
        if (!languageFallback && heard == null && !stopRequested) {
          languageFallback = true;
          restart(true);
        } else {
          endWithHeardOr("unavailable", code);
        }
        return;
      default:
        endWithHeardOr("error", code);
    }
  }

  void onTimer(int timer) {
    if (phase == Phase.DONE) return;
    if (timer == TIMER_READY) {
      // the recognition service never answered
      if (phase != Phase.STARTING) return;
      if (!restarted) {
        restart(false);
      } else {
        out.cancelRecognizer();
        fail("error", 0);
      }
    } else if (timer == TIMER_RESULT) {
      out.cancelRecognizer();
      endWithHeardOr("nothing", 0);
    } else if (timer == TIMER_LIMIT) {
      stop();
    }
  }

  private void restart(boolean defaultLanguage) {
    restarted = restarted || !defaultLanguage;
    phase = Phase.STARTING;
    out.unschedule(TIMER_READY);
    out.restart(RETRY_DELAY_MS, defaultLanguage);
    out.schedule(TIMER_READY, READY_TIMEOUT_MS + RETRY_DELAY_MS);
  }

  /** A caption already on screen is a better answer than an error. */
  private void endWithHeardOr(String reason, int code) {
    if (heard != null) complete(Collections.singletonList(heard), new float[] { -1f });
    else fail(reason, code);
  }

  private void complete(List<String> matches, float[] confidences) {
    phase = Phase.DONE;
    unscheduleAll();
    out.result(matches, confidences);
    out.finished();
  }

  private void fail(String reason, int code) {
    phase = Phase.DONE;
    unscheduleAll();
    out.failed(reason, code);
    out.finished();
  }

  private void unscheduleAll() {
    out.unschedule(TIMER_READY);
    out.unschedule(TIMER_RESULT);
    out.unschedule(TIMER_LIMIT);
  }

  private static String firstText(List<String> matches) {
    if (matches == null) return null;
    for (String m : matches) {
      if (m != null && !m.trim().isEmpty()) return m.trim();
    }
    return null;
  }
}
