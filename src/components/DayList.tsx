import { useMemo, useState } from 'react'
import type { Category, Txn } from '../db/db'
import { groupByDay } from '../db/stats'
import { formatMinor } from '../lib/money'
import { fmtDayHeading } from '../lib/dates'
import { TransactionRow } from './TransactionRow'

/**
 * Entries by day, newest first: each day under its heading with what went out that day. For a sheet, whose own
 * heading is an h2, so a screen reader lists the days (h3) under it. A tap on a row opens it to change it.
 * With `pageSize`, only that many rows show until "Show more"; a day cut in two still heads with its whole total.
 */
export function DayList({
  txns,
  categories,
  currency,
  onEdit,
  pageSize
}: {
  /** newest first */
  txns: Txn[]
  categories: Category[]
  currency: string
  onEdit: (t: Txn) => void
  pageSize?: number
}) {
  const [limit, setLimit] = useState(pageSize ?? Infinity)
  const shown = useMemo(() => (txns.length > limit ? txns.slice(0, limit) : txns), [txns, limit])
  const days = useMemo(() => groupByDay(shown), [shown])
  const dayTotals = useMemo(
    () => (shown === txns ? null : new Map(groupByDay(txns).map((d) => [d.iso, d.total]))),
    [shown, txns]
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {days.map((d) => (
        <div key={d.iso}>
          <div className="day-heading">
            <h3 className="label" style={{ fontSize: 10.5 }}>
              {fmtDayHeading(d.iso)}
            </h3>
            <span className="mono faint" style={{ fontWeight: 600, fontSize: 12 }}>
              {formatMinor(dayTotals?.get(d.iso) ?? d.total, currency)}
            </span>
          </div>
          {d.txns.map((t) => (
            <TransactionRow key={t.id} txn={t} categories={categories} onClick={() => onEdit(t)} />
          ))}
        </div>
      ))}
      {pageSize !== undefined && txns.length > limit && (
        <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => setLimit(limit + pageSize)}>
          Show more ({txns.length - limit} older)
        </button>
      )}
    </div>
  )
}
