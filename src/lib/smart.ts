// On-device intelligence: note-memory categorization, anomaly detection,
// and generated insight notes. Deterministic, instant, fully offline.
import type { Category, Txn } from '../db/db'
import { isOut, sum } from '../db/stats'
import { addDaysISO, daysInMonth, fromISO, todayISO, weekDaysOf } from './dates'
import { formatMinor } from './money'

function normalize(note: string): string {
  return note.trim().toLowerCase().replace(/\s+/g, ' ')
}

function tokens(note: string): string[] {
  return normalize(note)
    .split(/[^a-z0-9ऀ-ॿ]+/)
    .filter((w) => w.length >= 3)
}

/**
 * Guess the tag for a note from the user's own history:
 * exact note matches win, then any-shared-word matches, recency-weighted.
 */
export function guessCategory(note: string, txns: Txn[]): string | null {
  const norm = normalize(note)
  if (!norm) return null
  const words = new Set(tokens(note))
  const now = Date.now()
  const scores = new Map<string, number>()

  for (const t of txns) {
    if (!t.categoryId || !t.note) continue
    const decay = Math.exp(-(now - t.ts) / (90 * 86400000))
    const tNorm = normalize(t.note)
    let s = 0
    if (tNorm === norm) s = 10
    else if (tNorm.includes(norm) || norm.includes(tNorm)) s = 6
    else {
      const overlap = tokens(t.note).filter((w) => words.has(w)).length
      if (overlap > 0) s = 2 * overlap
    }
    if (s > 0) scores.set(t.categoryId, (scores.get(t.categoryId) ?? 0) + s * (0.4 + decay))
  }

  let best: string | null = null
  let bestScore = 0
  for (const [id, s] of scores) {
    if (s > bestScore) {
      best = id
      bestScore = s
    }
  }
  return bestScore >= 2 ? best : null
}

export interface Anomaly {
  categoryId: string
  name: string
  ratio: number
  thisWeek: number
}

/** Categories running ≥1.8× their trailing 4-week average this week. */
export function weeklyAnomalies(txns: Txn[], categories: Category[], today = todayISO()): Anomaly[] {
  const week = weekDaysOf(today)
  const weekStart = week[0]
  const out: Anomaly[] = []

  for (const cat of categories) {
    if (cat.archived) continue
    const catTx = txns.filter((t) => isOut(t) && t.categoryId === cat.id)
    const thisWeek = sum(catTx.filter((t) => t.dateISO >= weekStart && t.dateISO <= today))
    if (thisWeek < 50000) continue // ignore small numbers (< ₹500)
    let prior = 0
    let weeksWithData = 0
    for (let w = 1; w <= 4; w++) {
      const start = addDaysISO(weekStart, -7 * w)
      const end = addDaysISO(weekStart, -7 * (w - 1) - 1)
      const total = sum(catTx.filter((t) => t.dateISO >= start && t.dateISO <= end))
      if (total > 0) weeksWithData++
      prior += total
    }
    if (weeksWithData < 2) continue
    // average over the weeks that actually have data, so short histories
    // don't produce false "2x your usual" alerts
    const avg = prior / weeksWithData
    if (avg > 0 && thisWeek >= avg * 1.8) {
      out.push({ categoryId: cat.id, name: cat.name, ratio: thisWeek / avg, thisWeek })
    }
  }
  return out.sort((a, b) => b.ratio - a.ratio).slice(0, 2)
}

export interface AdviceInput {
  monthTxns: Txn[]
  monthKey: string
  categories: Category[]
  budgets: { id: string; amountMinor: number }[]
  rulesMonthly: number
  currency: string
}

/** Personalised, rule-based "how to improve" tips — all computed on-device. */
export function adviceFor({ monthTxns, monthKey, categories, budgets, rulesMonthly, currency }: AdviceInput): string[] {
  const outs = monthTxns.filter(isOut)
  const spent = sum(outs)
  if (spent <= 0) return ['Log a few expenses first — the more Spendy sees, the sharper the advice gets.']
  const tips: string[] = []

  const totals = new Map<string, number>()
  for (const t of outs) {
    if (t.categoryId) totals.set(t.categoryId, (totals.get(t.categoryId) ?? 0) + t.amountMinor)
  }
  const top = [...totals.entries()].sort((a, b) => b[1] - a[1])[0]
  if (top) {
    const cat = categories.find((c) => c.id === top[0])
    const share = Math.round((top[1] / spent) * 100)
    if (cat && share >= 35) {
      const hasBudget = budgets.some((b) => b.id === cat.id)
      tips.push(
        hasBudget
          ? `${cat.name} is ${share}% of your spending — it decides your month. Watch its pace line first.`
          : `${cat.name} is ${share}% of your spending and has no budget. Cap it and most of your month is under control.`
      )
    }
  }

  const overall = budgets.find((b) => b.id === 'overall')
  const today = todayISO()
  const isCurrentMonth = monthKey === today.slice(0, 7)
  if (overall) {
    if (isCurrentMonth) {
      const day = Math.max(1, parseInt(today.slice(8, 10), 10))
      const dim = daysInMonth(monthKey)
      const projected = Math.round((spent / day) * dim)
      const daysLeft = Math.max(1, dim - day + 1)
      if (projected > overall.amountMinor) {
        tips.push(
          `At today's pace you'd land around ${formatMinor(projected, currency)} — over your ${formatMinor(overall.amountMinor, currency)} budget. Trimming ${formatMinor(Math.ceil((projected - overall.amountMinor) / daysLeft / 100) * 100, currency)} a day closes the gap.`
        )
      }
    } else if (spent > overall.amountMinor) {
      tips.push(
        `This month closed ${formatMinor(spent - overall.amountMinor, currency)} over the ${formatMinor(overall.amountMinor, currency)} budget. Worth planning the current month with that in mind.`
      )
    }
  } else {
    tips.push('No monthly budget set — one number in Budgets unlocks safe-to-spend and pace warnings.')
  }

  const weekend = sum(outs.filter((t) => [0, 6].includes(fromISO(t.dateISO).getDay())))
  const weekendPct = Math.round((weekend / spent) * 100)
  if (weekendPct >= 45) {
    tips.push(`${weekendPct}% of spending happens on weekends. Deciding a weekend number on Friday beats regretting it on Monday.`)
  }

  if (rulesMonthly > 0 && rulesMonthly / spent >= 0.15) {
    tips.push(
      `Subscriptions and fixed payments are ${formatMinor(rulesMonthly, currency)}/month — ${formatMinor(rulesMonthly * 12, currency)} a year. Cancel one you barely use and it compounds quietly.`
    )
  }

  const small = outs.filter((t) => t.amountMinor <= 20000)
  if (small.length >= 12) {
    tips.push(
      `${small.length} small expenses under ${formatMinor(20000, currency)} added up to ${formatMinor(sum(small), currency)}. Little leaks sink the ship — pick one to skip daily.`
    )
  }

  const untagged = outs.filter((t) => !t.categoryId).length
  if (untagged >= 3) {
    tips.push(`${untagged} expenses are untagged, which blurs every chart here. A quick pass in Activity fixes it.`)
  }

  const income = sum(monthTxns.filter((t) => !isOut(t)))
  if (income > spent) {
    const kept = Math.round(((income - spent) / income) * 100)
    tips.push(`You kept ${kept}% of what came in this month. Move it somewhere it can't be spent by accident.`)
  }

  return tips.slice(0, 5)
}

/** Short generated observations about a month of spending. */
export function smartNotes(monthTxns: Txn[], categories: Category[], currency: string): string[] {
  const outs = monthTxns.filter(isOut)
  if (outs.length < 3) return []
  const notes: string[] = []

  const biggest = [...outs].sort((a, b) => b.amountMinor - a.amountMinor)[0]
  if (biggest) {
    const cat = categories.find((c) => c.id === biggest.categoryId)
    const label = biggest.note.trim() || cat?.name || 'one expense'
    const day = fromISO(biggest.dateISO).toLocaleString('en-IN', { weekday: 'long' })
    notes.push(`Biggest hit: ${label} — ${formatMinor(biggest.amountMinor, currency)} on a ${day}.`)
  }

  const noteCounts = new Map<string, number>()
  for (const t of outs) {
    const n = normalize(t.note)
    if (n) noteCounts.set(n, (noteCounts.get(n) ?? 0) + 1)
  }
  const topNote = [...noteCounts.entries()].sort((a, b) => b[1] - a[1])[0]
  if (topNote && topNote[1] >= 3) {
    notes.push(`Most frequent: ${topNote[0]} — ${topNote[1]} times this month.`)
  }

  const weekend = sum(outs.filter((t) => [0, 6].includes(fromISO(t.dateISO).getDay())))
  const total = sum(outs)
  if (total > 0) {
    const pct = Math.round((weekend / total) * 100)
    if (pct >= 45) notes.push(`Weekends carry ${pct}% of your spending.`)
  }

  const untagged = outs.filter((t) => !t.categoryId).length
  if (untagged >= 3) notes.push(`${untagged} expenses are untagged — tap them in Activity to file them.`)

  return notes.slice(0, 3)
}
