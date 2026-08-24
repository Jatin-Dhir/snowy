import { db, type Account } from './db'

export async function addAccount(name: string): Promise<Account | null> {
  const clean = name.trim()
  if (!clean) return null
  const all = await db.accounts.toArray()
  if (all.some((a) => a.name.toLowerCase() === clean.toLowerCase() && !a.archived)) return null
  const account: Account = {
    id: crypto.randomUUID?.() ?? `a${Date.now()}${Math.floor(Math.random() * 1e6)}`,
    name: clean,
    sort: Math.max(0, ...all.map((a) => a.sort)) + 1
  }
  await db.accounts.put(account)
  return account
}

export async function renameAccount(id: string, name: string): Promise<void> {
  const clean = name.trim()
  if (clean) await db.accounts.update(id, { name: clean })
}

/** Archived accounts disappear from pickers; their history keeps the name. */
export async function setAccountArchived(id: string, archived: boolean): Promise<void> {
  await db.accounts.update(id, { archived: archived ? 1 : 0 })
}

/**
 * Set an account's balance to a specific figure — for the money that was
 * already there before you started logging. Nudges the opening balance by
 * the gap between what's shown now and what you typed, so it always lands
 * exactly on the number you entered regardless of transaction history.
 */
export async function setAccountBalance(id: string, targetMinor: number, currentComputedMinor: number): Promise<void> {
  const a = await db.accounts.get(id)
  if (!a) return
  const delta = targetMinor - currentComputedMinor
  await db.accounts.update(id, { openingBalanceMinor: (a.openingBalanceMinor ?? 0) + delta })
}
