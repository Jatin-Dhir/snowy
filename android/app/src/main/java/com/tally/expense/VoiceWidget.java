package com.tally.expense;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import android.util.ArrayMap;
import android.util.SizeF;
import android.widget.RemoteViews;
import java.util.Map;

/**
 * The home-screen widget: a capsule like the app's dock. The mic starts
 * listening the moment it's tapped (VoicePlugin begins before the app has
 * even drawn); the + opens the add sheet. One cell wide it's the mic alone,
 * two cells the mic and the +, three or more spells it out.
 */
public class VoiceWidget extends AppWidgetProvider {

  @Override
  public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
    for (int id : ids) manager.updateAppWidget(id, views(context, manager.getAppWidgetOptions(id)));
  }

  @Override
  public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
    manager.updateAppWidget(id, views(context, options));
  }

  /** After the app's accent changes. */
  static void refreshAll(Context context) {
    AppWidgetManager manager = AppWidgetManager.getInstance(context);
    int[] ids = manager.getAppWidgetIds(new ComponentName(context, VoiceWidget.class));
    for (int id : ids) manager.updateAppWidget(id, views(context, manager.getAppWidgetOptions(id)));
  }

  static RemoteViews views(Context context, Bundle options) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      // the launcher picks the largest of these that fits, and re-picks as the widget is resized
      Map<SizeF, RemoteViews> sizes = new ArrayMap<>();
      sizes.put(new SizeF(40f, 40f), layout(context, R.layout.widget_voice_mic));
      sizes.put(new SizeF(100f, 40f), layout(context, R.layout.widget_voice_compact));
      sizes.put(new SizeF(170f, 40f), layout(context, R.layout.widget_voice));
      return new RemoteViews(sizes);
    }
    int width = options == null ? 0 : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
    int res = width == 0 || width >= 170
        ? R.layout.widget_voice
        : width >= 100 ? R.layout.widget_voice_compact : R.layout.widget_voice_mic;
    return layout(context, res);
  }

  private static RemoteViews layout(Context context, int res) {
    RemoteViews views = new RemoteViews(context.getPackageName(), res);
    views.setOnClickPendingIntent(R.id.widget_voice, VoiceLaunch.pending(context, 1, VoiceLaunch.voiceIntent(context, "widget")));
    if (res != R.layout.widget_voice_mic) {
      views.setOnClickPendingIntent(R.id.widget_add, VoiceLaunch.pending(context, 2, VoiceLaunch.addIntent(context, "widget")));
    }
    tint(context, views);
    return views;
  }

  /** The person's accent from the app; until the app has sent one, the resources' default sky. */
  private static void tint(Context context, RemoteViews views) {
    SharedPreferences prefs = VoiceLaunch.prefs(context);
    if (!prefs.contains("accent")) return;
    int accent = prefs.getInt("accent", 0);
    int onAccent = prefs.getInt("onAccent", 0);
    int accentNight = prefs.getInt("accentNight", accent);
    int onAccentNight = prefs.getInt("onAccentNight", onAccent);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      // follows the system's dark theme by itself
      views.setColorInt(R.id.widget_mic_bg, "setColorFilter", accent, accentNight);
      views.setColorInt(R.id.widget_mic_glyph, "setColorFilter", onAccent, onAccentNight);
    } else {
      boolean night = (context.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
          == Configuration.UI_MODE_NIGHT_YES;
      views.setInt(R.id.widget_mic_bg, "setColorFilter", night ? accentNight : accent);
      views.setInt(R.id.widget_mic_glyph, "setColorFilter", night ? onAccentNight : onAccent);
    }
  }
}
