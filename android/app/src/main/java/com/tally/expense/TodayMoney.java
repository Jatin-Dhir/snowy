package com.tally.expense;

import java.util.Map;

/**
 * Today's money, as Home's today card works it out (safeToSpend in src/db/stats.ts), for the
 * home-screen widget and the Quick Settings tile. The app leaves a summary of the month (what
 * was spent before its today, and each day's spend from then on); this works the numbers out
 * for whatever day it is now, so the widget is still right after midnight when Taily hasn't
 * been opened since. Plain Java, so the JVM tests can run it.
 */
final class TodayMoney {

  /** How the day is going, the same three moods as the ring's cat on Home (RoomRing.tsx). */
  enum Mood { HAPPY, CAREFUL, SAD }

  /** What the big widget's line under the figure says. */
  enum Caption {
    /** "of your ₹1,200 for today" */
    ROOM,
    /** "past today's ₹1,200" */
    OVER,
    /** no budget: "₹12,340 this month", Home's month figure */
    MONTH,
    /** no budget and nothing spent this month yet, but entries today: "2 entries so far today" */
    ENTRIES,
    /** "A fresh day" */
    FRESH
  }

  final boolean hasBudget;
  /** Today's share of what's left of the month's budget; 0 without a budget. */
  final long allowance;
  /** The allowance minus today's spend: negative once today is over. */
  final long remaining;
  final long spent;
  /** Every entry dated today, money in as well as out (Home's "entries so far today"). */
  final int entries;
  /** Spent this month, as Home's month strip counts it: every day of it, a day dated later in it too. */
  final long month;

  private TodayMoney(boolean hasBudget, long allowance, long remaining, long spent, int entries, long month) {
    this.hasBudget = hasBudget;
    this.allowance = allowance;
    this.remaining = remaining;
    this.spent = spent;
    this.entries = entries;
    this.month = month;
  }

  boolean over() {
    return hasBudget && remaining < 0;
  }

  /** How much of today's allowance is left, 0 to 1: the ring's arc. */
  float left() {
    if (allowance <= 0 || over()) return 0f;
    return Math.max(0f, Math.min(1f, (float) Math.max(0, remaining) / allowance));
  }

  Mood mood() {
    if (over()) return Mood.SAD;
    return left() < 0.35f ? Mood.CAREFUL : Mood.HAPPY;
  }

  /** The figure Home shows: room left (or how far over) with a budget, else today's spend. */
  long figure() {
    return hasBudget ? Math.abs(remaining) : spent;
  }

  /**
   * The line under the figure: with a budget, today's share it's measured against; without one, the month so far, as
   * Home's month strip shows it beside the day, until there's something in the month to show.
   */
  Caption caption() {
    if (hasBudget) return over() ? Caption.OVER : Caption.ROOM;
    if (month > 0) return Caption.MONTH;
    return entries > 0 ? Caption.ENTRIES : Caption.FRESH;
  }

  /**
   * @param budget the month's overall budget in minor units, 0 for none
   * @param before what the app counted as spent this month before {@code summaryDay}
   * @param days spend per day, {@code summaryDay} and later in the same month (ISO dates)
   * @param counts entries per day, the same days
   * @param summaryDay the app's today when it wrote the summary, "YYYY-MM-DD"
   * @param now the day it is now, "YYYY-MM-DD"
   */
  static TodayMoney compute(
      long budget, long before, Map<String, Long> days, Map<String, Integer> counts, String summaryDay, String now) {
    String day = now;
    long spentBefore = before;
    // the summary's month, as Home adds it up: what went before its day, and every day it lists from then, later
    // ones too. A new day in the same month doesn't change it
    long monthSpent = before;
    if (days != null) {
      for (Map.Entry<String, Long> e : days.entrySet()) {
        if (e.getValue() != null && e.getKey().startsWith(summaryDay.substring(0, 7))) monthSpent += e.getValue();
      }
    }
    if (now.compareTo(summaryDay) < 0) {
      // the clock went back: the summary's own day is the best there is
      day = summaryDay;
    } else if (!now.substring(0, 7).equals(summaryDay.substring(0, 7))) {
      // a new month: nothing of it is known yet
      spentBefore = 0;
      days = null;
      counts = null;
      monthSpent = 0;
    } else if (days != null) {
      for (Map.Entry<String, Long> e : days.entrySet()) {
        String d = e.getKey();
        if (d.compareTo(summaryDay) >= 0 && d.compareTo(now) < 0 && e.getValue() != null) spentBefore += e.getValue();
      }
    }
    Long spentToday = days == null ? null : days.get(day);
    Integer entriesToday = counts == null ? null : counts.get(day);
    long spent = spentToday == null ? 0 : spentToday;
    int entries = entriesToday == null ? 0 : entriesToday;
    if (budget <= 0) return new TodayMoney(false, 0, 0, spent, entries, monthSpent);
    int year = Integer.parseInt(day.substring(0, 4));
    int month = Integer.parseInt(day.substring(5, 7));
    int dayOfMonth = Integer.parseInt(day.substring(8, 10));
    int daysLeft = daysInMonth(year, month) - dayOfMonth + 1;
    // the same floating-point steps as stats.ts, so the two always agree to the paisa
    long allowance = Math.max(0, (long) (Math.floor((double) (budget - spentBefore) / daysLeft / 100.0) * 100));
    return new TodayMoney(true, allowance, allowance - spent, spent, entries, monthSpent);
  }

  static int daysInMonth(int year, int month) {
    switch (month) {
      case 2:
        boolean leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
        return leap ? 29 : 28;
      case 4:
      case 6:
      case 9:
      case 11:
        return 30;
      default:
        return 31;
    }
  }
}
