package com.tally.expense;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.HashMap;
import java.util.Map;
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
  public void februaryKnowsLeapYears() {
    assertEquals(29, TodayMoney.daysInMonth(2028, 2));
    assertEquals(28, TodayMoney.daysInMonth(2026, 2));
    assertEquals(28, TodayMoney.daysInMonth(2100, 2));
    assertEquals(29, TodayMoney.daysInMonth(2000, 2));
    assertEquals(30, TodayMoney.daysInMonth(2026, 11));
    assertEquals(31, TodayMoney.daysInMonth(2026, 12));
  }
}
