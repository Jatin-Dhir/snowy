import Dexie, { type Table } from 'dexie'

export interface Txn {
  id: string
  amountMinor: number
  currency: string
  categoryId: string | null
  accountId: 'upi' | 'cash' | 'card'
  /** 'out' = money spent (default for old rows), 'in' = money received */
  kind?: 'out' | 'in'
  note: string
  dateISO: string
  ts: number
  source: 'manual' | 'recurring'
  createdAt: number
  updatedAt: number
  deleted: 0 | 1
}

export interface Category {
  id: string
  name: string
  color: string
  icon: string
  sort: number
  archived?: 0 | 1
}

export interface Budget {
  /** 'overall' for the whole month, else the categoryId. */
  id: string
  amountMinor: number
}

export interface Rule {
  id: string
  name: string
  amountMinor: number
  categoryId: string | null
  accountId: 'upi' | 'cash' | 'card'
  dayOfMonth: number
  nextRunISO: string
  paused: 0 | 1
}

export interface Loan {
  id: string
  /** 'lent' = they owe me, 'borrowed' = I owe them */
  direction: 'lent' | 'borrowed'
  person: string
  amountMinor: number
  currency: string
  lentISO: string
  remindISO: string | null
  settledISO: string | null
  createdAt: number
  updatedAt: number
}

export interface KV {
  key: string
  value: unknown
}

export interface Settings {
  initialized: boolean
  currency: string
  theme: 'light' | 'dark' | 'system'
  accent: string
  styleMode: 'soft' | 'clay' | 'bubble'
  haptics: boolean
  sounds: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  initialized: false,
  currency: 'INR',
  theme: 'light',
  accent: 'blue',
  styleMode: 'soft',
  haptics: true,
  sounds: true
}

class TallyDB extends Dexie {
  txns!: Table<Txn, string>
  categories!: Table<Category, string>
  budgets!: Table<Budget, string>
  rules!: Table<Rule, string>
  loans!: Table<Loan, string>
  kv!: Table<KV, string>

  constructor() {
    super('tally')
    this.version(1).stores({
      txns: 'id, dateISO, ts, categoryId, deleted',
      categories: 'id, sort',
      budgets: 'id',
      rules: 'id, nextRunISO',
      kv: 'key'
    })
    this.version(2).stores({
      loans: 'id, settledISO'
    })
  }
}

export const db = new TallyDB()

export async function getSettings(): Promise<Settings> {
  const row = await db.kv.get('settings')
  return { ...DEFAULT_SETTINGS, ...((row?.value as Partial<Settings>) ?? {}) }
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const current = await getSettings()
  await db.kv.put({ key: 'settings', value: { ...current, ...patch } })
}
