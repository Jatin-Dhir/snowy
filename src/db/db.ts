import Dexie, { type Table } from 'dexie'

export interface Txn {
  id: string
  amountMinor: number
  currency: string
  categoryId: string | null
  /** references an Account row; legacy rows carry 'upi' | 'cash' | 'card' */
  accountId: string
  /** 'out' = money spent (default for old rows), 'in' = money received */
  kind?: 'out' | 'in'
  note: string
  dateISO: string
  ts: number
  source: 'manual' | 'recurring'
  createdAt: number
  updatedAt: number
  deleted: 0 | 1
  /** original amount before any currency conversion — restored exactly when converting back */
  baseMinor?: number | null
  baseCurrency?: string | null
}

/** A money source — bank, wallet, cash jar, someone's card. Not a login. */
export interface Account {
  id: string
  name: string
  sort: number
  archived?: 0 | 1
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
  baseMinor?: number | null
  baseCurrency?: string | null
}

export interface Rule {
  id: string
  name: string
  amountMinor: number
  categoryId: string | null
  accountId: string
  dayOfMonth: number
  nextRunISO: string
  paused: 0 | 1
  baseMinor?: number | null
  baseCurrency?: string | null
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
  baseMinor?: number | null
  baseCurrency?: string | null
}

export interface Goal {
  id: string
  name: string
  targetMinor: number
  savedMinor: number
  createdAt: number
  updatedAt: number
  baseTargetMinor?: number | null
  baseSavedMinor?: number | null
  baseCurrency?: string | null
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
  accentHue: number
  haptics: boolean
  sounds: boolean
  soundPack: 'tap' | 'click' | 'pop' | 'wood'
  pinHash: string | null
}

export const DEFAULT_SETTINGS: Settings = {
  initialized: false,
  currency: 'INR',
  theme: 'light',
  accent: 'blue',
  accentHue: 210,
  haptics: true,
  sounds: true,
  soundPack: 'tap',
  pinHash: null
}

class TallyDB extends Dexie {
  txns!: Table<Txn, string>
  categories!: Table<Category, string>
  budgets!: Table<Budget, string>
  rules!: Table<Rule, string>
  loans!: Table<Loan, string>
  goals!: Table<Goal, string>
  accounts!: Table<Account, string>
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
    this.version(3).stores({
      goals: 'id'
    })
    this.version(4).stores({
      accounts: 'id, sort'
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
