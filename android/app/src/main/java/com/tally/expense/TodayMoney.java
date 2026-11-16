package com.tally.expense;

import java.util.List;
import java.util.Map;

/**
 * Today's money, as Home's today card works it out (safeToSpend in src/db/stats.ts), for the
 * home-screen widget and the Quick Settings tile. The app leaves a summary of the month (what
 * was spent before its today, each day's spend from then on and the part of it recurring rules
 * logged, and the rules that are on); this works the numbers out for whatever day it is now, so
 * the widget is still right after midnight when Taily hasn't been opened since. Plain Java, so
 * the JVM tests can run it.
 */
final class TodayMoney {

  /** A recurring rule that's on, as the app sends it (src/lib/widget.ts): its day of the month, amount and next run. */
  static final class Rule {
    final int day;
    final long amount;
    /** "YYYY-MM-DD": the day it logs its next payment; past this month's day once this month's is logged */
    final String next;

    Rule(int day, long amount, String next) {
      this.day = day;
      this.amount = amount;
      this.next = next;
    }
  }

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
  /** The allowance minus today's spend, recurring payments aside: negative once today is over. */
  final long remaining;
  /** Everything spent today, a recurring payment too ("Spent today" without a budget). */
  final long spent;
  /** Every entry dated today, money in as well as out (Home's "entries so far today"). */
  final int entries;
  /** Spent this month, as Home's month strip counts it: every day of it, a day dated later in it too. */
  final long month;
  /** The month's overall budget; 0 without one. */
  final long budget;
  /** The day these figures are for, "YYYY-MM-DD": today, or the summary's own day if the clock went back. */
  final String day;

  private TodayMoney(boolean hasBudget, long allowance, long remaining, long spent, int entries, long month, long budget, String day) {
    this.hasBudget = hasBudget;
    this.allowance = allowance;
    this.remaining = remaining;
    this.spent = spent;
    this.entries = entries;
    this.month = month;
    this.budget = budget;
    this.day = day;
  }

  boolean over() {
    return hasBudget && remaining < 0;
  }

  /** How much of today's allowance is left, 0 to 1: the ring's arc. */
  float left() {
    if (allowance <= 0 || over()) return 0f;
    return Math.max(0f, Math.min(1f, (float) Math.max(0, remaining) / allowance));
  }

  /** The month past its budget: the big widget's month line turns to the over colour, as Home's month strip does. */
  boolean monthOver() {
    return hasBudget && month > budget;
  }

  /**
   * How much of the month's budget is spent, 0 to 1: the big widget's month bar. A sliver at the least once anything
   * is spent, so a bar that has started never looks empty.
   */
  float monthFraction() {
    if (!hasBudget || budget <= 0 || month <= 0) return 0f;
    return Math.max(0.025f, Math.min(1f, (float) month / budget));
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

  /** A summary with no recurring payments in it, as an app from before them sends. */
  static TodayMoney compute(
      long budget, long before, Map<String, Long> days, Map<String, Integer> counts, String summaryDay, String now) {
    return compute(budget, before, days, counts, null, null, summaryDay, now);
  }

  /**
   * @param budget the month's overall budget in minor units, 0 for none
   * @param before what the app counted as spent this month before {@code summaryDay}
   * @param days spend per day, {@code summaryDay} and later in the same month (ISO dates)
   * @param counts entries per day, the same days
   * @param fixed the part of each day's spend that recurring rules logged, the same days; null for none
   * @param rules the recurring rules that are on; null for none
   * @param summaryDay the app's today when it wrote the summary, "YYYY-MM-DD"
   * @param now the day it is now, "YYYY-MM-DD"
   */
  static TodayMoney compute(
      long budget, long before, Map<String, Long> days, Map<String, Integer> counts, Map<String, Long> fixed,
      List<Rule> rules, String summaryDay, String now) {
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
      // a new month: nothing logged in it is known yet (its recurring payments are, below)
      spentBefore = 0;
      days = null;
      counts = null;
      fixed = null;
      monthSpent = 0;
    } else if (days != null) {
      for (Map.Entry<String, Long> e : days.entrySet()) {
        String d = e.getKey();
        if (d.compareTo(summaryDay) >= 0 && d.compareTo(now) < 0 && e.getValue() != null) spentBefore += e.getValue();
      }
    }
    Long spentToday = days == null ? null : days.get(day);
    Integer entriesToday = counts == null ? null : counts.get(day);
    Long fixedOnDay = fixed == null ? null : fixed.get(day);
    long spent = spentToday == null ? 0 : spentToday;
    int entries = entriesToday == null ? 0 : entriesToday;
    // today's recurring payments: set aside with the month's others, never taken from today's share
    long fixedToday = fixedOnDay == null ? 0 : fixedOnDay;
    int year = Integer.parseInt(day.substring(0, 4));
    int month = Integer.parseInt(day.substring(5, 7));
    int dayOfMonth = Integer.parseInt(day.substring(8, 10));
    int dim = daysInMonth(year, month);
    // the month's recurring payments its rules haven't logged yet (stillDue in stats.ts): a rule's day is still to
    // come while its next run isn't past it. Taily logs one on its day, or the first time it's opened after, dated
    // that day; so one whose day has come counts as it will then, spent before today or today, and one still ahead
    // is set aside. However it's counted, it comes out of the month before today's share
    long dueLater = 0;
    if (rules != null) {
      String monthKey = day.substring(0, 7);
      for (Rule r : rules) {
        if (r == null || r.next == null || r.amount <= 0) continue;
        String on = String.format(java.util.Locale.US, "%s-%02d", monthKey, Math.min(Math.max(1, r.day), dim));
        if (r.next.compareTo(on) > 0) continue;
        int when = on.compareTo(day);
        if (when < 0) {
          spentBefore += r.amount;
          monthSpent += r.amount;
        } else if (when == 0) {
          spent += r.amount;
          fixedToday += r.amount;
          entries++;
          monthSpent += r.amount;
        } else {
          dueLater += r.amount;
        }
      }
    }
    if (budget <= 0) return new TodayMoney(false, 0, 0, spent, entries, monthSpent, 0, day);
    int daysLeft = dim - dayOfMonth + 1;
    // the same floating-point steps as stats.ts, so the two always agree to the paisa
    long allowance = Math.max(0, (long) (Math.floor((double) (budget - spentBefore - fixedToday - dueLater) / daysLeft / 100.0) * 100));
    return new TodayMoney(true, allowance, allowance - (spent - fixedToday), spent, entries, monthSpent, budget, day);
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
