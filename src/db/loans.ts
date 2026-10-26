import { db, type Loan } from './db'
import { todayISO } from '../lib/dates'

export async function addLoan(input: {
  direction: 'lent' | 'borrowed'
  person: string
  amountMinor: number
  currency: string
  note?: string
  remindISO: string | null
}): Promise<Loan> {
  const now = Date.now()
  const loan: Loan = {
    id: crypto.randomUUID(),
    direction: input.direction,
    person: input.person.trim(),
    amountMinor: input.amountMinor,
    currency: input.currency,
    note: input.note?.trim() || undefined,
    lentISO: todayISO(),
    remindISO: input.remindISO,
    settledISO: null,
    createdAt: now,
    updatedAt: now
  }
  await db.loans.add(loan)
  return loan
}

/** Edit any of the loan's facts. A hand-edited amount clears its conversion base. */
export async function updateLoan(
  id: string,
  patch: Partial<Pick<Loan, 'person' | 'amountMinor' | 'note' | 'direction'>>
): Promise<void> {
  const clearBase = patch.amountMinor !== undefined ? { baseMinor: null, baseCurrency: null } : {}
  await db.loans.update(id, { ...patch, ...clearBase, updatedAt: Date.now() })
}

export async function settleLoan(id: string): Promise<void> {
  await db.loans.update(id, { settledISO: todayISO(), updatedAt: Date.now() })
}

export async function unsettleLoan(id: string): Promise<void> {
  await db.loans.update(id, { settledISO: null, updatedAt: Date.now() })
}

export async function updateLoanReminder(id: string, remindISO: string | null): Promise<void> {
  await db.loans.update(id, { remindISO, updatedAt: Date.now() })
}

/** Returns the record as it was, so the toast's Undo can put it back with restoreLoan. */
export async function deleteLoan(id: string): Promise<Loan | undefined> {
  const loan = await db.loans.get(id)
  await db.loans.delete(id)
  return loan
}

export async function restoreLoan(loan: Loan): Promise<void> {
  await db.loans.put(loan)
}
