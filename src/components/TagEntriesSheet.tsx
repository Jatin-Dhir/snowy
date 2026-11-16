import { useMemo } from 'react'
import type { Category, Txn } from '../db/db'
import { groupByDay, pace, sum } from '../db/stats'
import { formatMinor } from '../lib/money'
import { fmtDayHeading, monthLabel } from '../lib/dates'
import { Icon } from './Icon'
import { Progress } from './Progress'
import { Sheet } from './Sheet'
import { TransactionRow } from './TransactionRow'

export interface TagPick {
  /** null for spends without a tag */
  id: string | null
  name: string
  color: string
}

/**
 * What's behind one of Insights' "Where it went" rows: that tag's spends in the month, by day, with the total,
 * how many and the usual size, and its budget when it has one. A tap opens an entry to change it; this stays
 * open underneath, so a run of mis-tagged entries can be fixed one after another and leave the list as they go.
 */
export function TagEntriesSheet({
  tag,
  monthKey,
  isCurrent,
  monthTxns,
  monthSpent,
  budgetMinor,
  categories,
  currency,
  onEdit,
  onClose
}: {
  tag: TagPick
  monthKey: string
  isCurrent: boolean
  /** the month's entries, every tag */
  monthTxns: Txn[]
  monthSpent: number
  budgetMinor: number | null
  categories: Category[]
  currency: string
  onEdit: (t: Txn) => void
  onClose: () => void
}) {
  const txns = useMemo(
    () => monthTxns.filter((t) => (t.kind ?? 'out') === 'out' && (t.categoryId ?? null) === tag.id),
    [monthTxns, tag.id]
  )
  const total = sum(txns)
  const days = useMemo(() => groupByDay(txns), [txns])
  const month = monthLabel(monthKey)
  const share = monthSpent > 0 ? Math.round((total / monthSpent) * 100) : 0
  const tagPace = budgetMinor ? pace(total, budgetMinor) : null
  const left = budgetMinor ? budgetMinor - total : 0

  return (
    <Sheet open onClose={onClose} label={`${tag.name} in ${month}`} style={{ gap: 10 }}>
      <div className="row-between">
        {/* the sheet's heading, so its days (h3) sit under it for a screen reader's list of headings */}
        <h2 className="label" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, letterSpacing: '0.14em', minWidth: 0 }}>
          <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 4, background: tag.color, flexShrink: 0 }} />
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {tag.name} · {month}
          </span>
        </h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <Icon name="x" size={14} strokeWidth={2.2} />
        </button>
      </div>

      <div className="well" style={{ gap: 4, padding: '12px 14px' }}>
        <span className="well-num" style={{ fontSize: 22 }}>
          {formatMinor(total, currency)}
        </span>
        <span className="caption" style={{ fontSize: 12 }}>
          {txns.length === 0
            ? `Nothing tagged ${tag.name} in ${month} now`
            : `${txns.length} ${txns.length === 1 ? 'entry' : 'entries'}` +
              (txns.length > 1 ? ` · ${formatMinor(Math.round(total / txns.length / 100) * 100, currency)} on average` : '') +
              ` · ${share}% of ${month}`}
        </span>
      </div>

      {budgetMinor !== null && tagPace && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: '2px 2px 0' }}>
          <Progress
            fraction={tagPace.fraction}
            color={tagPace.state === 'over' ? 'var(--over-fill)' : isCurrent && tagPace.state === 'warn' ? 'var(--amber)' : tag.color}
            tickFraction={isCurrent ? tagPace.dayFraction : undefined}
          />
          <span
            className="caption"
            style={{ fontSize: 12, color: left < 0 ? 'var(--over-text)' : undefined, fontWeight: left < 0 ? 600 : undefined }}
          >
            {left >= 0
              ? `${formatMinor(left, currency)} left of its ${formatMinor(budgetMinor, currency)} budget`
              : `${formatMinor(-left, currency)} over its ${formatMinor(budgetMinor, currency)} budget`}
          </span>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {days.map((d) => (
          <div key={d.iso}>
            <div className="day-heading">
              <h3 className="label" style={{ fontSize: 10.5 }}>
                {fmtDayHeading(d.iso)}
              </h3>
              <span className="mono faint" style={{ fontWeight: 600, fontSize: 12 }}>
                {formatMinor(d.total, currency)}
              </span>
            </div>
            {d.txns.map((t) => (
              <TransactionRow key={t.id} txn={t} categories={categories} onClick={() => onEdit(t)} />
            ))}
          </div>
        ))}
      </div>
    </Sheet>
  )
}
