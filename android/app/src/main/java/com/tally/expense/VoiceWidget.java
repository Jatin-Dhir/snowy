package com.tally.expense;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.content.res.Resources;
import android.graphics.Bitmap;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.os.Bundle;
import android.util.ArrayMap;
import android.util.SizeF;
import android.view.View;
import android.widget.RemoteViews;
import java.text.DateFormatSymbols;
import java.util.Calendar;
import java.util.Locale;
import java.util.Map;

/**
 * The home-screen widget: Home's today card on the home screen. What's safe to spend today (or how far
 * over, or what's been spent when there's no budget), Home's ring with Taily's cat, and the two quick
 * ways in: the mic starts listening the moment it's tapped (VoicePlugin begins before the app has even
 * drawn), the + opens the add sheet, and the figure opens Taily.
 *
 * <p>It can't read Taily's data, so the app leaves a small summary whenever it changes (WidgetPlugin),
 * and the widget works today's numbers out from it, after midnight too (TodayMoney). The class keeps its
 * old name: launchers remember widgets by it, and renaming it would take the widget off people's screens.
 */
public class VoiceWidget extends AppWidgetProvider {

  /** A minute past midnight, so a new day shows a new day's figure without Taily being opened. */
  static final String ACTION_NEW_DAY = "com.tally.expense.widget.NEW_DAY";

  private enum Kind {
    /** One cell: the mic alone. */
    MIC(40, 40, 0, 0),
    /** Two cells: the figure and the mic. */
    SMALL(100, 40, 0, 26),
    /** Three cells: the figure, the mic and the +. */
    MEDIUM(180, 40, 0, 26),
    /** Four cells and wider: the ring joins them. */
    WIDE(250, 40, 44, 26),
    /** Two by two: the ring above the figure, the buttons below. */
    SQUARE(100, 170, 64, 30),
    /**
     * The same, tall enough for the month under today without crowding it: the figures and a bar, as TALL has them.
     * Measured on a phone at the standard text size, the ring, the figure, its label, the month and the buttons take
     * 227 dp with the padding; 230 leaves them a little air. Shorter, the two by two stays as it was.
     */
    SQUARE_TALL(100, 230, 64, 30),
    /** Three or four by two: Home's today card. */
    LARGE(220, 150, 86, 42),
    /** The same, with room under today for the month, as Home's month strip under its today card. */
    TALL(220, 200, 86, 42);

    /** The least room (dp) this layout needs; Android 12+ shows the closest one that fits. */
    final float width, height;
    final int ringDp, numberDp;

    Kind(float width, float height, int ringDp, int numberDp) {
      this.width = width;
      this.height = height;
      this.ringDp = ringDp;
      this.numberDp = numberDp;
    }

    /**
     * The least height at the phone's text size. The tall two-by-two's label and month line (about 14 dp each at the
     * standard size) grow with the text; the ring, the figure and the buttons don't.
     */
    float heightAt(float fontScale) {
      return this == SQUARE_TALL ? height + Math.max(0f, fontScale - 1f) * 28f : height;
    }
  }

  @Override
  public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
    for (int id : ids) manager.updateAppWidget(id, views(context, manager.getAppWidgetOptions(id)));
    scheduleNewDay(context);
  }

  @Override
  public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
    manager.updateAppWidget(id, views(context, options));
  }

  @Override
  public void onEnabled(Context context) {
    scheduleNewDay(context);
  }

  @Override
  public void onDisabled(Context context) {
    AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
    if (alarms != null) alarms.cancel(newDay(context));
  }

  @Override
  public void onReceive(Context context, Intent intent) {
    super.onReceive(context, intent);
    String action = intent.getAction();
    if (
      ACTION_NEW_DAY.equals(action) ||
      Intent.ACTION_TIME_CHANGED.equals(action) ||
      Intent.ACTION_TIMEZONE_CHANGED.equals(action) ||
      Intent.ACTION_LOCALE_CHANGED.equals(action)
    ) {
      refreshAll(context);
    }
  }

  /** After the app leaves a new summary, and at the start of a new day. */
  static void refreshAll(Context context) {
    AppWidgetManager manager = AppWidgetManager.getInstance(context);
    int[] ids = manager.getAppWidgetIds(new ComponentName(context, VoiceWidget.class));
    for (int id : ids) manager.updateAppWidget(id, views(context, manager.getAppWidgetOptions(id)));
    if (ids.length > 0) scheduleNewDay(context);
  }

  static RemoteViews views(Context context, Bundle options) {
    WidgetData data = WidgetData.load(context);
    float fontScale = context.getResources().getConfiguration().fontScale;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      // the launcher picks the closest of these that fits, re-picks as the widget is resized, and swaps
      // light and dark by itself when the phone changes theme
      Map<SizeF, RemoteViews> sizes = new ArrayMap<>();
      for (Kind kind : Kind.values()) sizes.put(new SizeF(kind.width, kind.heightAt(fontScale)), build(context, data, kind, true));
      return new RemoteViews(sizes);
    }
    return build(context, data, pick(context, options, fontScale), false);
  }

  /** Before Android 12, one layout for the size the launcher reports. */
  private static Kind pick(Context context, Bundle options, float fontScale) {
    if (options == null) return Kind.LARGE;
    boolean portrait = context.getResources().getConfiguration().orientation != Configuration.ORIENTATION_LANDSCAPE;
    int w = options.getInt(portrait ? AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH : AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, 0);
    int h = options.getInt(portrait ? AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT : AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
    if (w == 0 || h == 0) return Kind.LARGE;
    Kind best = Kind.MIC;
    for (Kind kind : Kind.values()) {
      if (kind.width <= w && kind.heightAt(fontScale) <= h && kind.width * kind.height >= best.width * best.height) best = kind;
    }
    return best;
  }

  private static RemoteViews build(Context context, WidgetData data, Kind kind, boolean dual) {
    // the four-by-two, with the month under today when it's tall enough
    boolean large = kind == Kind.LARGE || kind == Kind.TALL;
    int layout = kind == Kind.MIC
        ? R.layout.widget_voice_mic
        : kind == Kind.SQUARE || kind == Kind.SQUARE_TALL
            ? R.layout.widget_today_square
            : large ? R.layout.widget_today_large : R.layout.widget_today_row;
    RemoteViews v = new RemoteViews(context.getPackageName(), layout);
    // Android 12+ gets both palettes and follows the phone; before it, the one that applies now
    WidgetData.Palette day = dual ? data.day() : data.current(context);
    WidgetData.Palette night = dual ? data.night() : day;

    tint(v, R.id.widget_fill, day.bg, night.bg, dual);
    tint(v, R.id.widget_edge, day.edge, night.edge, dual);
    tint(v, R.id.widget_mic_bg, day.accent, night.accent, dual);
    tint(v, R.id.widget_mic_glyph, day.onAccent, night.onAccent, dual);
    v.setOnClickPendingIntent(R.id.widget_voice, VoiceLaunch.pending(context, 1, VoiceLaunch.voiceIntent(context, "widget")));
    if (kind == Kind.MIC) return v;

    tint(v, R.id.widget_add_bg, day.button, night.button, dual);
    tint(v, R.id.widget_add_glyph, day.ink, night.ink, dual);
    textColor(v, R.id.widget_label, day.muted, night.muted, dual);
    textColor(v, R.id.widget_status, day.ink, night.ink, dual);
    if (large) {
      textColor(v, R.id.widget_caption, day.muted, night.muted, dual);
      textColor(v, R.id.widget_voice_text, day.onAccent, night.onAccent, dual);
      textColor(v, R.id.widget_add_text, day.ink, night.ink, dual);
    }
    v.setOnClickPendingIntent(R.id.widget_add, VoiceLaunch.pending(context, 2, VoiceLaunch.addIntent(context, "widget")));
    v.setOnClickPendingIntent(R.id.widget_info, VoiceLaunch.pending(context, 4, VoiceLaunch.homeIntent(context, "widget")));
    if (kind == Kind.SMALL) v.setViewVisibility(R.id.widget_add, View.GONE);

    Resources res = context.getResources();
    float density = res.getDisplayMetrics().density;
    // two and three cells have no room for the long words
    boolean narrow = kind == Kind.SMALL || kind == Kind.MEDIUM;
    if (data.state == WidgetData.State.LOCKED) {
      // app lock is on: the figure's place stays, masked, like a bank app's balance; Taily shows it after the PIN
      String label = res.getString(R.string.widget_locked_label);
      String why = res.getString(R.string.widget_locked);
      String masked = data.money(0).replace("0", "\u2022\u2022\u2022\u2022");
      v.setTextViewText(R.id.widget_label, label);
      v.setViewVisibility(R.id.widget_status, View.GONE);
      v.setImageViewBitmap(R.id.widget_number, WidgetArt.number(context, masked, Math.round(kind.numberDp * density), 0, data.special));
      v.setViewVisibility(R.id.widget_number, View.VISIBLE);
      tint(v, R.id.widget_number, day.ink, night.ink, dual);
      if (large) {
        v.setTextViewText(R.id.widget_caption, why);
        v.setViewVisibility(R.id.widget_caption, View.VISIBLE);
      }
      art(v, context, kind, data, day, night, dual, null);
      v.setContentDescription(R.id.widget_info, res.getString(R.string.widget_open, label + ". " + why));
      return v;
    }
    if (data.state == WidgetData.State.SETUP) {
      String label = res.getString(R.string.widget_title);
      String status = res.getString(narrow ? R.string.widget_setup_short : R.string.widget_setup);
      v.setTextViewText(R.id.widget_label, label);
      v.setTextViewText(R.id.widget_status, status);
      v.setViewVisibility(R.id.widget_status, View.VISIBLE);
      v.setViewVisibility(R.id.widget_number, View.GONE);
      art(v, context, kind, data, day, night, dual, null);
      if (large) v.setViewVisibility(R.id.widget_caption, View.GONE);
      v.setContentDescription(R.id.widget_info, res.getString(R.string.widget_open, label + ". " + res.getString(R.string.widget_setup)));
      return v;
    }

    TodayMoney money = data.money;
    boolean over = money.over();
    String amount = data.money(money.figure());
    String label = res.getString(
        narrow
            ? (over
                ? R.string.widget_short_over
                : money.hasBudget
                    ? R.string.widget_short_room
                    // two cells cut "Spent today" short; three have room for it
                    : kind == Kind.SMALL ? R.string.widget_short_spent : R.string.widget_label_spent)
            : (over ? R.string.widget_label_over : money.hasBudget ? R.string.widget_label_room : R.string.widget_label_spent));
    // only the four-by-two has room for it; it's the spoken description on every size
    String caption;
    switch (money.caption()) {
      case OVER:
        caption = res.getString(R.string.widget_caption_over, data.money(money.allowance));
        break;
      case ROOM:
        caption = res.getString(R.string.widget_caption_room, data.money(money.allowance));
        break;
      case MONTH:
        // no budget: today's spend, and under it the month so far, as Home's month strip has it
        caption = res.getString(R.string.widget_caption_month, data.money(money.month));
        break;
      case ENTRIES:
        caption = res.getQuantityString(R.plurals.widget_caption_entries, money.entries, money.entries);
        break;
      default:
        caption = res.getString(R.string.widget_caption_fresh);
    }

    v.setTextViewText(R.id.widget_label, label);
    v.setViewVisibility(R.id.widget_status, View.GONE);
    Bitmap number = WidgetArt.number(context, amount, Math.round(kind.numberDp * density), 0, data.special);
    v.setImageViewBitmap(R.id.widget_number, number);
    v.setViewVisibility(R.id.widget_number, View.VISIBLE);
    tint(v, R.id.widget_number, over ? day.over : day.ink, over ? night.over : night.ink, dual);
    if (large) {
      v.setTextViewText(R.id.widget_caption, caption);
      v.setViewVisibility(R.id.widget_caption, View.VISIBLE);
    }

    // as on Home, the ring needs a budget: without one there's no room to measure, so the cat sits on its badge
    art(v, context, kind, data, day, night, dual, money.hasBudget ? money : null);

    // the month under today, as Home's month strip under its card. Without a budget the caption already says the
    // month, so this needs one; and room, which the tall four-by-two and the tall two-by-two have
    String said = label + ": " + amount + ", " + caption;
    boolean square = kind == Kind.SQUARE_TALL;
    if ((kind == Kind.TALL || square) && money.hasBudget) {
      boolean monthOver = money.monthOver();
      String monthName = monthName(money.day);
      String spentText = data.money(money.month);
      String budgetText = data.money(money.budget);
      if (!square) {
        v.setTextViewText(R.id.widget_month_name, monthName);
        textColor(v, R.id.widget_month_name, day.muted, night.muted, dual);
      }
      // the two-by-two has room for the figures only, in whole rupees: "₹16,096.01 of ₹50,000" runs past a 2-cell
      // widget, "₹16,096 of ₹50,000" fits. What it says aloud keeps the paise
      v.setTextViewText(R.id.widget_month_spent, square ? data.money(wholeUnits(money.month)) : spentText);
      v.setTextViewText(R.id.widget_month_of, res.getString(R.string.widget_month_of, square ? data.money(wholeUnits(money.budget)) : budgetText));
      textColor(v, R.id.widget_month_spent, monthOver ? day.over : day.ink, monthOver ? night.over : night.ink, dual);
      textColor(v, R.id.widget_month_of, day.muted, night.muted, dual);
      tint(v, R.id.widget_month_track, monthOver ? day.overTrack : day.track, monthOver ? night.overTrack : night.track, dual);
      tint(v, R.id.widget_month_fill, monthOver ? day.over : day.arc, monthOver ? night.over : night.arc, dual);
      float share = money.monthFraction();
      // the launcher reapplies an update to the widget it already shows, and a new weight sum alone doesn't make the
      // row measure itself again: it goes and comes back around the new sum, which does
      v.setViewVisibility(R.id.widget_month_bar, View.GONE);
      if (share > 0) {
        // the row's one child weighs 1: a weight sum of 1 / share leaves it that share of the width
        v.setFloat(R.id.widget_month_bar, "setWeightSum", 1f / share);
        v.setViewVisibility(R.id.widget_month_fill, View.VISIBLE);
      } else {
        v.setViewVisibility(R.id.widget_month_fill, View.INVISIBLE);
      }
      v.setViewVisibility(R.id.widget_month_bar, View.VISIBLE);
      v.setViewVisibility(R.id.widget_month, View.VISIBLE);
      String monthSaid = res.getString(R.string.widget_month_said, monthName, spentText, budgetText);
      // a tap of its own on the four-by-two; on the two-by-two it sits inside the figure's tap, which opens Taily too
      if (!square) {
        v.setOnClickPendingIntent(R.id.widget_month, VoiceLaunch.pending(context, 4, VoiceLaunch.homeIntent(context, "widget")));
        v.setContentDescription(R.id.widget_month, res.getString(R.string.widget_open, monthSaid));
      }
      said += ". " + monthSaid;
    }

    v.setContentDescription(R.id.widget_info, res.getString(R.string.widget_open, said));
    return v;
  }

  /** The ring with the cat for {@code money}, or the cat's badge for null, where the layout has room for it. */
  private static void art(
      RemoteViews v, Context context, Kind kind, WidgetData data, WidgetData.Palette day, WidgetData.Palette night,
      boolean dual, TodayMoney money) {
    if (kind.ringDp <= 0) {
      v.setViewVisibility(R.id.widget_ring, View.GONE);
      return;
    }
    int px = Math.round(kind.ringDp * context.getResources().getDisplayMetrics().density);
    Bitmap light = money != null ? WidgetArt.ring(px, day, money, data.special) : WidgetArt.badge(px, day, data.special);
    if (dual && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      Bitmap dark = night == day
          ? light
          : money != null ? WidgetArt.ring(px, night, money, data.special) : WidgetArt.badge(px, night, data.special);
      v.setIcon(R.id.widget_ring, "setImageIcon", Icon.createWithBitmap(light), Icon.createWithBitmap(dark));
    } else {
      v.setImageViewBitmap(R.id.widget_ring, light);
    }
    v.setViewVisibility(R.id.widget_ring, View.VISIBLE);
  }

  /** An amount in minor units to the nearest whole rupee (or dollar), still in minor units: 1609601 is 1609600. */
  static long wholeUnits(long minor) {
    return Math.round(minor / 100.0) * 100;
  }

  /** "November" for "2026-11-16": the month's name in English, like the rest of Taily's words. */
  static String monthName(String day) {
    int month = Integer.parseInt(day.substring(5, 7));
    return new DateFormatSymbols(Locale.ENGLISH).getMonths()[month - 1];
  }

  private static void tint(RemoteViews v, int id, int day, int night, boolean dual) {
    if (dual && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) v.setColorInt(id, "setColorFilter", day, night);
    else v.setInt(id, "setColorFilter", day);
  }

  private static void textColor(RemoteViews v, int id, int day, int night, boolean dual) {
    if (dual && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) v.setColorInt(id, "setTextColor", day, night);
    else v.setTextColor(id, day);
  }

  /**
   * Wakes nothing: a sleeping phone catches up the moment it's next used. Within ten minutes of midnight
   * (the least window Android allows without the exact-alarm permission, which Taily doesn't ask for), where
   * a plain inexact alarm could leave yesterday's figure up until one.
   */
  private static void scheduleNewDay(Context context) {
    AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
    if (alarms == null) return;
    Calendar next = Calendar.getInstance();
    next.add(Calendar.DAY_OF_YEAR, 1);
    next.set(Calendar.HOUR_OF_DAY, 0);
    next.set(Calendar.MINUTE, 0);
    next.set(Calendar.SECOND, 5);
    next.set(Calendar.MILLISECOND, 0);
    alarms.setWindow(AlarmManager.RTC, next.getTimeInMillis(), 10 * 60 * 1000L, newDay(context));
  }

  private static PendingIntent newDay(Context context) {
    Intent intent = new Intent(context, VoiceWidget.class).setAction(ACTION_NEW_DAY);
    return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
  }
}
