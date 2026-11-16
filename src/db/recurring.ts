import { db, type Rule } from './db'
import { addTxn } from './repo'
import { daysInMonth, fromISO, nextMonthlyOccurrence, todayISO } from '../lib/dates'
import { formatMinor } from '../lib/money'

/** Logs every due recurring rule (catching up missed months), advances next runs. */
export async function runDueRules(currency: string): Promise<{ name: string; amountMinor: number }[]> {
  // one transaction: two starts at once (two tabs of the web app) queue up, and the second finds
  // the first's next runs already moved on, rather than logging every payment a second time
  return db.transaction('rw', db.rules, db.txns, async () => {
    const today = todayISO()
    const due = await db.rules.where('nextRunISO').belowOrEqual(today).toArray()
    const logged: { name: string; amountMinor: number }[] = []

    for (const rule of due) {
      if (rule.paused) {
        await db.rules.update(rule.id, { nextRunISO: nextMonthlyOccurrence(rule.dayOfMonth, today) })
        continue
      }
      let run = rule.nextRunISO
      let guard = 0
      while (run <= today && guard < 24) {
        await addTxn({
          amountMinor: rule.amountMinor,
          currency,
          categoryId: rule.categoryId,
          accountId: rule.accountId,
          note: rule.name,
          dateISO: run,
          ts: fromISO(run).getTime() + 12 * 3600000,
          source: 'recurring'
        })
        logged.push({ name: rule.name, amountMinor: rule.amountMinor })
        run = nextMonthlyOccurrence(rule.dayOfMonth, run)
        guard++
      }
      await db.rules.update(rule.id, { nextRunISO: run })
    }
    return logged
  })
}

/** What Taily says when it logs payments that fell due: one by name, several by count; null when it logged none. */
export function loggedNote(logged: { name: string; amountMinor: number }[], currency: string): string | null {
  if (logged.length === 1) return `Logged ${logged[0].name} — ${formatMinor(logged[0].amountMinor, currency)} (recurring)`
  if (logged.length > 1) return `Logged ${logged.length} recurring expenses`
  return null
}

export async function addRule(input: {
  name: string
  amountMinor: number
  categoryId: string | null
  dayOfMonth: number
}): Promise<Rule> {
  const today = todayISO()
  const dayNow = parseInt(today.slice(8, 10), 10)
  const nextRunISO =
    input.dayOfMonth >= dayNow
      ? nextMonthlyOccurrence(input.dayOfMonth, addDays(today, -1))
      : nextMonthlyOccurrence(input.dayOfMonth, today)
  const rule: Rule = {
    id: crypto.randomUUID(),
    name: input.name,
    amountMinor: input.amountMinor,
    categoryId: input.categoryId,
    accountId: 'upi',
    dayOfMonth: input.dayOfMonth,
    nextRunISO,
    paused: 0
  }
  await db.rules.add(rule)
  return rule
}

function addDays(iso: string, days: number): string {
  const d = fromISO(iso)
  d.setDate(d.getDate() + days)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Edit a rule's facts; a changed amount clears its conversion base. A changed day moves the payment the rule is
 * waiting to log to the new day of the same month: this month's once it's logged is next month's (rent logged on the
 * 1st and moved to the 20th isn't logged again on the 20th), and one still to come stays this month's even when its
 * new day has gone (an EMI moved from the 25th to the 10th is logged as the 10th's, not dropped for the month).
 */
export async function updateRule(
  id: string,
  patch: { name: string; amountMinor: number; categoryId: string | null; dayOfMonth: number }
): Promise<void> {
  const rule = await db.rules.get(id)
  if (!rule) return
  const month = rule.nextRunISO.slice(0, 7)
  const nextRunISO =
    patch.dayOfMonth === rule.dayOfMonth
      ? rule.nextRunISO
      : `${month}-${String(Math.min(Math.max(1, patch.dayOfMonth), daysInMonth(month))).padStart(2, '0')}`
  const clearBase = patch.amountMinor !== rule.amountMinor ? { baseMinor: null, baseCurrency: null } : {}
  await db.rules.update(id, { ...patch, ...clearBase, nextRunISO })
}

/** Returns the rule as it was, so the toast's Undo can put it back with restoreRule. */
export async function deleteRule(id: string): Promise<Rule | undefined> {
  const rule = await db.rules.get(id)
  await db.rules.delete(id)
  return rule
}

export async function restoreRule(rule: Rule): Promise<void> {
  await db.rules.put(rule)
}

export async function togglePauseRule(id: string): Promise<void> {
  const rule = await db.rules.get(id)
  if (rule) await db.rules.update(id, { paused: rule.paused ? 0 : 1 })
}

/** Rules due within the next `days` days — the Home nudge + Budgets bill strip. */
export function upcomingRules(rules: Rule[], days: number): Rule[] {
  const today = todayISO()
  const limit = addDays(today, days)
  return rules
    .filter((r) => !r.paused && r.nextRunISO > today && r.nextRunISO <= limit)
    .sort((a, b) => (a.nextRunISO < b.nextRunISO ? -1 : 1))
}
