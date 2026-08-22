import { db, type Loan } from './db'
import { todayISO } from '../lib/dates'

export async function addLoan(input: {
  direction: 'lent' | 'borrowed'
  person: string
  amountMinor: number
  currency: string
  remindISO: string | null
}): Promise<Loan> {
  const now = Date.now()
  const loan: Loan = {
    id: crypto.randomUUID(),
    direction: input.direction,
    person: input.person.trim(),
    amountMinor: input.amountMinor,
    currency: input.currency,
    lentISO: todayISO(),
    remindISO: input.remindISO,
    settledISO: null,
    createdAt: now,
    updatedAt: now
  }
  await db.loans.add(loan)
  return loan
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

export async function deleteLoan(id: string): Promise<void> {
  await db.loans.delete(id)
}
