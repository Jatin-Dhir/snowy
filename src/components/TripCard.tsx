import { useLiveQuery } from 'dexie-react-hooks'
import { tripsOverview } from '../db/trips'
import { formatMinor } from '../lib/money'
import { Icon } from './Icon'
import { Progress } from './Progress'

// a position this small is the rounding of a currency switch
const SQUARE_BELOW = 50

function position(mine: number, currency: string): string {
  if (mine >= SQUARE_BELOW) return `you get back ${formatMinor(mine, currency)}`
  if (mine <= -SQUARE_BELOW) return `you owe ${formatMinor(-mine, currency)}`
  return 'all square'
}

/** While a trip is on, it leads Home: this is what every spend is going into. */
export function TripCard({ currency, onOpen }: { currency: string; onOpen: () => void }) {
  const on = useLiveQuery(() => tripsOverview(), [])?.find((o) => !o.trip.endedISO)
  if (!on) return null
  const { trip, summary } = on
  const budget = trip.budgetMinor
  return (
    <button
      className="card"
      style={{ display: 'flex', flexDirection: 'column', gap: 9, padding: '11px 14px', borderRadius: 14, textAlign: 'left', width: '100%' }}
      onClick={onOpen}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
        <span className="txn-icon" style={{ background: 'var(--pos-soft)', color: 'var(--accent)', width: 36, height: 36 }}>
          <Icon name="trip" size={18} />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {trip.name}
          </span>
          <span className="caption" style={{ fontSize: 12 }}>
            {summary.total > 0 ? position(summary.mine, currency) : `Spends now split between ${trip.people.length} of you`}
          </span>
        </span>
        <span className="mono" style={{ fontWeight: 700, fontSize: 16 }}>{formatMinor(summary.total, currency)}</span>
      </span>
      {budget !== null && (
        <Progress fraction={budget > 0 ? summary.total / budget : 0} color={summary.total > budget ? 'var(--red)' : 'var(--pos)'} height={5} />
      )}
    </button>
  )
}

/** The way in when no trip is on, with a past trip that's still got money to settle up front. */
export function TripsRow({ currency, onOpen }: { currency: string; onOpen: () => void }) {
  const overview = useLiveQuery(() => tripsOverview(), [])
  if (!overview || overview.some((o) => !o.trip.endedISO)) return null
  const unsettled = overview.find((o) => Math.abs(o.summary.mine) >= SQUARE_BELOW)
  // one of Home's tiles
  return (
    <button className="card tile" onClick={onOpen}>
      <span className="tile-icon">
        <Icon name="trip" size={17} />
      </span>
      <span className="tile-name">Trips</span>
      <span className="tile-line">
        {unsettled ? `${unsettled.trip.name}: ${position(unsettled.summary.mine, currency)}` : 'Split a trip with friends'}
      </span>
    </button>
  )
}
