import { db } from './db'

/**
 * Convert every stored amount to a new currency at the given rate —
 * transactions, budgets, recurring rules, loans, and savings goals — in one
 * transaction so a crash can't leave the ledger half-converted.
 */
export async function convertEverything(rate: number, newCurrency: string): Promise<number> {
  const cv = (minor: number) => Math.round(minor * rate)
  let count = 0
  await db.transaction('rw', [db.txns, db.budgets, db.rules, db.loans, db.goals], async () => {
    const txns = await db.txns.toArray()
    await db.txns.bulkPut(txns.map((t) => ({ ...t, amountMinor: cv(t.amountMinor), currency: newCurrency })))
    count = txns.length
    const budgets = await db.budgets.toArray()
    await db.budgets.bulkPut(budgets.map((b) => ({ ...b, amountMinor: cv(b.amountMinor) })))
    const rules = await db.rules.toArray()
    await db.rules.bulkPut(rules.map((r) => ({ ...r, amountMinor: cv(r.amountMinor) })))
    const loans = await db.loans.toArray()
    await db.loans.bulkPut(loans.map((l) => ({ ...l, amountMinor: cv(l.amountMinor), currency: newCurrency })))
    const goals = await db.goals.toArray()
    await db.goals.bulkPut(
      goals.map((g) => ({ ...g, targetMinor: cv(g.targetMinor), savedMinor: cv(g.savedMinor) }))
    )
  })
  return count
}
