import type { Trip } from '../db/db'
import { formatMinor } from '../lib/money'
import { ME, splitEvenly } from '../lib/split'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import { haptic } from '../state/ui'

export function personLabel(trip: Trip, id: string): string {
  return id === ME ? 'You' : (trip.people.find((p) => p.id === id)?.name ?? 'Someone')
}

/** "split 4", "split 3 of 4", "for you", "for Rahul" */
export function splitLabel(trip: Trip, among: string[]): string {
  if (among.length === trip.people.length) return `split ${among.length}`
  if (among.length === 1) return `for ${among[0] === ME ? 'you' : personLabel(trip, among[0])}`
  return `split ${among.length} of ${trip.people.length}`
}

/** Where a spend goes: into the trip or just yours, who put the money down, and who it's split between. */
export function TripSplitSheet({
  open,
  trip,
  amountMinor,
  currency,
  inTrip,
  paidBy,
  among,
  onInTrip,
  onPaidBy,
  onAmong,
  onClose
}: {
  open: boolean
  trip: Trip
  amountMinor: number
  currency: string
  inTrip: boolean
  paidBy: string
  among: string[]
  onInTrip: (on: boolean) => void
  onPaidBy: (id: string) => void
  onAmong: (ids: string[]) => void
  onClose: () => void
}) {
  const everyone = trip.people.map((p) => p.id)
  const shares = splitEvenly(amountMinor, among)
  const mine = shares.get(ME) ?? 0

  function toggle(id: string) {
    haptic('selection')
    // always someone's: the last person in the split stays in it
    if (among.includes(id) && among.length === 1) return
    // in the trip's own order, so the leftover paisa always lands the same way
    onAmong(everyone.filter((p) => (p === id ? !among.includes(id) : among.includes(p))))
  }

  const result = !inTrip
    ? `This one stays out of ${trip.name} and goes into your own expenses, the whole amount.`
    : amountMinor <= 0
      ? ''
      : among.length === 1
        ? `All ${formatMinor(amountMinor, currency)} on ${personLabel(trip, among[0])}`
        : `${formatMinor(Math.round(amountMinor / among.length), currency)} each · ${mine > 0 ? 'only your share counts as your spending' : 'none of it counts as your spending'}`

  return (
    <Sheet open={open} onClose={onClose} label={trip.name} style={{ gap: 12 }}>
      <div className="row-between">
        <span className="label" style={{ letterSpacing: '0.14em', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {trip.name}
        </span>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <Icon name="x" size={14} strokeWidth={2.2} />
        </button>
      </div>

      <span className="seg" role="group" aria-label="Where this spend goes" style={{ alignSelf: 'center' }}>
        <button
          className={inTrip ? 'on' : ''}
          aria-pressed={inTrip}
          onClick={() => {
            haptic('selection')
            onInTrip(true)
          }}
        >
          In the trip
        </button>
        <button
          className={!inTrip ? 'on' : ''}
          aria-pressed={!inTrip}
          onClick={() => {
            haptic('selection')
            onInTrip(false)
          }}
        >
          Just mine
        </button>
      </span>

      {inTrip && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="label" style={{ fontSize: 10 }} id="trip-paid-by">Who paid?</span>
            <div role="group" aria-labelledby="trip-paid-by" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {trip.people.map((p) => (
                <button
                  key={p.id}
                  className={`chip${paidBy === p.id ? ' selected' : ''}`}
                  aria-pressed={paidBy === p.id}
                  onClick={() => {
                    haptic('selection')
                    onPaidBy(p.id)
                  }}
                >
                  {paidBy === p.id && <Icon name="check" size={12} strokeWidth={2.8} />}
                  {personLabel(trip, p.id)}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="row-between">
              <span className="label" style={{ fontSize: 10 }} id="trip-split-between">Split between</span>
              {among.length < everyone.length && (
                <button
                  className="caption"
                  style={{ fontWeight: 700, padding: '10px 0', margin: '-6px 0', textDecoration: 'underline', textUnderlineOffset: 3 }}
                  onClick={() => {
                    haptic('selection')
                    onAmong(everyone)
                  }}
                >
                  Everyone
                </button>
              )}
            </div>
            <div role="group" aria-labelledby="trip-split-between" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {trip.people.map((p) => {
                const on = among.includes(p.id)
                return (
                  <button key={p.id} className={`chip${on ? ' selected' : ''}`} aria-pressed={on} onClick={() => toggle(p.id)}>
                    {on && <Icon name="check" size={12} strokeWidth={2.8} />}
                    {personLabel(trip, p.id)}
                  </button>
                )
              })}
            </div>
          </div>

        </>
      )}

      <span className="caption" role="status" style={{ textAlign: 'center', textWrap: 'pretty' }}>
        {result}
      </span>

      <div className="sheet-cta">
        <button className="btn" onClick={onClose}>
          Done
        </button>
      </div>
    </Sheet>
  )
}
