import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, getSettings, type Trip, type TripEntry, type TripPayment, type TripPerson } from '../db/db'
import {
  addTripPayment,
  deleteTrip,
  deleteTripPayment,
  endTrip,
  restoreTrip,
  restoreTripPayment,
  resumeTrip,
  startTrip,
  tripsOverview,
  updateTrip,
  type TripOverview
} from '../db/trips'
import { fmtDayHeading, fromISO, todayISO } from '../lib/dates'
import { currencySymbol, formatMinor } from '../lib/money'
import { shareMessage } from '../lib/saveFile'
import { ME, type Transfer } from '../lib/split'
import { tripLink, tripMessage, tripPayload } from '../lib/tripLink'
import { useAnimatedNumber } from '../lib/useAnimatedNumber'
import { Icon } from './Icon'
import { PersonBadge } from './PersonBadge'
import { Progress } from './Progress'
import { Sheet } from './Sheet'
import { personLabel, splitLabel } from './TripSplitSheet'
import { haptic, useUi } from '../state/ui'

function shortDate(iso: string): string {
  return fromISO(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short' })
}

/** "Day 3" while it's on, "26 Oct to 29 Oct" once it's over. */
function whenLine(trip: Trip): string {
  if (!trip.endedISO) {
    const day = Math.round((fromISO(todayISO()).getTime() - fromISO(trip.startISO).getTime()) / 86400000) + 1
    return `Day ${Math.max(1, day)}`
  }
  return trip.startISO === trip.endedISO ? shortDate(trip.startISO) : `${shortDate(trip.startISO)} to ${shortDate(trip.endedISO)}`
}

function parseAmount(text: string): number {
  return Math.round(parseFloat(text.replace(/,/g, '')) * 100) || 0
}

// the second line of a row here is what you came for, not a detail to skim past
const SUB_LINE = { color: 'var(--muted)' }

export function TripSheet({
  open,
  currency,
  onClose,
  onAddSpend,
  onEditEntry
}: {
  open: boolean
  currency: string
  onClose: () => void
  onAddSpend: () => void
  onEditEntry: (entry: TripEntry) => void
}) {
  const overview = useLiveQuery(() => tripsOverview(), [])
  const [view, setView] = useState<'list' | 'new' | 'detail' | 'edit'>('list')
  const [tripId, setTripId] = useState<string | null>(null)

  // opens on the trip that's on; otherwise on the list of trips
  useEffect(() => {
    if (!open) return
    const on = overview?.find((o) => !o.trip.endedISO)
    setTripId(on?.trip.id ?? null)
    setView(on ? 'detail' : 'list')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, overview === undefined])

  const current = overview?.find((o) => o.trip.id === tripId) ?? null
  const trip = current?.trip ?? null
  const running = overview?.find((o) => !o.trip.endedISO)?.trip ?? null

  return (
    <Sheet open={open} onClose={onClose} label="Trips" style={{ gap: 14 }}>
      {view === 'detail' && current ? (
        <TripDetail
          data={current}
          currency={currency}
          onBack={() => setView('list')}
          onEdit={() => setView('edit')}
          onClose={onClose}
          onAddSpend={onAddSpend}
          onEditEntry={onEditEntry}
        />
      ) : view === 'new' ? (
        <TripForm
          trip={null}
          running={running}
          knownNames={[...new Set((overview ?? []).flatMap((o) => o.trip.people.filter((p) => p.id !== ME).map((p) => p.name)))]}
          currency={currency}
          onBack={() => setView('list')}
          onDone={(id) => {
            setTripId(id)
            setView('detail')
          }}
        />
      ) : view === 'edit' && trip ? (
        <TripForm
          trip={trip}
          running={running}
          knownNames={[]}
          currency={currency}
          onBack={() => setView('detail')}
          onDone={() => setView('detail')}
          onDeleted={() => {
            setTripId(null)
            setView('list')
          }}
        />
      ) : (
        <>
          <div className="row-between">
            <span className="label" style={{ letterSpacing: '0.14em' }}>Trips</span>
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              <Icon name="x" size={14} strokeWidth={2.2} />
            </button>
          </div>
          <button className="btn" onClick={() => setView('new')}>
            <Icon name="plus" size={17} strokeWidth={2.4} /> Start a trip
          </button>
          {overview?.length === 0 && (
            <div className="empty">
              Going somewhere with friends? Start a trip and every spend you add splits between you by itself. At the end,
              Taily shows who pays whom.
            </div>
          )}
          {(overview?.length ?? 0) > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {overview!.map(({ trip: t, summary }) => (
                <button
                  key={t.id}
                  className="txn-row"
                  onClick={() => {
                    setTripId(t.id)
                    setView('detail')
                  }}
                >
                  <span
                    className="txn-icon"
                    style={t.endedISO ? { background: 'var(--sunken)', color: 'var(--muted)' } : { background: 'var(--pos-soft)', color: 'var(--accent)' }}
                  >
                    <Icon name="trip" size={18} />
                  </span>
                  <span className="txn-main">
                    <span className="txn-title">{t.name}</span>
                    <span className="txn-sub" style={SUB_LINE}>
                      {[
                        t.endedISO ? whenLine(t) : `On now · ${whenLine(t)}`,
                        `${t.people.length} people`,
                        summary.total > 0 && summary.transfers.length === 0 ? 'all square' : null
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <span className="txn-amount">{formatMinor(summary.total, currency)}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </Sheet>
  )
}

function TripDetail({
  data: { trip, summary, entries, payments },
  currency,
  onBack,
  onEdit,
  onClose,
  onAddSpend,
  onEditEntry
}: {
  data: TripOverview
  currency: string
  onBack: () => void
  onEdit: () => void
  onClose: () => void
  onAddSpend: () => void
  onEditEntry: (entry: TripEntry) => void
}) {
  const { showToast } = useUi()
  const categories = useLiveQuery(() => db.categories.toArray(), []) ?? []
  const [recording, setRecording] = useState(false)

  const spends = useMemo(() => entries.filter((e) => !e.deleted).sort((a, b) => b.ts - a.ts), [entries])
  const days = useMemo(() => {
    const map = new Map<string, TripEntry[]>()
    for (const e of spends) map.set(e.dateISO, [...(map.get(e.dateISO) ?? []), e])
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))
  }, [spends])
  const total = useAnimatedNumber(summary.total)
  const on = !trip.endedISO
  const name = (id: string) => personLabel(trip, id)
  const myShare = summary.balances.find((b) => b.id === ME)?.share ?? 0
  const left = trip.budgetMinor !== null ? trip.budgetMinor - summary.total : null

  /** "Rahul pays you", "You pay Rahul", "Rahul pays Meera" */
  function payLine(from: string, to: string, past = false): string {
    const verb = past ? 'paid' : from === ME ? 'pay' : 'pays'
    return `${name(from)} ${verb} ${to === ME ? 'you' : name(to)}`
  }

  // marking or removing a payment moves the rows under the finger, and a double tap's second tap landed on
  // the row that moved into its place, settling or removing that one too. So from the tap until half a
  // second after the lists have moved, they take no taps
  const [settling, setSettling] = useState(false)
  const settleTimer = useRef(0)
  useEffect(() => () => window.clearTimeout(settleTimer.current), [])
  async function settleAfter<T>(change: Promise<T>): Promise<T> {
    window.clearTimeout(settleTimer.current)
    setSettling(true)
    try {
      return await change
    } finally {
      settleTimer.current = window.setTimeout(() => setSettling(false), 500)
    }
  }

  async function markPaid(t: Transfer) {
    const payment = await settleAfter(addTripPayment({ tripId: trip.id, from: t.from, to: t.to, amountMinor: t.amountMinor, currency }))
    haptic('success')
    showToast(`${payLine(t.from, t.to, true)} ${formatMinor(t.amountMinor, currency)}`, () => {
      void deleteTripPayment(payment.id)
    })
  }

  async function removePayment(p: TripPayment) {
    await settleAfter(deleteTripPayment(p.id))
    haptic('medium')
    showToast('Payment removed', () => {
      void restoreTripPayment(p)
    })
  }

  async function share() {
    const link = tripLink(tripPayload(trip, summary, entries, categories, currency))
    const result = await shareMessage(tripMessage(trip, summary, link, currency), trip.name)
    if (result === 'copied') showToast('Copied. Paste it into your group chat')
    else if (result === 'failed') showToast("Couldn't share this. Try again")
  }

  async function finish() {
    await endTrip(trip.id)
    haptic('success')
    showToast('Trip ended. New spends are just yours again', () => {
      void resumeTrip(trip.id)
    })
  }

  return (
    <>
      <div className="row-between">
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <button className="icon-btn" onClick={onBack} aria-label="All trips">
            <Icon name="chevronLeft" size={14} strokeWidth={2.2} />
          </button>
          <span className="label" style={{ letterSpacing: '0.14em' }}>{on ? 'Trip mode is on' : 'Trip'}</span>
        </span>
        <span style={{ display: 'flex', gap: 8 }}>
          <button className="icon-btn" onClick={onEdit} aria-label="Edit trip">
            <Icon name="pencil" size={14} />
          </button>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" size={14} strokeWidth={2.2} />
          </button>
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span className="display" style={{ fontWeight: 800, fontSize: 22, lineHeight: 1.2, overflowWrap: 'anywhere' }}>{trip.name}</span>
        <span className="caption">{`${whenLine(trip)} · ${trip.people.length} people`}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <span className="label">Spent by everyone</span>
        <span className="mono" style={{ fontWeight: 800, fontSize: 40, letterSpacing: '-0.03em', lineHeight: 1.05 }}>
          {formatMinor(total, currency)}
        </span>
        {trip.budgetMinor !== null && left !== null && (
          <>
            <Progress
              fraction={trip.budgetMinor > 0 ? summary.total / trip.budgetMinor : 0}
              color={left < 0 ? 'var(--red)' : 'var(--pos)'}
              height={5}
            />
            <span className="caption" style={left < 0 ? { color: 'var(--red)', fontWeight: 600 } : undefined}>
              {left < 0
                ? `${formatMinor(-left, currency)} over the ${formatMinor(trip.budgetMinor, currency)} budget`
                : `${formatMinor(left, currency)} left of ${formatMinor(trip.budgetMinor, currency)}`}
            </span>
          </>
        )}
      </div>

      {spends.length === 0 ? (
        <div className="empty" style={{ padding: '14px 12px' }}>
          Tap + anywhere in Taily, type an amount and pick a tag. It splits between the {trip.people.length} of you by itself.
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="well">
              <span className="label" style={{ fontSize: 9.5 }}>Your share</span>
              <span className="well-num whole">{formatMinor(myShare, currency)}</span>
            </div>
            <div className="well">
              <span className="label" style={{ fontSize: 9.5 }}>
                {summary.mine >= 50 ? 'You get back' : summary.mine <= -50 ? 'You owe' : 'You'}
              </span>
              <span className="well-num whole" style={summary.mine <= -50 ? { color: 'var(--amber)' } : undefined}>
                {Math.abs(summary.mine) >= 50 ? formatMinor(Math.abs(summary.mine), currency) : 'All square'}
              </span>
            </div>
          </div>

          <section style={{ display: 'flex', flexDirection: 'column', gap: 2, pointerEvents: settling ? 'none' : undefined }}>
            <span className="label" style={{ fontSize: 10, paddingBottom: 4 }}>
              {summary.transfers.length === 0 ? 'Who pays whom' : on ? 'Who pays whom, so far' : 'Who pays whom'}
            </span>
            {summary.transfers.length === 0 && <span className="caption">All square. Nobody owes anybody.</span>}
            {summary.transfers.map((t) => (
              <div key={`${t.from}-${t.to}`} className="txn-row" style={{ padding: '7px 0' }}>
                <PersonBadge name={trip.people.find((p) => p.id === t.from)?.name ?? '?'} me={t.from === ME} size={36} />
                <span className="txn-main">
                  <span className="txn-title whole">{payLine(t.from, t.to)}</span>
                  <span className="txn-sub mono" style={{ fontSize: 14, fontWeight: 700, color: t.from === ME ? 'var(--amber)' : 'var(--muted)' }}>
                    {formatMinor(t.amountMinor, currency)}
                  </span>
                </span>
                <button className="pill" onClick={() => void markPaid(t)} aria-label={`Mark paid: ${payLine(t.from, t.to)} ${formatMinor(t.amountMinor, currency)}`}>
                  <Icon name="check" size={13} strokeWidth={2.6} />
                  Paid
                </button>
              </div>
            ))}
            <button
              className="caption"
              style={{ alignSelf: 'flex-start', padding: '10px 0', textDecoration: 'underline', textUnderlineOffset: 3 }}
              onClick={() => setRecording(true)}
            >
              Someone handed over money?
            </button>
          </section>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button className={on ? 'btn ghost' : 'btn'} onClick={() => void share()}>
              <Icon name="share" size={16} /> Share with the group
            </button>
            <span className="caption" style={{ fontSize: 12, textAlign: 'center', textWrap: 'pretty' }}>
              Sends who pays whom and a link to every spend, as of now. No account needed. Anyone with the link can see the
              names and amounts.
            </span>
          </div>

          <section style={{ display: 'flex', flexDirection: 'column' }}>
            <span className="label" style={{ fontSize: 10, paddingBottom: 4 }}>Everyone</span>
            {summary.balances.map((b) => {
              // money handed over outside any spend, so the line adds up to the number beside it
              const moved = b.net - (b.paid - b.share)
              return (
                <div key={b.id} className="txn-row" style={{ padding: '7px 0' }}>
                  <PersonBadge name={b.name} me={b.id === ME} size={36} />
                  <span className="txn-main">
                    <span className="txn-title whole">{name(b.id)}</span>
                    <span className="txn-sub whole" style={SUB_LINE}>
                      {[
                        `paid ${formatMinor(b.paid, currency)}`,
                        `share ${formatMinor(b.share, currency)}`,
                        moved >= 50 ? `gave ${formatMinor(moved, currency)}` : moved <= -50 ? `got ${formatMinor(-moved, currency)}` : null
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <span
                    className="txn-amount"
                    style={{ color: b.net >= 50 ? 'var(--pos)' : b.net <= -50 ? 'var(--amber)' : 'var(--muted)' }}
                  >
                    {Math.abs(b.net) < 50 ? 'Square' : `${b.net > 0 ? '+' : '−'}${formatMinor(Math.abs(b.net), currency)}`}
                  </span>
                </div>
              )
            })}
          </section>

          {payments.length > 0 && (
            <section style={{ display: 'flex', flexDirection: 'column', pointerEvents: settling ? 'none' : undefined }}>
              <span className="label" style={{ fontSize: 10, paddingBottom: 4 }}>Already paid</span>
              {[...payments]
                .sort((a, b) => b.createdAt - a.createdAt)
                .map((p) => (
                  <div key={p.id} className="txn-row" style={{ padding: '6px 0' }}>
                    <span className="txn-icon" style={{ background: 'var(--pos-soft)', color: 'var(--pos)', width: 36, height: 36 }}>
                      <Icon name="check" size={16} strokeWidth={2.4} />
                    </span>
                    <span className="txn-main">
                      <span className="txn-title whole">{payLine(p.from, p.to, true)}</span>
                      <span className="txn-sub" style={SUB_LINE}>{shortDate(p.dateISO)}</span>
                    </span>
                    <span className="txn-amount" style={{ color: 'var(--muted)' }}>{formatMinor(p.amountMinor, p.currency)}</span>
                    <button className="muted" style={{ padding: 12, margin: '-6px -10px -6px -6px' }} onClick={() => void removePayment(p)} aria-label={`Remove: ${payLine(p.from, p.to, true)} ${formatMinor(p.amountMinor, p.currency)}`}>
                      <Icon name="x" size={14} strokeWidth={2} />
                    </button>
                  </div>
                ))}
            </section>
          )}

          <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span className="label" style={{ fontSize: 10 }}>Where it went</span>
            {summary.byCategory.slice(0, 5).map((g) => {
              const cat = categories.find((c) => c.id === g.categoryId)
              const color = cat?.color ?? '#7A8794'
              return (
                <div key={g.categoryId ?? 'none'} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div className="row-between" style={{ gap: 10 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 14, minWidth: 0 }}>
                      <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: 5, background: color, flexShrink: 0 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cat?.name ?? 'Untagged'}</span>
                    </span>
                    <span className="txn-amount">{formatMinor(g.total, currency)}</span>
                  </div>
                  <Progress fraction={summary.total > 0 ? g.total / summary.total : 0} color={color} height={5} />
                </div>
              )
            })}
          </section>

          <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span className="label" style={{ fontSize: 10 }}>Every spend</span>
            {days.map(([iso, list]) => (
              <div key={iso} style={{ display: 'flex', flexDirection: 'column' }}>
                <span className="caption" style={{ fontSize: 12, fontWeight: 600 }}>{fmtDayHeading(iso)}</span>
                {list.map((e) => {
                  const cat = categories.find((c) => c.id === e.categoryId)
                  const color = cat?.color ?? '#7A8794'
                  return (
                    <button key={e.id} className="txn-row" onClick={() => onEditEntry(e)}>
                      <span className="txn-icon" style={{ background: `${color}26`, color, width: 38, height: 38 }}>
                        <Icon name={cat?.icon ?? 'dots'} size={18} />
                      </span>
                      <span className="txn-main">
                        <span className="txn-title">{e.note.trim() || cat?.name || 'Spend'}</span>
                        <span className="txn-sub" style={SUB_LINE}>
                          {`${name(e.paidBy)} paid · ${splitLabel(trip, e.among)}`}
                        </span>
                      </span>
                      <span className="txn-amount">{formatMinor(e.amountMinor, e.currency)}</span>
                    </button>
                  )
                })}
              </div>
            ))}
          </section>
        </>
      )}

      {on ? (
        <>
          {spends.length > 0 && (
            <button className="btn ghost" onClick={() => void finish()}>
              End the trip
            </button>
          )}
          <div className="sheet-cta">
            <button className="btn" onClick={onAddSpend}>
              <Icon name="plus" size={17} strokeWidth={2.4} /> Add a spend
            </button>
          </div>
        </>
      ) : (
        <button
          className="btn ghost"
          onClick={() => {
            void resumeTrip(trip.id)
            haptic('selection')
            showToast(`Trip mode is back on for ${trip.name}`)
          }}
        >
          Back to trip mode
        </button>
      )}

      <PaymentSheet open={recording} trip={trip} currency={currency} onClose={() => setRecording(false)} />
    </>
  )
}

/** Money handed over outside any spend: chipping in up front, or paying someone back part of it. */
function PaymentSheet({ open, trip, currency, onClose }: { open: boolean; trip: Trip; currency: string; onClose: () => void }) {
  // the usual case, a friend handing you money, needs only the amount
  const firstFriend = trip.people.find((p) => p.id !== ME)?.id ?? ME
  const [from, setFrom] = useState<string>(firstFriend)
  const [to, setTo] = useState<string>(ME)
  const [amount, setAmount] = useState('')
  const amountRef = useRef<HTMLInputElement>(null)
  const minor = parseAmount(amount)

  useEffect(() => {
    if (!open) return
    setFrom(firstFriend)
    setTo(ME)
    setAmount('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function save() {
    if (minor <= 0) {
      amountRef.current?.focus()
      return
    }
    await addTripPayment({ tripId: trip.id, from, to, amountMinor: minor, currency })
    haptic('success')
    onClose()
  }

  const people = (value: string, pick: (id: string) => void, skip: string | null) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {trip.people
        .filter((p) => p.id !== skip)
        .map((p) => (
          <button
            key={p.id}
            className={`chip${value === p.id ? ' selected' : ''}`}
            aria-pressed={value === p.id}
            onClick={() => {
              haptic('selection')
              pick(p.id)
            }}
          >
            {value === p.id && <Icon name="check" size={12} strokeWidth={2.8} />}
            {personLabel(trip, p.id)}
          </button>
        ))}
    </div>
  )

  return (
    <Sheet open={open} onClose={onClose} label="Someone handed over money" style={{ gap: 12 }}>
      <div className="row-between">
        <span className="label" style={{ letterSpacing: '0.14em' }}>Someone handed over money</span>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <Icon name="x" size={14} strokeWidth={2.2} />
        </button>
      </div>
      <span className="caption" style={{ textWrap: 'pretty' }}>
        Chipping in up front or paying part of it back. It counts towards who pays whom, and stays out of your own expenses.
      </span>
      <span className="label" style={{ fontSize: 10 }}>Who gave it?</span>
      {people(from, (id) => {
        setFrom(id)
        if (id === to) setTo(trip.people.find((p) => p.id !== id)?.id ?? ME)
      }, null)}
      <span className="label" style={{ fontSize: 10 }}>To whom?</span>
      {people(to, setTo, from)}
      <input
        ref={amountRef}
        className="field mono"
        inputMode="decimal"
        aria-label="Amount"
        placeholder={`Amount in ${currencySymbol(currency)}`}
        value={amount}
        maxLength={12}
        onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void save()
        }}
      />
      <div className="sheet-cta">
        <button className="btn" onClick={() => void save()}>
          {minor > 0 ? `${personLabel(trip, from)} gave ${formatMinor(minor, currency)}` : 'Save'}
        </button>
      </div>
    </Sheet>
  )
}

/** Starting a trip, or changing one. */
function TripForm({
  trip,
  running,
  knownNames,
  currency,
  onBack,
  onDone,
  onDeleted
}: {
  trip: Trip | null
  running: Trip | null
  knownNames: string[]
  currency: string
  onBack: () => void
  onDone: (id: string) => void
  onDeleted?: () => void
}) {
  const { showToast } = useUi()
  const [name, setName] = useState(trip?.name ?? '')
  const [myName, setMyName] = useState(trip?.people.find((p) => p.id === ME)?.name ?? '')
  const [others, setOthers] = useState<TripPerson[]>(trip?.people.filter((p) => p.id !== ME) ?? [])
  const [typing, setTyping] = useState('')
  const [budget, setBudget] = useState(trip?.budgetMinor != null ? String(trip.budgetMinor / 100) : '')
  const typingRef = useRef<HTMLInputElement>(null)

  const loans = useLiveQuery(() => db.loans.toArray(), []) ?? []
  const entries = useLiveQuery(() => (trip ? db.tripEntries.where('tripId').equals(trip.id).toArray() : []), [trip?.id]) ?? []
  const payments = useLiveQuery(() => (trip ? db.tripPayments.where('tripId').equals(trip.id).toArray() : []), [trip?.id]) ?? []

  useEffect(() => {
    if (trip) return
    void getSettings().then((s) => setMyName((v) => v || s.myName))
  }, [trip])

  const taken = (n: string) => others.some((p) => p.name.trim().toLowerCase() === n.trim().toLowerCase())
  // people you've split or lent with before are one tap away
  const suggestions = useMemo(
    () =>
      [...new Set([...knownNames, ...[...loans].sort((a, b) => b.createdAt - a.createdAt).map((l) => l.person)])]
        .filter((n) => !taken(n))
        .slice(0, 6),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [knownNames, loans, others]
  )
  const inUse = (id: string) =>
    entries.some((e) => !e.deleted && (e.paidBy === id || e.among.includes(id))) || payments.some((p) => p.from === id || p.to === id)

  function addPerson(n: string) {
    const clean = n.trim()
    if (!clean) return
    haptic('selection')
    if (!taken(clean)) setOthers((list) => [...list, { id: crypto.randomUUID(), name: clean }])
    setTyping('')
  }

  const budgetMinor = budget.trim() ? parseAmount(budget) || null : null
  // a name still in the box counts: people tap Start without tapping Add
  const typed = typing.trim() && !taken(typing) ? typing.trim() : ''
  const friends = others.length + (typed ? 1 : 0)
  // the first thing still needed, in the order the form asks for it
  const blankRow = others.find((p) => !p.name.trim())
  const missing = !name.trim() ? 'trip-name' : !myName.trim() ? 'trip-my-name' : blankRow ? `trip-person-${blankRow.id}` : friends === 0 ? 'trip-person' : null

  async function save() {
    if (missing) {
      document.getElementById(missing)?.focus()
      return
    }
    const going = typed ? [...others, { id: crypto.randomUUID(), name: typed }] : others
    if (trip) {
      await updateTrip(trip, { name, people: [{ id: ME, name: myName }, ...going], budgetMinor })
      haptic('success')
      showToast('Trip updated')
      onDone(trip.id)
      return
    }
    const made = await startTrip({ name, myName, others: going.map((p) => p.name), budgetMinor })
    haptic('success')
    showToast(`Trip mode is on. Spends now split between ${going.length + 1} of you`)
    onDone(made.id)
  }

  async function remove() {
    if (!trip) return
    const deleted = await deleteTrip(trip.id)
    haptic('medium')
    onDeleted?.()
    if (deleted) {
      showToast(`Deleted ${trip.name}. Your share of its spends stays in your expenses`, () => {
        void restoreTrip(deleted)
      })
    }
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="icon-btn" onClick={onBack} aria-label="Back">
          <Icon name="chevronLeft" size={14} strokeWidth={2.2} />
        </button>
        <span className="label" style={{ letterSpacing: '0.14em' }}>{trip ? 'Edit trip' : 'Start a trip'}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label className="label" style={{ fontSize: 10 }} htmlFor="trip-name">Where are you going?</label>
        <input
          id="trip-name"
          className="field"
          placeholder="Goa, Manali, the office offsite"
          value={name}
          maxLength={28}
          autoComplete="off"
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label className="label" style={{ fontSize: 10 }} htmlFor="trip-my-name">Your name</label>
        <input
          id="trip-my-name"
          className="field"
          placeholder="What friends call you"
          value={myName}
          maxLength={24}
          autoComplete="given-name"
          onChange={(e) => setMyName(e.target.value)}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label className="label" style={{ fontSize: 10 }} htmlFor="trip-person">Who's coming?</label>
        {trip ? (
          // an existing trip: names can be corrected, and anyone with nothing on the trip yet can go
          others.map((p) => (
            <div key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                id={`trip-person-${p.id}`}
                className="field"
                aria-label={`Name of ${p.name}`}
                value={p.name}
                maxLength={24}
                onChange={(e) => setOthers((list) => list.map((o) => (o.id === p.id ? { ...o, name: e.target.value } : o)))}
              />
              {others.length > 1 && !inUse(p.id) && (
                <button
                  className="icon-btn"
                  aria-label={`Remove ${p.name}`}
                  onClick={() => setOthers((list) => list.filter((o) => o.id !== p.id))}
                >
                  <Icon name="x" size={14} strokeWidth={2.2} />
                </button>
              )}
            </div>
          ))
        ) : (
          others.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {others.map((p) => (
                <button
                  key={p.id}
                  className="chip selected"
                  aria-label={`Remove ${p.name}`}
                  onClick={() => {
                    haptic('selection')
                    setOthers((list) => list.filter((o) => o.id !== p.id))
                  }}
                >
                  {p.name}
                  <Icon name="x" size={11} strokeWidth={2.6} />
                </button>
              ))}
            </div>
          )
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            id="trip-person"
            ref={typingRef}
            className="field"
            placeholder="A friend's name"
            value={typing}
            maxLength={24}
            autoComplete="off"
            onChange={(e) => setTyping(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addPerson(typing)
            }}
          />
          <button
            className="btn"
            style={{ width: 86 }}
            disabled={!typing.trim()}
            onClick={() => {
              addPerson(typing)
              // the next name is usually coming: keep the keyboard up
              typingRef.current?.focus()
            }}
          >
            Add
          </button>
        </div>
        {suggestions.length > 0 && !trip && (
          <div className="chip-row" style={{ paddingBottom: 2 }}>
            {suggestions.map((n) => (
              <button key={n} className="chip" style={{ flexShrink: 0 }} onClick={() => addPerson(n)}>
                <Icon name="plus" size={11} strokeWidth={2.6} />
                {n}
              </button>
            ))}
          </div>
        )}
        <span className="caption" style={{ fontSize: 11.5 }}>Just names. Nobody needs an account, or even the app.</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label className="label" style={{ fontSize: 10 }} htmlFor="trip-budget">Total budget, if you have one</label>
        <input
          id="trip-budget"
          className="field mono"
          inputMode="decimal"
          placeholder={`${currencySymbol(currency)} for everyone together`}
          value={budget}
          maxLength={12}
          onChange={(e) => setBudget(e.target.value.replace(/[^\d.,]/g, ''))}
        />
      </div>

      {!trip && running && (
        <span className="caption" style={{ textWrap: 'pretty' }}>
          {running.name} stops taking new spends when this one starts. You can go back to it any time.
        </span>
      )}

      {trip && (
        <button className="btn danger" onClick={() => void remove()}>
          <Icon name="trash" size={15} /> Delete trip
        </button>
      )}

      <div className="sheet-cta">
        <button className="btn" onClick={() => void save()}>
          {trip ? 'Save changes' : missing ? 'Start the trip' : `Start with ${friends + 1} people`}
        </button>
      </div>
    </>
  )
}
