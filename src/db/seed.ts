import { db, type Category } from './db'

/** Everyday basics — broad buckets people actually think in. */
export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'food', name: 'Food', color: '#E0784F', icon: 'fork', sort: 0 },
  { id: 'groceries', name: 'Groceries', color: '#5FA463', icon: 'cart', sort: 1 },
  { id: 'shopping', name: 'Shopping', color: '#C29A3A', icon: 'bag', sort: 2 },
  { id: 'online', name: 'Online', color: '#6C7FE0', icon: 'globe', sort: 3 },
  { id: 'transport', name: 'Transport', color: '#4FA3C7', icon: 'bus', sort: 4 },
  { id: 'bills', name: 'Bills & recharge', color: '#B0764A', icon: 'receipt', sort: 5 },
  { id: 'people', name: 'People', color: '#C75D8D', icon: 'person', sort: 6 },
  { id: 'entertainment', name: 'Entertainment', color: '#9A6FD0', icon: 'film', sort: 7 },
  { id: 'health', name: 'Health', color: '#4FAF9B', icon: 'heart', sort: 8 },
  { id: 'rent', name: 'Rent', color: '#B65C50', icon: 'homecat', sort: 9 },
  { id: 'salary', name: 'Salary', color: '#4D82F3', icon: 'wallet', sort: 10 },
  { id: 'payment', name: 'Payment', color: '#5B8DE0', icon: 'arrowDown', sort: 11 },
  { id: 'return', name: 'Return', color: '#4FAF9B', icon: 'refresh', sort: 12 },
  { id: 'other', name: 'Other', color: '#7A8794', icon: 'dots', sort: 13 }
]

export const TAG_COLORS = [
  '#E0784F', '#5FA463', '#C29A3A', '#6C7FE0', '#4FA3C7', '#B0764A',
  '#C75D8D', '#9A6FD0', '#4FAF9B', '#B65C50', '#4D82F3', '#7A8794'
]

export const TAG_ICONS = [
  'fork', 'coffee', 'cart', 'bag', 'globe', 'bus', 'receipt', 'person',
  'film', 'heart', 'homecat', 'wallet', 'refresh', 'dots'
]

export async function ensureSeeded(): Promise<void> {
  const existing = await db.categories.toArray()
  if (existing.length === 0) {
    await db.categories.bulkPut(DEFAULT_CATEGORIES)
    return
  }
  // Older installs: bring in the everyday basics they're missing, without
  // touching anything the user already has or renamed.
  const have = new Set(existing.map((c) => c.id))
  const maxSort = Math.max(...existing.map((c) => c.sort), 0)
  const missing = DEFAULT_CATEGORIES.filter((c) => !have.has(c.id)).map((c, i) => ({
    ...c,
    sort: maxSort + 1 + i
  }))
  if (missing.length > 0) await db.categories.bulkPut(missing)
}
