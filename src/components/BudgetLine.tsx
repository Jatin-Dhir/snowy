import { pace } from '../db/stats'
import { formatMinor } from '../lib/money'
import { Progress } from './Progress'

/**
 * A month's spend against its budget, under that month's figures in a sheet: the bar (with today's tick while
 * the month is on) and what's left or over. A month that's over says how it ended instead: "under", not "left".
 */
export function BudgetLine({
  spent,
  budgetMinor,
  isCurrent,
  color,
  owner,
  currency
}: {
  spent: number
  budgetMinor: number
  isCurrent: boolean
  /** the bar while it's within budget and on pace */
  color: string
  /** whose budget the words name: a tag's ("its") or the month's ("your") */
  owner: 'its' | 'your'
  currency: string
}) {
  const p = pace(spent, budgetMinor)
  const left = budgetMinor - spent
  const budget = formatMinor(budgetMinor, currency)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: '2px 2px 0' }}>
      <Progress
        fraction={p.fraction}
        color={p.state === 'over' ? 'var(--over-fill)' : isCurrent && p.state === 'warn' ? 'var(--amber)' : color}
        tickFraction={isCurrent ? p.dayFraction : undefined}
      />
      <span
        className="caption"
        style={{ fontSize: 12, color: left < 0 ? 'var(--over-text)' : undefined, fontWeight: left < 0 ? 600 : undefined }}
      >
        {left < 0
          ? `${formatMinor(-left, currency)} over ${owner} ${budget} budget`
          : `${formatMinor(left, currency)} ${isCurrent ? 'left of' : 'under'} ${owner} ${budget} budget`}
      </span>
    </div>
  )
}
