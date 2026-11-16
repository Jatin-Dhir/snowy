package com.tally.expense;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import org.junit.Test;

/** The widget's figures, as Home works them out (safeToSpend in src/db/stats.ts), on the day and after it. */
public class TodayMoneyTest {

  private static Map<String, Long> days(Object... pairs) {
    Map<String, Long> m = new HashMap<>();
    for (int i = 0; i < pairs.length; i += 2) m.put((String) pairs[i], ((Number) pairs[i + 1]).longValue());
    return m;
  }

  private static Map<String, Integer> counts(Object... pairs) {
    Map<String, Integer> m = new HashMap<>();
    for (int i = 0; i < pairs.length; i += 2) m.put((String) pairs[i], ((Number) pairs[i + 1]).intValue());
    return m;
  }

  @Test
  public void onTheDayItMatchesHome() {
    // ₹30,000 for November, ₹12,000 spent before the 16th, ₹450 today: (30000 - 12000) / 15 days = ₹1,200
    TodayMoney m = TodayMoney.compute(3_000_000, 1_200_000, days("2026-11-16", 45_000), counts("2026-11-16", 3), "2026-11-16", "2026-11-16");
    assertTrue(m.hasBudget);
    assertEquals(120_000, m.allowance);
    assertEquals(75_000, m.remaining);
    assertEquals(45_000, m.spent);
    assertEquals(3, m.entries);
    assertFalse(m.over());
    assertEquals(75_000, m.figure());
    assertEquals(TodayMoney.Mood.HAPPY, m.mood());
  }

  @Test
  public void theAllowanceRoundsDownToWholeRupees() {
    // (10000 - 0) / 30 days = 333.33, so ₹333
    TodayMoney m = TodayMoney.compute(1_000_000, 0, days(), counts(), "2026-11-01", "2026-11-01");
    assertEquals(33_300, m.allowance);
  }

  @Test
  public void overTodayIsSadAndShowsHowFarOver() {
    TodayMoney m = TodayMoney.compute(3_000_000, 1_200_000, days("2026-11-16", 150_000), counts(), "2026-11-16", "2026-11-16");
    assertTrue(m.over());
    assertEquals(-30_000, m.remaining);
    assertEquals(30_000, m.figure());
    assertEquals(0f, m.left(), 0f);
    assertEquals(TodayMoney.Mood.SAD, m.mood());
  }

  @Test
  public void runningLowIsCareful() {
    // ₹1,200 today, ₹900 spent: a quarter left
    TodayMoney m = TodayMoney.compute(3_000_000, 1_200_000, days("2026-11-16", 90_000), counts(), "2026-11-16", "2026-11-16");
    assertEquals(0.25f, m.left(), 0.001f);
    assertEquals(TodayMoney.Mood.CAREFUL, m.mood());
  }

  @Test
  public void aMonthAlreadySpentLeavesNothingButIsNotOver() {
    TodayMoney m = TodayMoney.compute(1_000_000, 1_100_000, days(), counts(), "2026-11-16", "2026-11-16");
    assertEquals(0, m.allowance);
    assertFalse(m.over());
    assertEquals(TodayMoney.Mood.CAREFUL, m.mood());
  }

  @Test
  public void withoutABudgetItIsTodaysSpend() {
    TodayMoney m = TodayMoney.compute(0, 500_000, days("2026-11-16", 32_000), counts("2026-11-16", 2), "2026-11-16", "2026-11-16");
    assertFalse(m.hasBudget);
    assertFalse(m.over());
    assertEquals(32_000, m.figure());
    assertEquals(2, m.entries);
  }

  @Test
  public void theNextDayCountsYesterdayAsSpentBefore() {
    // the app last wrote on the 16th; it's the 17th now and Taily hasn't been opened
    TodayMoney m = TodayMoney.compute(3_000_000, 1_200_000, days("2026-11-16", 45_000), counts("2026-11-16", 3), "2026-11-16", "2026-11-17");
    // (30000 - 12000 - 450) / 14 days = 1253.57, so ₹1,253
    assertEquals(125_300, m.allowance);
    assertEquals(0, m.spent);
    assertEquals(0, m.entries);
    assertEquals(125_300, m.remaining);
  }

  @Test
  public void anEntryDatedAheadCountsWhenItsDayComes() {
    TodayMoney m = TodayMoney.compute(
        3_000_000, 1_200_000, days("2026-11-16", 45_000, "2026-11-18", 20_000), counts("2026-11-16", 1, "2026-11-18", 1), "2026-11-16", "2026-11-18");
    // before the 18th: 12000 + 450 (the 16th) + 0 (the 17th); (30000 - 12450) / 13 = 1350
    assertEquals(135_000, m.allowance);
    assertEquals(20_000, m.spent);
    assertEquals(1, m.entries);
  }

  @Test
  public void aNewMonthStartsFromTheWholeBudget() {
    TodayMoney m = TodayMoney.compute(3_000_000, 2_900_000, days("2026-11-30", 50_000), counts("2026-11-30", 2), "2026-11-30", "2026-12-01");
    // 30000 / 31 days = 967.74, so ₹967
    assertEquals(96_700, m.allowance);
    assertEquals(0, m.spent);
    assertEquals(0, m.entries);
  }

  @Test
  public void aClockThatWentBackKeepsTheSummarysDay() {
    TodayMoney m = TodayMoney.compute(3_000_000, 1_200_000, days("2026-11-16", 45_000), counts(), "2026-11-16", "2026-11-15");
    assertEquals(120_000, m.allowance);
    assertEquals(45_000, m.spent);
  }

  @Test
  public void withoutABudgetTheBigWidgetSaysTheMonth() {
    // ₹5,000 spent before the 16th and ₹320 today: Home's month strip says ₹5,320
    TodayMoney m = TodayMoney.compute(0, 500_000, days("2026-11-16", 32_000), counts("2026-11-16", 2), "2026-11-16", "2026-11-16");
    assertEquals(532_000, m.month);
    assertEquals(32_000, m.figure());
    assertEquals(TodayMoney.Caption.MONTH, m.caption());
  }

  @Test
  public void theMonthCountsADayDatedLaterInItAsHomeDoes() {
    TodayMoney m = TodayMoney.compute(0, 500_000, days("2026-11-16", 32_000, "2026-11-20", 10_000), counts(), "2026-11-16", "2026-11-16");
    assertEquals(542_000, m.month);
    assertEquals(32_000, m.spent);
  }

  @Test
  public void theNextDayKeepsTheMonth() {
    // the 17th, Taily not opened since the 16th: nothing today, the month as it was
    TodayMoney m = TodayMoney.compute(0, 500_000, days("2026-11-16", 32_000), counts("2026-11-16", 2), "2026-11-16", "2026-11-17");
    assertEquals(532_000, m.month);
    assertEquals(0, m.spent);
    assertEquals(TodayMoney.Caption.MONTH, m.caption());
  }

  @Test
  public void aNewMonthHasNothingInItYet() {
    TodayMoney m = TodayMoney.compute(0, 2_900_000, days("2026-11-30", 50_000), counts("2026-11-30", 2), "2026-11-30", "2026-12-01");
    assertEquals(0, m.month);
    assertEquals(TodayMoney.Caption.FRESH, m.caption());
  }

  @Test
  public void onlyMoneyInSoFarCountsEntriesNotTheMonth() {
    // the 1st, a salary in and nothing spent: no month to show yet, so the entries today
    TodayMoney m = TodayMoney.compute(0, 0, days(), counts("2026-11-01", 1), "2026-11-01", "2026-11-01");
    assertEquals(0, m.month);
    assertEquals(TodayMoney.Caption.ENTRIES, m.caption());
  }

  @Test
  public void aMonthWithNothingAtAllIsAFreshDay() {
    TodayMoney m = TodayMoney.compute(0, 0, days(), counts(), "2026-11-01", "2026-11-01");
    assertEquals(TodayMoney.Caption.FRESH, m.caption());
  }

  @Test
  public void withABudgetTheCaptionIsTodaysShareAsBefore() {
    TodayMoney under = TodayMoney.compute(3_000_000, 1_200_000, days("2026-11-16", 45_000), counts(), "2026-11-16", "2026-11-16");
    assertEquals(TodayMoney.Caption.ROOM, under.caption());
    assertEquals(1_245_000, under.month);
    TodayMoney over = TodayMoney.compute(3_000_000, 1_200_000, days("2026-11-16", 150_000), counts(), "2026-11-16", "2026-11-16");
    assertEquals(TodayMoney.Caption.OVER, over.caption());
  }

  @Test
  public void aClockThatWentBackKeepsTheSummarysMonth() {
    TodayMoney m = TodayMoney.compute(0, 500_000, days("2026-11-16", 32_000), counts(), "2026-11-16", "2026-11-15");
    assertEquals(532_000, m.month);
  }

  @Test
  public void aDayFromAnotherMonthStaysOutOfTheMonth() {
    TodayMoney m = TodayMoney.compute(0, 500_000, days("2026-11-16", 32_000, "2026-12-01", 99_000), counts(), "2026-11-16", "2026-11-16");
    assertEquals(532_000, m.month);
  }

  @Test
  public void theBigWidgetsMonthLineIsHomesMonthStrip() {
    // ₹12,000 before today and ₹450 today of a ₹30,000 month: 41.5% of the bar
    TodayMoney m = TodayMoney.compute(3_000_000, 1_200_000, days("2026-11-16", 45_000), counts(), "2026-11-16", "2026-11-16");
    assertEquals(3_000_000, m.budget);
    assertEquals(1_245_000, m.month);
    assertEquals(0.415f, m.monthFraction(), 0.0001f);
    assertFalse(m.monthOver());
    assertEquals("2026-11-16", m.day);
  }

  @Test
  public void aMonthPastItsBudgetFillsTheBarInTheOverColour() {
    TodayMoney m = TodayMoney.compute(1_000_000, 1_100_000, days("2026-11-16", 5_000), counts(), "2026-11-16", "2026-11-16");
    assertTrue(m.monthOver());
    assertEquals(1f, m.monthFraction(), 0f);
  }

  @Test
  public void aBarThatHasStartedNeverLooksEmpty() {
    TodayMoney m = TodayMoney.compute(10_000_000, 0, days("2026-11-01", 3_000), counts(), "2026-11-01", "2026-11-01");
    assertEquals(0.025f, m.monthFraction(), 0f);
    TodayMoney none = TodayMoney.compute(10_000_000, 0, days(), counts(), "2026-11-01", "2026-11-01");
    assertEquals(0f, none.monthFraction(), 0f);
  }

  @Test
  public void withoutABudgetThereIsNoMonthBar() {
    TodayMoney m = TodayMoney.compute(0, 500_000, days("2026-11-16", 32_000), counts(), "2026-11-16", "2026-11-16");
    assertEquals(0, m.budget);
    assertEquals(0f, m.monthFraction(), 0f);
    assertFalse(m.monthOver());
  }

  @Test
  public void aNewMonthsBarStartsEmpty() {
    TodayMoney m = TodayMoney.compute(3_000_000, 2_900_000, days("2026-11-30", 50_000), counts(), "2026-11-30", "2026-12-01");
    assertEquals(0f, m.monthFraction(), 0f);
    assertEquals("2026-12-01", m.day);
  }

  // ---- recurring payments (rent, EMIs, subscriptions): set aside from the month, never today's spend

  /** Rules as day, amount, next run: rules(1, 1_400_000, "2026-12-01", ...) */
  private static List<TodayMoney.Rule> rules(Object... triples) {
    List<TodayMoney.Rule> list = new ArrayList<>();
    for (int i = 0; i < triples.length; i += 3) {
      list.add(new TodayMoney.Rule(((Number) triples[i]).intValue(), ((Number) triples[i + 1]).longValue(), (String) triples[i + 2]));
    }
    return list;
  }

  @Test
  public void rentDayIsNotOverToday() {
    // ₹50,000 for November, ₹14,000 of rent logged by its rule this morning and ₹200 of chai: (50000 - 14000) / 30
    // days = ₹1,200 for today, ₹1,000 of it left. Before, it read "over today by ₹12,534" with the sad cat
    TodayMoney m = TodayMoney.compute(5_000_000, 0, days("2026-11-01", 1_420_000), counts("2026-11-01", 2),
        days("2026-11-01", 1_400_000), rules(1, 1_400_000, "2026-12-01"), "2026-11-01", "2026-11-01");
    assertEquals(120_000, m.allowance);
    assertEquals(100_000, m.remaining);
    assertFalse(m.over());
    assertEquals(TodayMoney.Mood.HAPPY, m.mood());
    assertEquals(TodayMoney.Caption.ROOM, m.caption());
    // what was spent today is still all of it, as the Today list adds it up
    assertEquals(1_420_000, m.spent);
    assertEquals(1_420_000, m.month);
  }

  @Test
  public void aBillStillDueIsSetAsideFromToday() {
    // the demo month on the 16th: ₹38,760 spent before today, ₹626 today, rent and Netflix logged earlier and a ₹1,500
    // EMI due on the 25th: (50000 - 38760 - 1500) / 15 days = 649.33, so ₹649, ₹23 of it left. Home says the same
    // (scratchpad money5/t3-safe.mjs)
    TodayMoney m = TodayMoney.compute(5_000_000, 3_876_000, days("2026-11-16", 62_600), counts("2026-11-16", 4), days(),
        rules(1, 1_400_000, "2026-12-01", 14, 19_900, "2026-12-14", 25, 150_000, "2026-11-25"), "2026-11-16", "2026-11-16");
    assertEquals(64_900, m.allowance);
    assertEquals(2_300, m.remaining);
    assertEquals(62_600, m.spent);
    // not spent yet, so not in the month's figure
    assertEquals(3_938_600, m.month);
  }

  @Test
  public void aBillsDayComingWithoutTailyOpenedCountsAsItWillBeLogged() {
    // the summary is from the 16th and it's the 25th, the EMI's day, with Taily not opened since. Opened, Taily logs the
    // EMI today, so: (50000 - 39386 - 1500) / 6 days = 1519, all of it left
    TodayMoney m = TodayMoney.compute(5_000_000, 3_876_000, days("2026-11-16", 62_600), counts("2026-11-16", 4), days(),
        rules(25, 150_000, "2026-11-25"), "2026-11-16", "2026-11-25");
    assertEquals(151_900, m.allowance);
    assertEquals(151_900, m.remaining);
    assertEquals(150_000, m.spent);
    assertEquals(1, m.entries);
    assertEquals(4_088_600, m.month);
    // the day after, it was spent before today: (50000 - 39386 - 1500) / 5 days = 1822.8, so ₹1,822
    TodayMoney next = TodayMoney.compute(5_000_000, 3_876_000, days("2026-11-16", 62_600), counts("2026-11-16", 4), days(),
        rules(25, 150_000, "2026-11-25"), "2026-11-16", "2026-11-26");
    assertEquals(182_200, next.allowance);
    assertEquals(0, next.spent);
    assertEquals(4_088_600, next.month);
  }

  @Test
  public void aNewMonthKnowsItsRentIsDue() {
    // the summary is from the 30th; the 1st comes at midnight, rent's day, before Taily is opened. Opened, it logs the
    // rent: (50000 - 14000) / 31 days = 1161.29, so ₹1,161, as the app will say, not 50000 / 31 = ₹1,612
    TodayMoney m = TodayMoney.compute(5_000_000, 4_000_000, days("2026-11-30", 50_000), counts("2026-11-30", 2), days(),
        rules(1, 1_400_000, "2026-12-01"), "2026-11-30", "2026-12-01");
    assertEquals(116_100, m.allowance);
    assertEquals(116_100, m.remaining);
    assertFalse(m.over());
    assertEquals(1_400_000, m.month);
    assertEquals("2026-12-01", m.day);
  }

  @Test
  public void aPaymentLoggedThisMonthIsNotSetAsideAgain() {
    // rent was logged on the 1st (it's in what was spent before), so its next run is December's
    TodayMoney with = TodayMoney.compute(5_000_000, 1_400_000, days(), counts(), days(), rules(1, 1_400_000, "2026-12-01"), "2026-11-16", "2026-11-16");
    TodayMoney without = TodayMoney.compute(5_000_000, 1_400_000, days(), counts(), "2026-11-16", "2026-11-16");
    assertEquals(without.allowance, with.allowance);
    assertEquals(without.month, with.month);
  }

  @Test
  public void aRuleForThe31stFallsOnAShortMonthsLastDay() {
    // a rule for the 31st in November is due on the 30th: (10000 - 5000 - 1000) / 1 day = ₹4,000, all of it left
    TodayMoney m = TodayMoney.compute(1_000_000, 500_000, days(), counts(), days(), rules(31, 100_000, "2026-11-30"), "2026-11-29", "2026-11-30");
    assertEquals(100_000, m.spent);
    assertEquals(400_000, m.allowance);
    assertEquals(400_000, m.remaining);
  }

  @Test
  public void withoutABudgetTheRentIsSpentToday() {
    TodayMoney m = TodayMoney.compute(0, 0, days("2026-11-01", 1_420_000), counts("2026-11-01", 2), days("2026-11-01", 1_400_000),
        rules(1, 1_400_000, "2026-12-01"), "2026-11-01", "2026-11-01");
    assertFalse(m.hasBudget);
    assertEquals(1_420_000, m.figure());
  }

  /** 2.19.0's allowance and room left, copied as they were, to hold the new code to them. */
  private static long[] before219(long budget, long before, Map<String, Long> days, String summaryDay, String now) {
    String day = now;
    long spentBefore = before;
    if (now.compareTo(summaryDay) < 0) {
      day = summaryDay;
    } else if (!now.substring(0, 7).equals(summaryDay.substring(0, 7))) {
      spentBefore = 0;
      days = null;
    } else if (days != null) {
      for (Map.Entry<String, Long> e : days.entrySet()) {
        String d = e.getKey();
        if (d.compareTo(summaryDay) >= 0 && d.compareTo(now) < 0 && e.getValue() != null) spentBefore += e.getValue();
      }
    }
    Long spentToday = days == null ? null : days.get(day);
    long spent = spentToday == null ? 0 : spentToday;
    int daysLeft = TodayMoney.daysInMonth(Integer.parseInt(day.substring(0, 4)), Integer.parseInt(day.substring(5, 7)))
        - Integer.parseInt(day.substring(8, 10)) + 1;
    long allowance = Math.max(0, (long) (Math.floor((double) (budget - spentBefore) / daysLeft / 100.0) * 100));
    return new long[] { allowance, allowance - spent };
  }

  @Test
  public void withoutRecurringPaymentsEveryFigureIsAsBefore() {
    Random random = new Random(219);
    for (int i = 0; i < 20_000; i++) {
      int dom = 1 + random.nextInt(30);
      String summaryDay = String.format("2026-11-%02d", dom);
      String now = random.nextInt(5) == 0 ? "2026-12-01" : String.format("2026-11-%02d", Math.min(30, dom + random.nextInt(4)));
      long budget = random.nextInt(4) == 0 ? 0 : 1 + random.nextInt(20_000_000);
      long before = random.nextInt(25_000_000);
      Map<String, Long> spends = days(summaryDay, (long) random.nextInt(3_000_000), now, (long) random.nextInt(500_000));
      // an older app's summary, and a new one with no recurring payments in it: both as 2.19.0 worked them out
      TodayMoney old = TodayMoney.compute(budget, before, spends, counts(), summaryDay, now);
      TodayMoney none = TodayMoney.compute(budget, before, spends, counts(), days(), rules(), summaryDay, now);
      long[] want = before219(budget, before, spends, summaryDay, now);
      if (budget > 0) {
        assertEquals(want[0], old.allowance);
        assertEquals(want[1], old.remaining);
      }
      assertEquals(old.allowance, none.allowance);
      assertEquals(old.remaining, none.remaining);
      assertEquals(old.spent, none.spent);
      assertEquals(old.month, none.month);
    }
  }

  @Test
  public void februaryKnowsLeapYears() {
    assertEquals(29, TodayMoney.daysInMonth(2028, 2));
    assertEquals(28, TodayMoney.daysInMonth(2026, 2));
    assertEquals(28, TodayMoney.daysInMonth(2100, 2));
    assertEquals(29, TodayMoney.daysInMonth(2000, 2));
    assertEquals(30, TodayMoney.daysInMonth(2026, 11));
    assertEquals(31, TodayMoney.daysInMonth(2026, 12));
  }
}
