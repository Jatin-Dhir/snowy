// Encrypted backup: one profile's whole ledger in a single file, locked with a
// password. The key is stretched from the password with PBKDF2-SHA256 and the
// data sealed with AES-GCM, so without the password the file is noise, and a
// wrong password fails cleanly (GCM authenticates) instead of restoring
// garbage. The password never leaves the phone and isn't kept anywhere, so a
// forgotten one can't be recovered.
import { db, getSettings, saveSettings, type Rule, type Settings } from '../db/db'
import { currentProfile, profileSlug } from './profiles'
import { daysInMonth, todayISO } from './dates'

const TABLES = ['txns', 'categories', 'budgets', 'rules', 'loans', 'goals', 'accounts', 'trips', 'tripEntries', 'tripPayments'] as const
type TableName = (typeof TABLES)[number]
const ITERATIONS = 600_000

interface Envelope {
  taily: 'backup'
  v: 1
  kdf: 'PBKDF2-SHA256'
  iterations: number
  salt: string
  iv: string
  data: string
}

export interface BackupContents {
  v: 1
  createdAt: number
  profile: string
  /** everything but the PIN, which stays with the phone that set it */
  settings: Partial<Settings>
  tables: Record<TableName, unknown[]>
}

// btoa over a spread argument list overflows the stack on big files, so go in slices
function toB64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

function fromB64(b64: string) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

async function keyFor(password: string, salt: BufferSource, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

export async function createBackup(password: string): Promise<{ text: string; filename: string; entries: number }> {
  const tables = {} as Record<TableName, unknown[]>
  for (const t of TABLES) tables[t] = await db.table(t).toArray()
  const { pinHash: _pin, ...settings } = await getSettings()
  const contents: BackupContents = { v: 1, createdAt: Date.now(), profile: currentProfile().name, settings, tables }

  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await keyFor(password, salt, ITERATIONS)
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(contents)))
  const envelope: Envelope = {
    taily: 'backup',
    v: 1,
    kdf: 'PBKDF2-SHA256',
    iterations: ITERATIONS,
    salt: toB64(salt),
    iv: toB64(iv),
    data: toB64(new Uint8Array(sealed))
  }
  return {
    text: JSON.stringify(envelope),
    filename: `taily-backup-${profileSlug()}-${todayISO()}.json`,
    entries: tables.txns.filter((t) => !(t as { deleted?: number }).deleted).length
  }
}

/** Reads a backup file. Checks it's a Taily backup before asking anything of the password. */
export function isBackupFile(text: string): boolean {
  try {
    const e = JSON.parse(text) as Partial<Envelope>
    return e.taily === 'backup' && e.v === 1 && !!e.salt && !!e.iv && !!e.data
  } catch {
    return false
  }
}

export async function openBackup(text: string, password: string): Promise<BackupContents | 'wrong-password' | 'not-a-backup'> {
  if (!isBackupFile(text)) return 'not-a-backup'
  const e = JSON.parse(text) as Envelope
  let plain: ArrayBuffer
  try {
    const key = await keyFor(password, fromB64(e.salt), e.iterations)
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(e.iv) }, key, fromB64(e.data))
  } catch {
    return 'wrong-password'
  }
  try {
    const c = JSON.parse(new TextDecoder().decode(plain)) as BackupContents
    if (c.v !== 1 || typeof c.tables !== 'object' || !TABLES.every((t) => Array.isArray(c.tables[t] ?? []))) return 'not-a-backup'
    return c
  } catch {
    return 'not-a-backup'
  }
}

/** "183 entries · 4 budgets · 2 goals · 5 lent & borrowed · 3 monthly payments" */
export function describeBackup(c: BackupContents): string {
  const live = (c.tables.txns ?? []).filter((t) => !(t as { deleted?: number }).deleted).length
  const parts = [
    `${live} ${live === 1 ? 'entry' : 'entries'}`,
    c.tables.budgets?.length ? `${c.tables.budgets.length} ${c.tables.budgets.length === 1 ? 'budget' : 'budgets'}` : '',
    c.tables.goals?.length ? `${c.tables.goals.length} ${c.tables.goals.length === 1 ? 'goal' : 'goals'}` : '',
    c.tables.loans?.length ? `${c.tables.loans.length} lent & borrowed` : '',
    c.tables.rules?.length ? `${c.tables.rules.length} monthly ${c.tables.rules.length === 1 ? 'payment' : 'payments'}` : '',
    c.tables.trips?.length ? `${c.tables.trips.length} ${c.tables.trips.length === 1 ? 'trip' : 'trips'}` : ''
  ]
  return parts.filter(Boolean).join(' · ')
}

/**
 * The currency a restore would mix in, if any. A backup's amounts are numbers in its own currency, and
 * restoring takes that currency too: into a profile that keeps its money in another one, every figure
 * already here would change currency without being converted. A profile with no money in it yet just
 * takes the backup's currency, as on a new phone.
 */
export async function restoreConflict(c: BackupContents): Promise<{ backup: string; here: string } | null> {
  const backup = c.settings?.currency
  const { currency: here } = await getSettings()
  if (!backup || backup === here) return null
  const money = TABLES.filter((t) => t !== 'categories' && t !== 'accounts')
  const counts = await Promise.all(money.map((t) => db.table(t).count()))
  const opening = (await db.accounts.toArray()).some((a) => a.openingBalanceMinor)
  return counts.some((n) => n > 0) || opening ? { backup, here } : null
}

/**
 * A backup's monthly payments as they go back in. One the profile has moved on since keeps the month it's up to: the
 * payments it logged since the backup are entries that stay, and the backup's older next run would log them again
 * (rent logged on the 1st, a second time at the next start). It takes the backup's day in that month.
 */
async function laterRuns(rules: Rule[] | undefined): Promise<Rule[] | undefined> {
  if (!rules?.length) return rules
  const here = new Map((await db.rules.toArray()).map((r) => [r.id, r]))
  return rules.map((r) => {
    const mine = here.get(r.id)
    const month = mine?.nextRunISO.slice(0, 7)
    if (!month || month <= r.nextRunISO.slice(0, 7)) return r
    return { ...r, nextRunISO: `${month}-${String(Math.min(Math.max(1, r.dayOfMonth), daysInMonth(month))).padStart(2, '0')}` }
  })
}

/** The tables whose records say when they last changed (updatedAt) */
const STAMPED: ReadonlySet<TableName> = new Set<TableName>(['txns', 'loans', 'goals', 'trips', 'tripEntries'])

/**
 * A backup's records of a STAMPED table as they go back in: one changed here since the backup's copy stays as it is,
 * one missing here is added. Put back over the newer one, a goal's older total stood beside the savings entries made
 * since, and an entry deleted here since came back without the money it had taken out of its goal.
 */
async function newerKept(t: TableName, rows: unknown[] | undefined): Promise<unknown[] | undefined> {
  if (!rows?.length) return rows
  const theirs = rows as { id: string; updatedAt?: number }[]
  const here = (await db.table(t).bulkGet(theirs.map((r) => r.id))) as ({ updatedAt?: number } | undefined)[]
  return theirs.filter((r, i) => !here[i] || (here[i]?.updatedAt ?? 0) <= (r.updatedAt ?? 0))
}

/**
 * Adds a backup into the profile that's open now. Records are matched by id, so
 * restoring the same backup twice changes nothing, and entries made since the
 * backup stay; so does a record changed here since (newerKept). The PIN set on
 * this phone stays as it is.
 */
export async function restoreBackup(c: BackupContents): Promise<void> {
  if (await restoreConflict(c)) throw new Error('The backup is in another currency than this profile')
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) {
      const rows =
        t === 'rules' ? await laterRuns(c.tables.rules as Rule[] | undefined) : STAMPED.has(t) ? await newerKept(t, c.tables[t]) : c.tables[t]
      if (rows?.length) await db.table(t).bulkPut(rows)
    }
  })
  const { pinHash } = await getSettings()
  await saveSettings({ ...c.settings, pinHash, initialized: true })
}
