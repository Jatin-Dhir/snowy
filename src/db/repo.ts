import { db, type Txn } from './db'
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
    deleted: 0
  }
  await db.txns.add(txn)
  return txn
}

export async function updateTxn(id: string, patch: Partial<Txn>): Promise<void> {
  // a hand-edited amount is a new fact in the current currency — the stored
  // pre-conversion original no longer describes it
  const clearBase = patch.amountMinor !== undefined ? { baseMinor: null, baseCurrency: null } : {}
  await db.txns.update(id, { ...patch, ...clearBase, updatedAt: Date.now() })
}

export async function softDeleteTxn(id: string): Promise<void> {
  await db.txns.update(id, { deleted: 1, updatedAt: Date.now() })
}

export async function restoreTxn(id: string): Promise<void> {
  await db.txns.update(id, { deleted: 0, updatedAt: Date.now() })
}

export async function removeTxnPermanently(id: string): Promise<void> {
  await db.txns.delete(id)
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

export async function allLiveTxns(): Promise<Txn[]> {
  const rows = await db.txns.toArray()
  return rows.filter((t) => !t.deleted).sort((a, b) => b.ts - a.ts)
}
