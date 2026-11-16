package com.tally.expense;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Typeface;
import androidx.core.content.res.ResourcesCompat;

/**
 * The two things the widget draws itself, since a launcher can only show standard views and can't
 * load an app's fonts: Home's ring with Taily's cat in it, and the big number in Taily's own face.
 */
final class WidgetArt {
  private WidgetArt() {}

  private static Typeface num;
  private static Typeface round;

  /**
   * Home's ring (RoomRing.tsx), drawn from the same 100-unit drawing: the arc is what's left of today,
   * and the cat's face says how the day is going. A special theme gives the cat its ears and blush.
   */
  static Bitmap ring(int sizePx, WidgetData.Palette p, TodayMoney money, boolean special) {
    return draw(sizePx, p, money, special);
  }

  /**
   * Taily's cat on a soft disc of the accent, where there's no ring to draw: no budget yet, Taily not set
   * up, or app lock on. Not a meter, so it never looks like an empty day.
   */
  static Bitmap badge(int sizePx, WidgetData.Palette p, boolean special) {
    return draw(sizePx, p, null, special);
  }

  private static Bitmap draw(int sizePx, WidgetData.Palette p, TodayMoney money, boolean special) {
    Bitmap bmp = Bitmap.createBitmap(sizePx, sizePx, Bitmap.Config.ARGB_8888);
    Canvas c = new Canvas(bmp);
    // the ring fills 84% of the square, a little low, so the ears have room above it
    float k = 0.42f * sizePx / 37.5f;
    c.translate(sizePx / 2f - 50 * k, 0.53f * sizePx - 56 * k);
    c.scale(k, k);

    TodayMoney.Mood mood = money == null ? TodayMoney.Mood.HAPPY : money.mood();
    boolean over = money != null && money.over();
    Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
    fill.setStyle(Paint.Style.FILL);
    Paint stroke = new Paint(Paint.ANTI_ALIAS_FLAG);
    stroke.setStyle(Paint.Style.STROKE);
    stroke.setStrokeCap(Paint.Cap.ROUND);
    stroke.setStrokeJoin(Paint.Join.ROUND);

    if (special) {
      // the ears never move with the mood: only the face does, the way cat emoji are drawn
      for (int side = -1; side <= 1; side += 2) {
        Path ear = side < 0 ? poly(21, 36, 22, 9, 41, 22) : poly(79, 36, 78, 9, 59, 22);
        fill.setColor(p.accent);
        c.drawPath(ear, fill);
        stroke.setColor(p.accent);
        stroke.setStrokeWidth(5);
        c.drawPath(ear, stroke);
        fill.setColor(p.earIn);
        c.drawPath(side < 0 ? poly(26, 29, 26.5f, 16, 35, 22.5f) : poly(74, 29, 73.5f, 16, 65, 22.5f), fill);
      }
    }

    if (money == null) {
      fill.setColor(mix(p.bg, p.arc, 0.24f));
      c.drawCircle(50, 56, 37.5f, fill);
    } else {
      stroke.setStrokeWidth(9);
      stroke.setColor(over ? p.overTrack : p.track);
      c.drawCircle(50, 56, 33, stroke);
      float left = money.left();
      if (left > 0) {
        stroke.setColor(p.arc);
        c.drawArc(new RectF(17, 23, 83, 89), -90, 360 * left, false, stroke);
      }
    }

    if (special) {
      fill.setColor(p.blush);
      fill.setAlpha(Math.round(255 * 0.7f));
      c.drawOval(new RectF(33.5f - 4.2f, 63 - 2.6f, 33.5f + 4.2f, 63 + 2.6f), fill);
      c.drawOval(new RectF(66.5f - 4.2f, 63 - 2.6f, 66.5f + 4.2f, 63 + 2.6f), fill);
      fill.setAlpha(255);
    }

    stroke.setColor(p.ink);
    stroke.setStrokeWidth(2.6f);
    fill.setColor(p.ink);
    if (mood == TodayMoney.Mood.HAPPY) {
      c.drawPath(quad(37, 54, 41, 49, 45, 54), stroke);
      c.drawPath(quad(55, 54, 59, 49, 63, 54), stroke);
      Path mouth = quad(44, 61.5f, 47, 65, 50, 61.5f);
      mouth.quadTo(53, 65, 56, 61.5f);
      c.drawPath(mouth, stroke);
    } else if (mood == TodayMoney.Mood.CAREFUL) {
      c.drawCircle(41, 53, 2.7f, fill);
      c.drawCircle(59, 53, 2.7f, fill);
      // a small wobble, not a flat line: uneasy, not stern ("M45 63.4 q2.25 -2.1 4.5 0 t4.5 0")
      Path mouth = quad(45, 63.4f, 47.25f, 61.3f, 49.5f, 63.4f);
      mouth.quadTo(51.75f, 65.5f, 54, 63.4f);
      c.drawPath(mouth, stroke);
    } else {
      // the happy face turned over, so it's the same cat: its ^ eyes close downward and its mouth becomes a
      // pout. No brows: slanted brows are what reads as cross
      c.drawPath(quad(37, 53.2f, 41, 57.4f, 45, 53.2f), stroke);
      c.drawPath(quad(55, 53.2f, 59, 57.4f, 63, 53.2f), stroke);
      Path pout = quad(44.5f, 65.6f, 47.25f, 62, 50, 65.2f);
      pout.quadTo(52.75f, 62, 55.5f, 65.6f);
      c.drawPath(pout, stroke);
    }
    return bmp;
  }

  /**
   * The big number as an alpha mask (the launcher tints it, so one bitmap serves light and dark), heightPx
   * tall, its baseline where the digits sit at full size. Too wide for maxWidthPx, it gets smaller on the
   * same baseline, down to 60%; the view scales it the rest of the way if it must.
   */
  static Bitmap number(Context context, String text, int heightPx, int maxWidthPx, boolean rounded) {
    Typeface face = typeface(context, rounded);
    Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);
    paint.setTypeface(face);
    paint.setColor(Color.BLACK);
    // a launcher can't draw the font's narrow no-break space; the plain one looks the same at this size
    text = text.replace('\u202f', '\u00a0');

    // size the face so its tallest sign (the currency's) fills the box above a little room for the comma's tail
    paint.setTextSize(100);
    Rect tall = new Rect();
    paint.getTextBounds("\u20b90123456789$\u20ac\u00a3", 0, 13, tall);
    float capPer100 = -tall.top;
    float tailPer100 = rounded ? 26 : 20;
    float size = heightPx * 100f / (capPer100 + tailPer100);
    paint.setTextSize(size);
    float baseline = capPer100 * size / 100f;
    // a hair of tracking in, like Home's -0.03em hero
    paint.setLetterSpacing(rounded ? -0.01f : -0.02f);
    float width = paint.measureText(text);
    if (maxWidthPx > 0 && width > maxWidthPx) {
      float shrink = Math.max(0.6f, maxWidthPx / width);
      paint.setTextSize(size * shrink);
      width = paint.measureText(text);
    }
    int w = Math.max(1, (int) Math.ceil(width) + 2);
    Bitmap bmp = Bitmap.createBitmap(w, Math.max(1, heightPx), Bitmap.Config.ALPHA_8);
    new Canvas(bmp).drawText(text, 1, baseline, paint);
    return bmp;
  }

  private static synchronized Typeface typeface(Context context, boolean rounded) {
    try {
      if (rounded) {
        if (round == null) round = ResourcesCompat.getFont(context, R.font.taily_round);
        if (round != null) return round;
      } else {
        if (num == null) num = ResourcesCompat.getFont(context, R.font.taily_num);
        if (num != null) return num;
      }
    } catch (Exception ignored) {
      // the system's own bold below
    }
    return Typeface.create("sans-serif", Typeface.BOLD);
  }

  /** {@code t} of b mixed into a, as color-mix(in srgb) does. */
  static int mix(int a, int b, float t) {
    int r = Math.round(Color.red(a) + (Color.red(b) - Color.red(a)) * t);
    int g = Math.round(Color.green(a) + (Color.green(b) - Color.green(a)) * t);
    int bl = Math.round(Color.blue(a) + (Color.blue(b) - Color.blue(a)) * t);
    return Color.rgb(r, g, bl);
  }

  private static Path poly(float x1, float y1, float x2, float y2, float x3, float y3) {
    Path p = new Path();
    p.moveTo(x1, y1);
    p.lineTo(x2, y2);
    p.lineTo(x3, y3);
    p.close();
    return p;
  }

  private static Path quad(float x1, float y1, float cx, float cy, float x2, float y2) {
    Path p = new Path();
    p.moveTo(x1, y1);
    p.quadTo(cx, cy, x2, y2);
    return p;
  }
}
