import type { Account, Rule, Txn } from './db'
import { daysInMonth, todayISO, weekDaysOf } from '../lib/dates'

export function isOut(t: Txn): boolean {
  return (t.kind ?? 'out') === 'out'
}

/**
 * A genuine purchase — money out, minus transfers into savings. Savings
 * still counts as "spent" for budgets and safe-to-spend (it did leave what
 * you can spend today), but it isn't a purchase habit: it shouldn't win
 * "biggest hit", crowd out the frequent one-tap tiles, or trip a spending-
 * spike alert.
 */
export function isRealSpend(t: Txn): boolean {
  return isOut(t) && t.categoryId !== 'savings'
}

/**
 * A payment a recurring rule logged (recurring.ts): rent, an EMI, a subscription. A fixed cost, known ahead and paid
 * in one go on its day, so it says nothing about how fast the rest of the month is going.
 */
export function isRecurring(t: Txn): boolean {
  return t.source === 'recurring'
}

/** One of the month's recurring payments its rule hasn't logged yet. */
export interface DueBill {
  dateISO: string
  amountMinor: number
  categoryId: string | null
}

/**
 * The month's recurring payments still due: each active rule's day in the month that it hasn't logged yet. A rule
 * logs its payment on its day (or the first time Taily is opened after) and moves its next run on past it, so the
 * day is still to come while the next run isn't past it. A paused rule logs nothing.
 */
export function stillDue(rules: Rule[], monthKey: string): DueBill[] {
  const dim = daysInMonth(monthKey)
  const due: DueBill[] = []
  for (const r of rules) {
    if (r.paused) continue
    // the day as the rule runs it: its 31st is a 30-day month's 30th (nextMonthlyOccurrence)
    const iso = `${monthKey}-${String(Math.min(Math.max(1, r.dayOfMonth), dim)).padStart(2, '0')}`
    if (r.nextRunISO <= iso) due.push({ dateISO: iso, amountMinor: r.amountMinor, categoryId: r.categoryId })
  }
  return due
}

/** The month's recurring payments, all of them or one tag's: what's logged so far, and what's still due. */
export interface Fixed {
  logged: number
  due: number
}

export function fixedOf(monthTxns: Txn[], due: DueBill[], categoryId?: string): Fixed {
  const mine = (c: string | null) => categoryId === undefined || c === categoryId
  return {
    logged: sum(monthTxns.filter((t) => isRecurring(t) && mine(t.categoryId))),
    due: due.reduce((a, b) => (mine(b.categoryId) ? a + b.amountMinor : a), 0)
  }
}

/** Same, split by account — what's actually in each wallet, including any manual starting balance. */
export function balanceByAccount(txns: Txn[], accounts: Account[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const a of accounts) m.set(a.id, a.openingBalanceMinor ?? 0)
  for (const t of txns) {
    const delta = isOut(t) ? -t.amountMinor : t.amountMinor
    m.set(t.accountId, (m.get(t.accountId) ?? 0) + delta)
  }
  return m
}

/** Net money in your hands right now — every account, income minus all outflow. Savings hasn't left you, so it still counts here. */
export function totalBalance(txns: Txn[], accounts: Account[]): number {
  let total = 0
  for (const v of balanceByAccount(txns, accounts).values()) total += v
  return total
}

/** Total money OUT — income never counts as spending. */
export function sum(txns: Txn[]): number {
  return txns.reduce((acc, t) => (isOut(t) ? acc + t.amountMinor : acc), 0)
}

export function incomeSum(txns: Txn[]): number {
  return txns.reduce((acc, t) => (!isOut(t) ? acc + t.amountMinor : acc), 0)
}

export function onDay(txns: Txn[], iso: string): Txn[] {
  return txns.filter((t) => t.dateISO === iso)
}

export function byCategory(txns: Txn[]): Map<string | null, number> {
  const m = new Map<string | null, number>()
  for (const t of txns) {
    if (!isOut(t)) continue
    m.set(t.categoryId, (m.get(t.categoryId) ?? 0) + t.amountMinor)
  }
  return m
}

export interface WeekBar {
  iso: string
  total: number
  isToday: boolean
  isFuture: boolean
}

export function weekBars(txns: Txn[], today = todayISO()): WeekBar[] {
  const days = weekDaysOf(today)
  return days.map((iso) => ({
    iso,
    total: sum(onDay(txns, iso)),
    isToday: iso === today,
    isFuture: iso > today
  }))
}

export interface SafeToSpend {
  hasBudget: boolean
  /** Allowance for today after earlier spending this month, with the month's recurring payments set aside. */
  dayAllowance: number
  /** Allowance minus today's spend, its recurring payments aside (can go negative). */
  remainingToday: number
  /** Everything spent today, a recurring payment too: the Today list's total, and "Spent today" without a budget. */
  spentToday: number
  /** Recurring payments logged today: set aside with the month's others, never taken from today's share. */
  fixedToday: number
}

/**
 * Today's share of what's left of the budget. The month's recurring payments come out of what's left before it's
 * shared over the days: today's (rent day isn't "over today") and every one still due (a bill on the 25th is put by
 * from now on, not met all at once on the 25th). Today's spend is then everything else spent today.
 * `due` is the month's recurring payments still due (stillDue); without recurring payments nothing changes.
 * WidgetData/TodayMoney.java works the same numbers out for the widget and the tile, to the paisa.
 */
export function safeToSpend(monthTxns: Txn[], monthlyBudget: number | null, todayIso = todayISO(), due: DueBill[] = []): SafeToSpend {
  const todays = onDay(monthTxns, todayIso)
  const spentToday = sum(todays)
  const fixedToday = sum(todays.filter(isRecurring))
  if (!monthlyBudget || monthlyBudget <= 0) {
    return { hasBudget: false, dayAllowance: 0, remainingToday: 0, spentToday, fixedToday }
  }
  const monthKey = todayIso.slice(0, 7)
  const dim = daysInMonth(monthKey)
  const dayOfMonth = parseInt(todayIso.slice(8, 10), 10)
  const spentBeforeToday = sum(monthTxns.filter((t) => t.dateISO < todayIso))
  const setAside = fixedToday + due.reduce((a, b) => (b.dateISO.startsWith(monthKey) ? a + b.amountMinor : a), 0)
  const daysLeftInclToday = dim - dayOfMonth + 1
  const dayAllowance = Math.max(0, Math.floor((monthlyBudget - spentBeforeToday - setAside) / daysLeftInclToday / 100) * 100)
  return { hasBudget: true, dayAllowance, remainingToday: dayAllowance - (spentToday - fixedToday), spentToday, fixedToday }
}

export interface PaceInfo {
  spent: number
  budget: number
  fraction: number
  dayFraction: number
  /** What the budget expects spent by today: the recurring payments logged so far, and the day's share of the rest */
  expected: number
  /** The same, as a share of the budget: where the pace tick sits */
  expectedFraction: number
  state: 'ok' | 'warn' | 'over'
}

const NO_FIXED: Fixed = { logged: 0, due: 0 }

/**
 * state is pace-relative, not a static fraction cutoff — "warn" means
 * spending faster than the days elapsed would predict, the same comparison
 * the pace label text uses, so the color and the words never disagree.
 * The month's recurring payments (fixedOf) aren't spread over its days: rent
 * paid on the 1st is expected on the 1st, and a bill due on the 25th leaves
 * the rest of the budget smaller from the start.
 */
export function pace(spent: number, budget: number, todayIso = todayISO(), fixed: Fixed = NO_FIXED): PaceInfo {
  const monthKey = todayIso.slice(0, 7)
  const dayFraction = parseInt(todayIso.slice(8, 10), 10) / daysInMonth(monthKey)
  const fraction = budget > 0 ? spent / budget : 0
  const expected = fixed.logged + (budget - fixed.logged - fixed.due) * dayFraction
  // worked out as shares, so without recurring payments it is the day's share itself, to the last digit
  const expectedFraction = budget > 0 ? fixed.logged / budget + (1 - (fixed.logged + fixed.due) / budget) * dayFraction : dayFraction
  const state: PaceInfo['state'] = fraction > 1 ? 'over' : fraction > expectedFraction + 0.05 ? 'warn' : 'ok'
  return { spent, budget, fraction, dayFraction, expected, expectedFraction, state }
}

export interface SaveSuggestion {
  amountMinor: number
  /** under-pace = today's unspent allowance; steady = a gentle daily habit */
  reason: 'under-pace' | 'steady'
  /** days of saving at this rate until the goal is full */
  daysToGoal: number | null
}

/**
 * How much could go into savings today. With a budget: whatever of today's
 * allowance is still unspent (rounded to a clean step). Without one: a steady
 * 10% of the recent daily spend. Only suggested while a goal wants money.
 */
export function saveSuggestion(
  sts: SafeToSpend,
  avgDailySpend: number,
  goalRemaining: number
): SaveSuggestion | null {
  if (goalRemaining <= 0) return null
  const step = 1000 // ₹10 steps — clean numbers people actually move
  let amountMinor = 0
  let reason: SaveSuggestion['reason'] = 'under-pace'
  if (sts.hasBudget && sts.remainingToday >= 2 * step) {
    amountMinor = Math.floor(sts.remainingToday / step) * step
  } else if (avgDailySpend > 0) {
    amountMinor = Math.max(step, Math.floor((avgDailySpend * 0.1) / step) * step)
    reason = 'steady'
  }
  if (amountMinor <= 0) return null
  amountMinor = Math.min(amountMinor, goalRemaining)
  return {
    amountMinor,
    reason,
    daysToGoal: amountMinor > 0 ? Math.ceil(goalRemaining / amountMinor) : null
  }
}

/**
 * Where the month will land: its recurring payments as they are (logged, and still due), and the rest of the spending
 * so far in a straight line to the month's end. Rent paid on the 1st is paid once, not every day.
 */
export function projectMonth(monthTxns: Txn[], monthKey: string, todayIso = todayISO(), due: DueBill[] = []): number {
  const spent = sum(monthTxns)
  if (!todayIso.startsWith(monthKey)) return spent
  const day = parseInt(todayIso.slice(8, 10), 10)
  if (day === 0) return spent
  const fixed = fixedOf(monthTxns, due)
  return Math.round((fixed.logged + fixed.due + ((spent - fixed.logged) / day) * daysInMonth(monthKey)) / 100) * 100
}

export function groupByDay(txns: Txn[]): { iso: string; total: number; txns: Txn[] }[] {
  const map = new Map<string, Txn[]>()
  for (const t of txns) {
    const list = map.get(t.dateISO)
    if (list) list.push(t)
    else map.set(t.dateISO, [t])
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([iso, list]) => ({ iso, total: sum(list), txns: list.sort((a, b) => b.ts - a.ts) }))
}
