import type { Category, Txn } from './db'

/**
 * Rank categories for the Add sheet: same hour-of-day window scores highest,
 * same weekday helps, overall frequency breaks ties, everything decays with age.
 */
export function suggestCategories(txns: Txn[], categories: Category[], now = new Date()): Category[] {
  const hour = now.getHours()
  const weekday = now.getDay()
  const nowMs = now.getTime()
  const score = new Map<string, number>()

  for (const t of txns) {
    if (!t.categoryId) continue
    const age = (nowMs - t.ts) / 86400000
    if (age > 90) continue
    const decay = Math.exp(-age / 30)
    const d = new Date(t.ts)
    let s = 0.5 * decay
    const hourDiff = Math.min(Math.abs(d.getHours() - hour), 24 - Math.abs(d.getHours() - hour))
    if (hourDiff <= 2) s += 3 * decay
    if (d.getDay() === weekday) s += 1 * decay
    score.set(t.categoryId, (score.get(t.categoryId) ?? 0) + s)
  }

  const bySort = [...categories].sort((a, b) => a.sort - b.sort)
  const ranked = [...bySort].sort((a, b) => (score.get(b.id) ?? 0) - (score.get(a.id) ?? 0))
  return ranked
}

export interface Frequent {
  key: string
  label: string
  amountMinor: number
  categoryId: string | null
  accountId: string
  count: number
  lastTs: number
}

/** One-tap tiles, learned: same (category, note, amount) seen 2+ times in 60 days. */
export function learnFrequents(txns: Txn[], categories: Category[], max = 3): Frequent[] {
  const cutoff = Date.now() - 60 * 86400000
  const groups = new Map<string, Frequent>()
  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? 'Expense'

  for (const t of txns) {
    if (t.ts < cutoff || t.source !== 'manual' || t.categoryId === 'savings') continue
    const key = `${t.categoryId ?? ''}|${t.note.trim().toLowerCase()}|${t.amountMinor}`
    const existing = groups.get(key)
    if (existing) {
      existing.count++
      existing.lastTs = Math.max(existing.lastTs, t.ts)
    } else {
      groups.set(key, {
        key,
        label: t.note.trim() || catName(t.categoryId),
        amountMinor: t.amountMinor,
        categoryId: t.categoryId,
        accountId: t.accountId,
        count: 1,
        lastTs: t.ts
      })
    }
  }

  return [...groups.values()]
    .filter((f) => f.count >= 2)
    .sort((a, b) => b.count - a.count || b.lastTs - a.lastTs)
    .slice(0, max)
}
