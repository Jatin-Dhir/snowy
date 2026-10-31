import { db, saveSettings, type Trip, type TripEntry, type TripPayment, type TripPerson, type Txn } from './db'
import { todayISO } from '../lib/dates'
import { ME, shareOf, summarize, type TripSummary } from '../lib/split'

/** The trip in trip mode right now, if there is one: new spends go into it. */
export async function activeTrip(): Promise<Trip | null> {
  const trips = await db.trips.toArray()
  return trips.find((t) => !t.endedISO) ?? null
}

/** Starts trip mode. Only one trip is on at a time, so one still running ends here. */
export async function startTrip(input: {
  name: string
  myName: string
  others: string[]
  budgetMinor: number | null
}): Promise<Trip> {
  const now = Date.now()
  const today = todayISO()
  const myName = input.myName.trim()
  const trip: Trip = {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    people: [{ id: ME, name: myName }, ...input.others.map((name) => ({ id: crypto.randomUUID(), name: name.trim() }))],
    budgetMinor: input.budgetMinor,
    startISO: today,
    endedISO: null,
    createdAt: now,
    updatedAt: now
  }
  await db.transaction('rw', db.trips, async () => {
    const running = await activeTrip()
    if (running) await db.trips.update(running.id, { endedISO: today, updatedAt: now })
    await db.trips.add(trip)
  })
  await saveSettings({ myName })
  return trip
}

export async function endTrip(id: string): Promise<void> {
  await db.trips.update(id, { endedISO: todayISO(), updatedAt: Date.now() })
}

/** Back into trip mode: new spends go into this trip again, and any other that's on ends. */
export async function resumeTrip(id: string): Promise<void> {
  await db.transaction('rw', db.trips, async () => {
    const running = await activeTrip()
    if (running && running.id !== id) await db.trips.update(running.id, { endedISO: todayISO(), updatedAt: Date.now() })
    await db.trips.update(id, { endedISO: null, updatedAt: Date.now() })
  })
}

/** Name, people, budget. The trip's name is also on your share of each spend, so it follows along. */
export async function updateTrip(
  trip: Trip,
  patch: { name: string; people: TripPerson[]; budgetMinor: number | null }
): Promise<void> {
  const name = patch.name.trim()
  const people = patch.people.map((p) => ({ ...p, name: p.name.trim() }))
  const clearBase = patch.budgetMinor !== trip.budgetMinor ? { baseBudgetMinor: null, baseCurrency: null } : {}
  await db.transaction('rw', db.trips, db.tripEntries, db.txns, async () => {
    await db.trips.update(trip.id, { name, people, budgetMinor: patch.budgetMinor, ...clearBase, updatedAt: Date.now() })
    if (name === trip.name) return
    const entries = await db.tripEntries.where('tripId').equals(trip.id).toArray()
    await Promise.all(entries.filter((e) => e.txnId).map((e) => db.txns.update(e.txnId!, { tripName: name })))
  })
  const mine = people.find((p) => p.id === ME)
  if (mine) await saveSettings({ myName: mine.name })
}

export interface DeletedTrip {
  trip: Trip
  entries: TripEntry[]
  payments: TripPayment[]
}

/**
 * Deletes a trip, not what you spent on it: your share of each spend stays in
 * your expenses, as plain entries. Returns what's needed for restoreTrip's Undo.
 */
export async function deleteTrip(id: string): Promise<DeletedTrip | undefined> {
  return db.transaction('rw', db.trips, db.tripEntries, db.tripPayments, db.txns, async () => {
    const trip = await db.trips.get(id)
    if (!trip) return undefined
    const entries = await db.tripEntries.where('tripId').equals(id).toArray()
    const payments = await db.tripPayments.where('tripId').equals(id).toArray()
    await Promise.all(entries.filter((e) => e.txnId).map((e) => db.txns.update(e.txnId!, { tripEntryId: null, tripName: null })))
    await db.tripEntries.bulkDelete(entries.map((e) => e.id))
    await db.tripPayments.bulkDelete(payments.map((p) => p.id))
    await db.trips.delete(id)
    return { trip, entries, payments }
  })
}

export async function restoreTrip({ trip, entries, payments }: DeletedTrip): Promise<void> {
  await db.transaction('rw', db.trips, db.tripEntries, db.tripPayments, db.txns, async () => {
    await db.trips.put(trip)
    await db.tripEntries.bulkPut(entries)
    await db.tripPayments.bulkPut(payments)
    await Promise.all(
      entries.filter((e) => e.txnId).map((e) => db.txns.update(e.txnId!, { tripEntryId: e.id, tripName: trip.name }))
    )
  })
}

export interface EntryInput {
  amountMinor: number
  currency: string
  paidBy: string
  among: string[]
  categoryId: string | null
  note: string
  accountId: string
  dateISO: string
  ts: number
}

/** Your share of a spend, as the ledger sees it: what the trip really cost you, not what you put down. */
function shareTxn(id: string, entry: TripEntry, tripName: string, share: number, createdAt: number): Txn {
  return {
    id,
    amountMinor: share,
    currency: entry.currency,
    categoryId: entry.categoryId,
    accountId: entry.accountId,
    kind: 'out',
    note: entry.note,
    dateISO: entry.dateISO,
    ts: entry.ts,
    source: 'manual',
    createdAt,
    updatedAt: Date.now(),
    deleted: 0,
    tripEntryId: entry.id,
    tripName
  }
}

export async function addTripEntry(trip: Trip, input: EntryInput): Promise<{ entry: TripEntry; txn: Txn | null }> {
  const now = Date.now()
  const share = shareOf(input, ME)
  const entry: TripEntry = {
    ...input,
    id: crypto.randomUUID(),
    tripId: trip.id,
    txnId: share > 0 ? crypto.randomUUID() : null,
    createdAt: now,
    updatedAt: now,
    deleted: 0
  }
  const txn = entry.txnId ? shareTxn(entry.txnId, entry, trip.name, share, now) : null
  await db.transaction('rw', db.tripEntries, db.txns, async () => {
    await db.tripEntries.add(entry)
    if (txn) await db.txns.add(txn)
  })
  return { entry, txn }
}

/** A changed spend changes your share of it too; leaving the split, or joining it, takes it out of the ledger or puts it in. */
export async function updateTripEntry(entry: TripEntry, input: EntryInput, tripName: string): Promise<void> {
  const now = Date.now()
  const share = shareOf(input, ME)
  const clearBase = input.amountMinor !== entry.amountMinor ? { baseMinor: null, baseCurrency: null } : {}
  const txnId = share > 0 ? (entry.txnId ?? crypto.randomUUID()) : null
  const next: TripEntry = { ...entry, ...input, ...clearBase, txnId, updatedAt: now }
  await db.transaction('rw', db.tripEntries, db.txns, async () => {
    await db.tripEntries.put(next)
    if (entry.txnId && !txnId) await db.txns.delete(entry.txnId)
    if (txnId) await db.txns.put(shareTxn(txnId, next, tripName, share, entry.createdAt))
  })
}

export async function softDeleteTripEntry(entry: TripEntry): Promise<void> {
  await db.transaction('rw', db.tripEntries, db.txns, async () => {
    await db.tripEntries.update(entry.id, { deleted: 1, updatedAt: Date.now() })
    if (entry.txnId) await db.txns.update(entry.txnId, { deleted: 1, updatedAt: Date.now() })
  })
}

export async function restoreTripEntry(entry: TripEntry): Promise<void> {
  await db.transaction('rw', db.tripEntries, db.txns, async () => {
    await db.tripEntries.update(entry.id, { deleted: 0, updatedAt: Date.now() })
    if (entry.txnId) await db.txns.update(entry.txnId, { deleted: 0, updatedAt: Date.now() })
  })
}

/** The Undo right after saving: as if it never happened. */
export async function removeTripEntry(entry: TripEntry): Promise<void> {
  await db.transaction('rw', db.tripEntries, db.txns, async () => {
    await db.tripEntries.delete(entry.id)
    if (entry.txnId) await db.txns.delete(entry.txnId)
  })
}

/** "This one was just mine": out of the trip, and the whole amount back in your own expenses. */
export async function tripEntryToOwn(entry: TripEntry, input: Omit<EntryInput, 'paidBy' | 'among'>): Promise<void> {
  const now = Date.now()
  await db.transaction('rw', db.tripEntries, db.txns, async () => {
    await db.tripEntries.delete(entry.id)
    if (entry.txnId) await db.txns.delete(entry.txnId)
    await db.txns.add({
      id: crypto.randomUUID(),
      amountMinor: input.amountMinor,
      currency: input.currency,
      categoryId: input.categoryId,
      accountId: input.accountId,
      kind: 'out',
      note: input.note,
      dateISO: input.dateISO,
      ts: input.ts,
      source: 'manual',
      createdAt: entry.createdAt,
      updatedAt: now,
      deleted: 0
    })
  })
}

/** Someone handed money to someone: settling up at the end, or chipping in up front. */
export async function addTripPayment(input: {
  tripId: string
  from: string
  to: string
  amountMinor: number
  currency: string
}): Promise<TripPayment> {
  const payment: TripPayment = { ...input, id: crypto.randomUUID(), dateISO: todayISO(), createdAt: Date.now() }
  await db.tripPayments.add(payment)
  return payment
}

export async function deleteTripPayment(id: string): Promise<void> {
  await db.tripPayments.delete(id)
}

export async function restoreTripPayment(payment: TripPayment): Promise<void> {
  await db.tripPayments.put(payment)
}

export interface TripOverview {
  trip: Trip
  summary: TripSummary
  entries: TripEntry[]
  payments: TripPayment[]
}

/** Every trip with where it stands: the one that's on first, then newest. */
export async function tripsOverview(): Promise<TripOverview[]> {
  const [trips, entries, payments] = await Promise.all([db.trips.toArray(), db.tripEntries.toArray(), db.tripPayments.toArray()])
  return trips
    .sort((a, b) => Number(!!a.endedISO) - Number(!!b.endedISO) || b.createdAt - a.createdAt)
    .map((trip) => {
      const own = entries.filter((e) => e.tripId === trip.id)
      const paid = payments.filter((p) => p.tripId === trip.id)
      return { trip, summary: summarize(trip.people, own, paid), entries: own, payments: paid }
    })
}
