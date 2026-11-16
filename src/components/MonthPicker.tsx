import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { spendByMonth } from '../db/repo'
import { formatCompact, formatMinor } from '../lib/money'
import { currentMonthKey, monthLabel, monthShort } from '../lib/dates'
import { haptic } from '../state/ui'
import { Icon } from './Icon'
import { Sheet } from './Sheet'

const MONTH_NUMBERS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'))

/**
 * Every month there's something logged in, a year to a grid, newest year first: a tap goes straight to that month.
 * Each month says what went out in it, so a heavy month is easy to find. A month with nothing in it, or still to
 * come, can't be picked; this month always can. Opened by the month's name in the month view and in Insights.
 */
export function MonthPicker({
  value,
  currency,
  onPick,
  onClose
}: {
  /** the month showing now, "2026-11" */
  value: string
  currency: string
  onPick: (monthKey: string) => void
  onClose: () => void
}) {
  const nowKey = currentMonthKey()
  // undefined while it loads: the grid waits for it, so the month showing is there for focus to land on
  const totals = useLiveQuery(() => spendByMonth(), [])

  const years = useMemo(() => {
    if (!totals) return null
    const found = new Set([Number(nowKey.slice(0, 4)), Number(value.slice(0, 4))])
    for (const key of totals.keys()) if (key <= nowKey) found.add(Number(key.slice(0, 4)))
    return [...found].sort((a, b) => b - a)
  }, [totals, nowKey, value])

  function pick(key: string) {
    haptic('selection')
    onPick(key)
    onClose()
  }

  return (
    <Sheet open onClose={onClose} label="Jump to a month" style={{ gap: 12 }}>
      <div className="row-between">
        <h2 className="label" style={{ letterSpacing: '0.14em' }}>
          Jump to a month
        </h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <Icon name="x" size={14} strokeWidth={2.2} />
        </button>
      </div>

      {totals &&
        years?.map((year) => (
          <section key={year} className="month-year" aria-labelledby={`month-year-${year}`}>
            <h3 className="label" id={`month-year-${year}`}>
              {year}
            </h3>
            <div className="pick-grid">
              {MONTH_NUMBERS.map((mm) => {
                const key = `${year}-${mm}`
                const spent = totals.get(key)
                const shown = key === value
                const isNow = key === nowKey
                const open = key <= nowKey && (spent !== undefined || isNow || shown)
                const name = `${monthLabel(key, { withYear: true })}${isNow ? ', this month' : ''}`
                return (
                  <button
                    key={key}
                    className={`pick-key${shown ? ' on' : ''}${isNow ? ' now' : ''}`}
                    disabled={!open}
                    aria-pressed={shown}
                    aria-label={
                      spent !== undefined
                        ? `${name}: ${formatMinor(spent, currency)} spent`
                        : key > nowKey
                          ? name
                          : `${name}: nothing logged`
                    }
                    // the month showing has the focus, so the keys and a screen reader start from where you are
                    autoFocus={shown}
                    onClick={() => pick(key)}
                  >
                    <span className="pick-key-name">{monthShort(key)}</span>
                    <span className="pick-key-sum mono">{spent !== undefined ? formatCompact(spent, currency) : ''}</span>
                  </button>
                )
              })}
            </div>
          </section>
        ))}
    </Sheet>
  )
}
