import { db, type Goal, type Txn } from './db'
import { monthRange, todayISO } from '../lib/dates'

export interface NewTxn {
  amountMinor: number
  currency: string
  categoryId: string | null
  accountId: string
  kind?: 'out' | 'in'
  note?: string
  dateISO?: string
  ts?: number
  source?: 'manual' | 'recurring'
  /** a savings goal's Add or Take out, or Home's tuck-away: the goal the money went into or came out of */
  goalId?: string | null
}

export async function addTxn(input: NewTxn): Promise<Txn> {
  const now = Date.now()
  const txn: Txn = {
    id: crypto.randomUUID(),
    amountMinor: input.amountMinor,
    currency: input.currency,
    categoryId: input.categoryId,
    accountId: input.accountId,
    kind: input.kind ?? 'out',
    note: input.note ?? '',
    dateISO: input.dateISO ?? todayISO(),
    ts: input.ts ?? now,
    source: input.source ?? 'manual',
    createdAt: now,
    updatedAt: now,
    deleted: 0,
    goalId: input.goalId ?? null
  }
  await db.txns.add(txn)
  return txn
}

export async function updateTxn(id: string, patch: Partial<Txn>): Promise<void> {
  await db.transaction('rw', [db.txns, db.goals], async () => {
    // a hand-edited amount is a new fact in the current currency — the stored
    // pre-conversion original no longer describes it. The edit sheet sends the
    // amount back with every save, so only a different one counts
    const was = await db.txns.get(id)
    const changed = patch.amountMinor !== undefined && patch.amountMinor !== was?.amountMinor
    const clearBase = changed ? { baseMinor: null, baseCurrency: null } : {}
    // the goal follows its entry: a new amount moves it by the difference, and a new tag or direction is the entry
    // taken out and put in again. An older entry found its goal by its note; it keeps that goal from now on, so a
    // new note can't carry its money off
    const goal = was ? await goalOf(was) : undefined
    const pin = was && was.goalId === undefined ? { goalId: goal?.id ?? null } : {}
    await db.txns.update(id, { ...patch, ...clearBase, ...pin, updatedAt: Date.now() })
    const delta = was && goal ? heldInGoal({ ...was, ...patch }) - heldInGoal(was) : 0
    if (goal && delta) await moveGoal(goal, delta)
  })
}

/** What a live entry holds in its goal: spent on the savings tag, its amount; received there, minus it; else nothing */
function heldInGoal(t: Pick<Txn, 'categoryId' | 'kind' | 'amountMinor' | 'deleted'>): number {
  if (t.deleted || t.categoryId !== 'savings') return 0
  return (t.kind ?? 'out') === 'out' ? t.amountMinor : -t.amountMinor
}

/**
 * The goal a savings entry moved money into or out of: the one it names. An entry from before entries named their
 * goal belongs to the goal its note names (the goal's own buttons wrote its name there), when only one goal has that
 * name and that goal was there when the entry was made.
 */
async function goalOf(t: Txn): Promise<Goal | undefined> {
  if (t.goalId) return db.goals.get(t.goalId)
  // your share of a trip spend never went into a goal, whatever its tag and note
  if (t.goalId === null || t.categoryId !== 'savings' || t.tripEntryId) return undefined
  const named = (await db.goals.toArray()).filter((g) => g.name === t.note.trim() && g.createdAt <= t.createdAt)
  return named.length === 1 ? named[0] : undefined
}

/** What deleting an entry did to its goal, so its Undo puts back exactly that (a goal never goes below nothing) */
const goalUndo = new Map<string, { goalId: string; deltaMinor: number }>()

async function moveGoal(goal: Goal, deltaMinor: number): Promise<number> {
  const savedMinor = Math.max(0, goal.savedMinor + deltaMinor)
  await db.goals.update(goal.id, { savedMinor, baseSavedMinor: null, updatedAt: Date.now() })
  return savedMinor - goal.savedMinor
}

// your share of a trip spend and the spend itself are one fact: when one goes, so does the other. Money put into a
// goal and the goal are another: a deleted savings entry's money leaves its goal (a take-out's goes back in)
export async function softDeleteTxn(id: string): Promise<void> {
  await db.transaction('rw', [db.txns, db.tripEntries, db.goals], async () => {
    const t = await db.txns.get(id)
    await db.txns.update(id, { deleted: 1, updatedAt: Date.now() })
    if (t?.tripEntryId) await db.tripEntries.update(t.tripEntryId, { deleted: 1, updatedAt: Date.now() })
    // off the savings tag it gave its money back when it was moved off
    const added = t ? heldInGoal(t) : 0
    const goal = t && added ? await goalOf(t) : undefined
    if (goal) goalUndo.set(id, { goalId: goal.id, deltaMinor: await moveGoal(goal, -added) })
  })
}

export async function restoreTxn(id: string): Promise<void> {
  await db.transaction('rw', [db.txns, db.tripEntries, db.goals], async () => {
    const t = await db.txns.get(id)
    await db.txns.update(id, { deleted: 0, updatedAt: Date.now() })
    if (t?.tripEntryId) await db.tripEntries.update(t.tripEntryId, { deleted: 0, updatedAt: Date.now() })
    const undo = goalUndo.get(id)
    goalUndo.delete(id)
    const goal = t?.deleted && undo ? await db.goals.get(undo.goalId) : undefined
    if (goal && undo) await moveGoal(goal, -undo.deltaMinor)
  })
}

export async function removeTxnPermanently(id: string): Promise<void> {
  await db.transaction('rw', db.txns, db.tripEntries, async () => {
    const entryId = (await db.txns.get(id))?.tripEntryId
    await db.txns.delete(id)
    if (entryId) await db.tripEntries.delete(entryId)
  })
}

/** All live transactions in a month, newest first. */
export async function txnsForMonth(monthKey: string): Promise<Txn[]> {
  const { from, to } = monthRange(monthKey)
  const rows = await db.txns.where('dateISO').between(from, to, true, true).toArray()
  return rows.filter((t) => !t.deleted).sort((a, b) => b.ts - a.ts)
}

export async function txnsBetween(fromISO: string, toISO: string): Promise<Txn[]> {
  const rows = await db.txns.where('dateISO').between(fromISO, toISO, true, true).toArray()
  return rows.filter((t) => !t.deleted).sort((a, b) => b.ts - a.ts)
}

/** Most recent live transactions (for Activity + frequents learning). */
export async function recentTxns(limit = 1500): Promise<Txn[]> {
  const rows = await db.txns.orderBy('ts').reverse().limit(limit * 2).toArray()
  return rows.filter((t) => !t.deleted).slice(0, limit)
}

/** Every month with a live entry in it, and what went out that month: "2026-11" → minor units. */
export async function spendByMonth(): Promise<Map<string, number>> {
  const totals = new Map<string, number>()
  for (const t of await db.txns.toArray()) {
    if (t.deleted) continue
    const key = t.dateISO.slice(0, 7)
    totals.set(key, (totals.get(key) ?? 0) + ((t.kind ?? 'out') === 'out' ? t.amountMinor : 0))
  }
  return totals
}

export async function allLiveTxns(): Promise<Txn[]> {
  const rows = await db.txns.toArray()
  return rows.filter((t) => !t.deleted).sort((a, b) => b.ts - a.ts)
}
