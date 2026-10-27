package com.tally.expense;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;

/**
 * The intents that open Taily from outside it (the home-screen widget, the
 * Quick Settings tile, the launcher shortcut), and the small settings the app
 * leaves for them, since none of them can read Taily's own data.
 */
final class VoiceLaunch {
  private VoiceLaunch() {}

  static final String PREFS = "taily.voice";
  /** Set on an intent once it has been acted on, so it never starts listening twice. */
  static final String HANDLED = "taily.voice.handled";

  static Intent voiceIntent(Context context, String source) {
    return new Intent(Intent.ACTION_VIEW, Uri.parse("taily://voice?from=" + source))
        .setClass(context, MainActivity.class)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
  }

  static Intent addIntent(Context context, String source) {
    return new Intent(Intent.ACTION_VIEW, Uri.parse("taily://add?from=" + source))
        .setClass(context, MainActivity.class)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
  }

  static PendingIntent pending(Context context, int requestCode, Intent intent) {
    return PendingIntent.getActivity(
        context, requestCode, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
  }

  /**
   * Where an intent asking Taily to listen came from ("widget", "tile",
   * "shortcut"), or null for any other intent, one already acted on, or one
   * replayed from the recent-apps list.
   */
  static String voiceSource(Intent intent) {
    if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())) return null;
    if (intent.getBooleanExtra(HANDLED, false)) return null;
    if ((intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return null;
    Uri data = intent.getData();
    if (data == null || !"taily".equals(data.getScheme()) || !"voice".equals(data.getHost())) return null;
    String from = data.getQueryParameter("from");
    return from == null || from.isEmpty() ? "shortcut" : from;
  }

  static SharedPreferences prefs(Context context) {
    return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
  }
}
