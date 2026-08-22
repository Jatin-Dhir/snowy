import type { Txn } from './db'
import { daysInMonth, todayISO, weekDaysOf } from '../lib/dates'

export function isOut(t: Txn): boolean {
  return (t.kind ?? 'out') === 'out'
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
