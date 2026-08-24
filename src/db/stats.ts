import type { Account, Txn } from './db'
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
  /** Allowance for today after earlier spending this month. */
  dayAllowance: number
  /** Allowance minus today's spend (can go negative). */
  remainingToday: number
  spentToday: number
}

export function safeToSpend(monthTxns: Txn[], monthlyBudget: number | null, todayIso = todayISO()): SafeToSpend {
  const spentToday = sum(onDay(monthTxns, todayIso))
  if (!monthlyBudget || monthlyBudget <= 0) {
    return { hasBudget: false, dayAllowance: 0, remainingToday: 0, spentToday }
  }
  const monthKey = todayIso.slice(0, 7)
  const dim = daysInMonth(monthKey)
  const dayOfMonth = parseInt(todayIso.slice(8, 10), 10)
  const spentBeforeToday = sum(monthTxns.filter((t) => t.dateISO < todayIso))
  const daysLeftInclToday = dim - dayOfMonth + 1
  const dayAllowance = Math.max(0, Math.floor((monthlyBudget - spentBeforeToday) / daysLeftInclToday / 100) * 100)
  return { hasBudget: true, dayAllowance, remainingToday: dayAllowance - spentToday, spentToday }
}

export interface PaceInfo {
  spent: number
  budget: number
  fraction: number
  dayFraction: number
  state: 'ok' | 'warn' | 'over'
}

export function pace(spent: number, budget: number, todayIso = todayISO()): PaceInfo {
  const monthKey = todayIso.slice(0, 7)
  const dayFraction = parseInt(todayIso.slice(8, 10), 10) / daysInMonth(monthKey)
  const fraction = budget > 0 ? spent / budget : 0
  const state: PaceInfo['state'] = fraction > 1 ? 'over' : fraction >= 0.8 ? 'warn' : 'ok'
  return { spent, budget, fraction, dayFraction, state }
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

/** Straight-line end-of-month projection from spend so far. */
export function projectMonth(monthTxns: Txn[], monthKey: string, todayIso = todayISO()): number {
  const spent = sum(monthTxns)
  if (!todayIso.startsWith(monthKey)) return spent
  const day = parseInt(todayIso.slice(8, 10), 10)
  if (day === 0) return spent
  return Math.round(((spent / day) * daysInMonth(monthKey)) / 100) * 100
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
