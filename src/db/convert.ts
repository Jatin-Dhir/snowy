import { db } from './db'

/**
 * Convert every stored amount to a new currency at the given rate, in one
 * transaction. Each record remembers its original amount+currency the first
 * time it is converted; converting back to that currency restores the exact
 * original figure — so a rupee borrowed stays the same rupee, no matter how
 * many round trips the market takes. Bases are cleared only when the user
 * edits the amount itself.
 */
export async function convertEverything(rate: number, oldCurrency: string, newCurrency: string): Promise<number> {
  const cv = (minor: number) => Math.round(minor * rate)

  /** returns [newAmount, baseMinor, baseCurrency] honouring a stored base */
  function step(amountMinor: number, baseMinor: number | null | undefined, baseCurrency: string | null | undefined, rowCurrency: string): [number, number, string] {
    if (baseCurrency != null && baseMinor != null && baseCurrency === newCurrency) {
      return [baseMinor, baseMinor, baseCurrency]
    }
    if (baseCurrency != null && baseMinor != null) {
      return [cv(amountMinor), baseMinor, baseCurrency]
    }
    return [cv(amountMinor), amountMinor, rowCurrency]
  }

  let count = 0
  await db.transaction('rw', [db.txns, db.budgets, db.rules, db.loans, db.goals], async () => {
    const txns = await db.txns.toArray()
    await db.txns.bulkPut(
      txns.map((t) => {
        const [amountMinor, baseMinor, baseCurrency] = step(t.amountMinor, t.baseMinor, t.baseCurrency, t.currency)
        return { ...t, amountMinor, baseMinor, baseCurrency, currency: newCurrency }
      })
    )
    count = txns.length
    const budgets = await db.budgets.toArray()
    await db.budgets.bulkPut(
      budgets.map((b) => {
        const [amountMinor, baseMinor, baseCurrency] = step(b.amountMinor, b.baseMinor, b.baseCurrency, oldCurrency)
        return { ...b, amountMinor, baseMinor, baseCurrency }
      })
    )
    const rules = await db.rules.toArray()
    await db.rules.bulkPut(
      rules.map((r) => {
        const [amountMinor, baseMinor, baseCurrency] = step(r.amountMinor, r.baseMinor, r.baseCurrency, oldCurrency)
        return { ...r, amountMinor, baseMinor, baseCurrency }
      })
    )
    const loans = await db.loans.toArray()
    await db.loans.bulkPut(
      loans.map((l) => {
        const [amountMinor, baseMinor, baseCurrency] = step(l.amountMinor, l.baseMinor, l.baseCurrency, l.currency)
        return { ...l, amountMinor, baseMinor, baseCurrency, currency: newCurrency }
      })
    )
    const goals = await db.goals.toArray()
    await db.goals.bulkPut(
      goals.map((g) => {
        const [targetMinor, baseTargetMinor, baseCurrency] = step(g.targetMinor, g.baseTargetMinor, g.baseCurrency, oldCurrency)
        const [savedMinor, baseSavedMinor] = step(g.savedMinor, g.baseSavedMinor, g.baseCurrency, oldCurrency)
        return { ...g, targetMinor, savedMinor, baseTargetMinor, baseSavedMinor, baseCurrency }
      })
    )
  })
  return count
}
