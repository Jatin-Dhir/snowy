package com.tally.expense;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.icu.text.NumberFormat;
import android.icu.util.Currency;
import android.icu.util.ULocale;
import java.util.Calendar;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import org.json.JSONObject;

/**
 * What the home-screen widget and the Quick Settings tile know about Taily: the small summary the
 * app leaves whenever entries, the budget, the currency or the look change (WidgetPlugin, from
 * src/lib/widget.ts). Never the ledger itself: a month's totals by day, the budget, and colours.
 */
final class WidgetData {

  static final String PREFS = "taily.widget";
  private static final String KEY = "summary";

  enum State {
    /** Taily hasn't been set up yet (or was erased): nothing to show but the way in. */
    SETUP,
    /** App lock is on, so the home screen doesn't show money. */
    LOCKED,
    READY
  }

  /** One theme's colours, light or dark, as global.css has them. */
  static final class Palette {
    /** over: the figure once today is over (global.css's --over-text: red, or a special theme's accent text) */
    final int bg, edge, ink, muted, over, track, overTrack, arc, accent, onAccent, button, earIn, blush;

    Palette(int bg, int edge, int ink, int muted, int over, int track, int overTrack, int arc, int accent,
        int onAccent, int button, int earIn, int blush) {
      this.bg = bg;
      this.edge = edge;
      this.ink = ink;
      this.muted = muted;
      this.over = over;
      this.track = track;
      this.overTrack = overTrack;
      this.arc = arc;
      this.accent = accent;
      this.onAccent = onAccent;
      this.button = button;
      this.earIn = earIn;
      this.blush = blush;
    }

    static Palette from(JSONObject o, Palette fallback) {
      if (o == null) return fallback;
      return new Palette(
          color(o, "bg", fallback.bg),
          color(o, "edge", fallback.edge),
          color(o, "ink", fallback.ink),
          color(o, "muted", fallback.muted),
          color(o, "over", fallback.over),
          color(o, "track", fallback.track),
          color(o, "overTrack", fallback.overTrack),
          color(o, "arc", fallback.arc),
          color(o, "accent", fallback.accent),
          color(o, "onAccent", fallback.onAccent),
          color(o, "button", fallback.button),
          color(o, "earIn", fallback.earIn),
          color(o, "blush", fallback.blush));
    }
  }

  // Taily's default look (the sky accent, hue 210, as lib/theme.ts works it out), before the app has sent its own
  static final Palette DEFAULT_LIGHT = new Palette(
      0xFFEDF0F5, 0xFFDCDFE5, 0xFF1A212B, 0xFF56616D, 0xFFB3453D, 0xFFD9DFE8, 0xFFDDC0C1,
      0xFF508FCE, 0xFF91BAE3, 0xFF22384F, 0xFFD6D9DF, 0xFFFFD3E1, 0xFFF7A3BF);
  static final Palette DEFAULT_DARK = new Palette(
      0xFF1B2127, 0xFF2B3137, 0xFFE8EBF0, 0xFF9AA3AE, 0xFFD9736A, 0xFF272E36, 0xFF50383A,
      0xFF94BDE6, 0xFF81ADDA, 0xFF0F1F2E, 0xFF32373D, 0xFF7D3A5A, 0xFFE57CA3);

  final State state;
  final String currency;
  /** "system" follows the phone's dark theme; "light" and "dark" are the person's own pick in Taily. */
  final String theme;
  /** A special theme: the cat wears ears and blush, and the numbers take the rounded face. */
  final boolean special;
  final Palette light;
  final Palette dark;
  /** Null unless READY. */
  final TodayMoney money;

  private WidgetData(State state, String currency, String theme, boolean special, Palette light, Palette dark, TodayMoney money) {
    this.state = state;
    this.currency = currency;
    this.theme = theme;
    this.special = special;
    this.light = light;
    this.dark = dark;
    this.money = money;
  }

  static void save(Context context, String json) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, json).apply();
  }

  static WidgetData load(Context context) {
    SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    String json = prefs.getString(KEY, null);
    if (json == null) return setup();
    try {
      JSONObject o = new JSONObject(json);
      JSONObject look = o.optJSONObject("look");
      Palette light = Palette.from(look == null ? null : look.optJSONObject("light"), DEFAULT_LIGHT);
      Palette dark = Palette.from(look == null ? null : look.optJSONObject("dark"), DEFAULT_DARK);
      boolean special = look != null && look.optBoolean("special", false);
      String theme = o.optString("theme", "system");
      String currency = o.optString("currency", "INR");
      String state = o.optString("state", "setup");
      if ("setup".equals(state)) return new WidgetData(State.SETUP, currency, theme, special, light, dark, null);
      if (o.optBoolean("locked", false)) return new WidgetData(State.LOCKED, currency, theme, special, light, dark, null);
      TodayMoney money = TodayMoney.compute(
          o.optLong("budget", 0),
          o.optLong("before", 0),
          longs(o.optJSONObject("days")),
          ints(o.optJSONObject("counts")),
          o.optString("today", today()),
          today());
      return new WidgetData(State.READY, currency, theme, special, light, dark, money);
    } catch (Exception e) {
      return setup();
    }
  }

  private static WidgetData setup() {
    return new WidgetData(State.SETUP, "INR", "system", false, DEFAULT_LIGHT, DEFAULT_DARK, null);
  }

  /** The palette to draw with right now: the person's pick in Taily, or the phone's own theme. */
  Palette current(Context context) {
    if ("light".equals(theme)) return light;
    if ("dark".equals(theme)) return dark;
    int mode = context.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
    return mode == Configuration.UI_MODE_NIGHT_YES ? dark : light;
  }

  /** For the launcher to swap by itself when the phone changes theme (Android 12+): the light and dark palettes. */
  Palette day() {
    return "dark".equals(theme) ? dark : light;
  }

  Palette night() {
    return "light".equals(theme) ? light : dark;
  }

  String money(long minor) {
    return format(minor, currency);
  }

  /** Today in this phone's time zone, "YYYY-MM-DD", as todayISO() in src/lib/dates.ts. */
  static String today() {
    Calendar c = Calendar.getInstance();
    return String.format(Locale.US, "%04d-%02d-%02d", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH));
  }

  /**
   * An amount as Taily writes it (formatMinor in src/lib/money.ts): the Indian grouping for rupees, the
   * paise only when there are some, and a true minus sign in front. ICU, like the browser's Intl.
   */
  static String format(long minor, String currency) {
    String code = currency != null && currency.matches("[A-Za-z]{3}") ? currency.toUpperCase(Locale.ROOT) : "INR";
    boolean negative = minor < 0;
    long abs = Math.abs(minor);
    boolean fraction = abs % 100 != 0;
    double value = abs / 100.0;
    String out;
    try {
      NumberFormat f = NumberFormat.getCurrencyInstance("INR".equals(code) ? new ULocale("en_IN") : ULocale.US);
      f.setCurrency(Currency.getInstance(code));
      f.setMinimumFractionDigits(fraction ? 2 : 0);
      f.setMaximumFractionDigits(fraction ? 2 : 0);
      out = f.format(value);
    } catch (Exception e) {
      out = code + " " + String.format(Locale.US, fraction ? "%.2f" : "%.0f", value);
    }
    return negative ? "\u2212" + out : out;
  }

  private static int color(JSONObject o, String key, int fallback) {
    String hex = o.optString(key, null);
    if (hex == null || !hex.matches("#[0-9a-fA-F]{6}")) return fallback;
    return 0xFF000000 | Integer.parseInt(hex.substring(1), 16);
  }

  private static Map<String, Long> longs(JSONObject o) {
    Map<String, Long> m = new HashMap<>();
    if (o == null) return m;
    for (Iterator<String> it = o.keys(); it.hasNext(); ) {
      String k = it.next();
      m.put(k, o.optLong(k, 0));
    }
    return m;
  }

  private static Map<String, Integer> ints(JSONObject o) {
    Map<String, Integer> m = new HashMap<>();
    if (o == null) return m;
    for (Iterator<String> it = o.keys(); it.hasNext(); ) {
      String k = it.next();
      m.put(k, o.optInt(k, 0));
    }
    return m;
  }
}
