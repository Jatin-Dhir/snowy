import Dexie, { type Table } from 'dexie'
import { currentDbName } from '../lib/profiles'

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
  /** set on your share of a trip spend: the trip entry it belongs to, and the trip's name to show on the row */
  tripEntryId?: string | null
  tripName?: string | null
}

/** A money source — bank, wallet, cash jar, someone's card. Not a login. */
export interface Account {
  id: string
  name: string
  sort: number
  archived?: 0 | 1
  /** manual correction so balance can start from what you actually have, not just what's been logged since */
  openingBalanceMinor?: number
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
  /** what it was for — "concert tickets", "split dinner" */
  note?: string
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

/** Someone on a trip. Just a name, not a login; the phone's owner always has the id 'me'. */
export interface TripPerson {
  id: string
  name: string
}

export interface Trip {
  id: string
  name: string
  /** the owner first */
  people: TripPerson[]
  /** the total the group means to spend, if it set one */
  budgetMinor: number | null
  startISO: string
  /** null while the trip is on: trip mode, every new spend goes into it */
  endedISO: string | null
  createdAt: number
  updatedAt: number
  baseBudgetMinor?: number | null
  baseCurrency?: string | null
}

/** One spend on a trip, in full. Only the owner's share of it reaches the ledger, as the Txn in txnId. */
export interface TripEntry {
  id: string
  tripId: string
  amountMinor: number
  currency: string
  /** who put the money down */
  paidBy: string
  /** who it's split between, evenly */
  among: string[]
  categoryId: string | null
  note: string
  accountId: string
  dateISO: string
  ts: number
  txnId: string | null
  createdAt: number
  updatedAt: number
  deleted: 0 | 1
  baseMinor?: number | null
  baseCurrency?: string | null
}

/** Money that moved between two people on a trip: settling up, or chipping in up front. Never touches the ledger. */
export interface TripPayment {
  id: string
  tripId: string
  from: string
  to: string
  amountMinor: number
  currency: string
  dateISO: string
  createdAt: number
  baseMinor?: number | null
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
  /** what friends call you, for what a trip shares with them */
  myName: string
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
  pinHash: null,
  myName: ''
}

class TallyDB extends Dexie {
  txns!: Table<Txn, string>
  categories!: Table<Category, string>
  budgets!: Table<Budget, string>
  rules!: Table<Rule, string>
  loans!: Table<Loan, string>
  goals!: Table<Goal, string>
  accounts!: Table<Account, string>
  trips!: Table<Trip, string>
  tripEntries!: Table<TripEntry, string>
  tripPayments!: Table<TripPayment, string>
  kv!: Table<KV, string>

  constructor(name: string) {
    super(name)
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
    this.version(5).stores({
      trips: 'id',
      tripEntries: 'id, tripId',
      tripPayments: 'id, tripId'
    })
  }
}

// each profile is its own database — see lib/profiles.ts
export const db = new TallyDB(currentDbName())

export async function getSettings(): Promise<Settings> {
  const row = await db.kv.get('settings')
  return { ...DEFAULT_SETTINGS, ...((row?.value as Partial<Settings>) ?? {}) }
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const current = await getSettings()
  await db.kv.put({ key: 'settings', value: { ...current, ...patch } })
}
