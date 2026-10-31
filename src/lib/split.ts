// Who owes whom on a trip. Amounts are integer minor units, so a split always
// adds back up to exactly what was spent and every balance nets to zero.
import type { TripEntry, TripPayment, TripPerson } from '../db/db'

/** The phone's owner, in every trip's people. */
export const ME = 'me'

// less than this isn't worth anyone's time: it's the rounding of a currency switch, not a debt
const SQUARE_BELOW = 50

/** Evenly, with the leftover paise going one each to the first people. */
export function splitEvenly(amountMinor: number, among: string[]): Map<string, number> {
  const shares = new Map<string, number>()
  if (among.length === 0) return shares
  const base = Math.floor(amountMinor / among.length)
  const extra = amountMinor - base * among.length
  among.forEach((id, i) => shares.set(id, base + (i < extra ? 1 : 0)))
  return shares
}

export function shareOf(entry: Pick<TripEntry, 'amountMinor' | 'among'>, personId: string): number {
  return splitEvenly(entry.amountMinor, entry.among).get(personId) ?? 0
}

export interface PersonBalance {
  id: string
  name: string
  /** put down for spends */
  paid: number
  /** what their part of the spends came to */
  share: number
  /** above zero they get money back, below zero they owe it */
  net: number
}

export function balances(
  people: TripPerson[],
  entries: Pick<TripEntry, 'amountMinor' | 'paidBy' | 'among'>[],
  payments: Pick<TripPayment, 'from' | 'to' | 'amountMinor'>[]
): PersonBalance[] {
  const rows = new Map<string, PersonBalance>(people.map((p) => [p.id, { id: p.id, name: p.name, paid: 0, share: 0, net: 0 }]))
  const row = (id: string) => {
    let r = rows.get(id)
    if (!r) {
      r = { id, name: id, paid: 0, share: 0, net: 0 }
      rows.set(id, r)
    }
    return r
  }
  for (const e of entries) {
    row(e.paidBy).paid += e.amountMinor
    for (const [id, share] of splitEvenly(e.amountMinor, e.among)) row(id).share += share
  }
  for (const r of rows.values()) r.net = r.paid - r.share
  for (const p of payments) {
    row(p.from).net += p.amountMinor
    row(p.to).net -= p.amountMinor
  }
  return [...rows.values()]
}

export interface Transfer {
  from: string
  to: string
  amountMinor: number
}

/**
 * The payments that square everyone up: two people who owe each other the same
 * amount pay directly, then the biggest debt goes to the biggest creditor until
 * nothing's left. Never more than one payment fewer than there are people.
 */
export function whoPaysWhom(rows: Pick<PersonBalance, 'id' | 'net'>[]): Transfer[] {
  const owe = rows.filter((r) => r.net <= -SQUARE_BELOW).map((r) => ({ id: r.id, left: -r.net }))
  const get = rows.filter((r) => r.net >= SQUARE_BELOW).map((r) => ({ id: r.id, left: r.net }))
  const out: Transfer[] = []
  for (const o of owe) {
    const match = get.find((g) => g.left === o.left)
    if (!match) continue
    out.push({ from: o.id, to: match.id, amountMinor: o.left })
    o.left = 0
    match.left = 0
  }
  for (;;) {
    const debtor = owe.filter((o) => o.left >= SQUARE_BELOW).sort((a, b) => b.left - a.left)[0]
    const creditor = get.filter((g) => g.left >= SQUARE_BELOW).sort((a, b) => b.left - a.left)[0]
    if (!debtor || !creditor) return out
    const amountMinor = Math.min(debtor.left, creditor.left)
    out.push({ from: debtor.id, to: creditor.id, amountMinor })
    debtor.left -= amountMinor
    creditor.left -= amountMinor
  }
}

export interface TripSummary {
  total: number
  balances: PersonBalance[]
  transfers: Transfer[]
  /** the owner's position: above zero they get money back */
  mine: number
  /** spent per tag, biggest first */
  byCategory: { categoryId: string | null; total: number }[]
}

export function summarize(people: TripPerson[], entries: TripEntry[], payments: TripPayment[]): TripSummary {
  const live = entries.filter((e) => !e.deleted)
  const rows = balances(people, live, payments)
  const perCategory = new Map<string | null, number>()
  for (const e of live) perCategory.set(e.categoryId, (perCategory.get(e.categoryId) ?? 0) + e.amountMinor)
  const transfers = whoPaysWhom(rows)
  return {
    total: live.reduce((a, e) => a + e.amountMinor, 0),
    balances: rows,
    transfers,
    mine: rows.find((r) => r.id === ME)?.net ?? 0,
    byCategory: [...perCategory.entries()].map(([categoryId, total]) => ({ categoryId, total })).sort((a, b) => b.total - a.total)
  }
}
