import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Txn } from '../db/db'
import { txnsForMonth } from '../db/repo'
import { fixedOf, incomeSum, isRecurring, stillDue, sum } from '../db/stats'
import { formatMinor } from '../lib/money'
import { addMonths, currentMonthKey, daysInMonth, monthLabel, todayISO } from '../lib/dates'
import { useBudgetEditor } from './BudgetDialog'
import { BudgetLine } from './BudgetLine'
import { DayList } from './DayList'
import { Icon } from './Icon'
import { MonthPicker } from './MonthPicker'
import { Sheet } from './Sheet'

/** Rows shown before "Show more": a whole month of a busy ledger at once is a long list to build. */
const PAGE = 150

/** Holds a line's height while its month loads, so nothing below jumps */
const NBSP = String.fromCharCode(160)

/**
 * One month read back, day by day: what went out and in, each day's spend under its heading, and the month's total.
 * The arrows step through the months, and the month's name opens every month to jump straight to one; "Back to
 * November" comes back to now from any of them, and so does closing it. A tap on an entry opens it to change it,
 * and this stays open underneath; so does the budget line's "Change".
 * Opened from Activity's header, Home's month, Insights' "Spent" (on the month Insights shows) and the monthly
 * budget's card in Budgets.
 */
export function MonthSheet({
  currency,
  initialMonth,
  onEdit,
  onClose
}: {
  currency: string
  /** the month it opens on, "2026-09"; this month without one */
  initialMonth?: string
  onEdit: (t: Txn) => void
  onClose: () => void
}) {
  const nowKey = currentMonthKey()
  const [monthKey, setMonthKey] = useState(() => (initialMonth && initialMonth < nowKey ? initialMonth : nowKey))
  const budgetEditor = useBudgetEditor()
  const [picking, setPicking] = useState(false)
  const isCurrent = monthKey === nowKey
  const label = monthLabel(monthKey)

  const categories = useLiveQuery(() => db.categories.orderBy('sort').toArray(), []) ?? []
  const overall = useLiveQuery(() => db.budgets.get('overall'), [])
  const rules = useLiveQuery(() => db.rules.toArray(), []) ?? []
  // tagged with its month: while the next month loads, the one before mustn't show under the new name
  const loaded = useLiveQuery(async () => ({ key: monthKey, txns: await txnsForMonth(monthKey) }), [monthKey])
  const txns = loaded?.key === monthKey ? loaded.txns : null

  const spent = txns ? sum(txns) : 0
  const received = txns ? incomeSum(txns) : 0
  const count = txns?.length ?? 0
  // an average, so whole rupees, like Insights' report: over the days so far, or the whole month once it's done. As
  // Home's week, its recurring payments stay out of it: rent paid on the 1st isn't "₹14,200 a day"
  const days = isCurrent ? parseInt(todayISO().slice(8, 10), 10) : daysInMonth(monthKey)
  const perDay = Math.round((txns ? sum(txns.filter((t) => !isRecurring(t))) : 0) / days / 100) * 100
  const budgetMinor = overall && overall.amountMinor > 0 ? overall.amountMinor : null

  // a button that goes away as it's pressed ("Back to …"), or stops working (› on reaching this month), hands its
  // focus to ‹ rather than drop it off the sheet
  const prev = useRef<HTMLButtonElement>(null)
  const keepFocus = (el: HTMLElement) => {
    if (document.activeElement === el) prev.current?.focus({ preventScroll: true })
  }

  return (
    // as tall as it goes, whatever the month holds: the arrows stay under the finger from one month to the next
    <Sheet open onClose={onClose} label={`${label}, day by day`} style={{ gap: 10, minHeight: 'calc(100dvh - 40px)' }}>
      <div className="row-between">
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
          <button ref={prev} className="icon-btn" onClick={() => setMonthKey(addMonths(monthKey, -1))} aria-label="Previous month">
            <Icon name="chevronLeft" size={16} />
          </button>
          {/* the sheet's heading: its days (h3) sit under it. The arrows step it on; its name opens every month */}
          <h2 className="month-title" aria-live="polite">
            <button className="month-pick" aria-haspopup="dialog" onClick={() => setPicking(true)}>
              {label}
              <span className="month-pick-chev" aria-hidden="true">
                <Icon name="chevronDown" size={11} strokeWidth={2.4} />
              </span>
            </button>
          </h2>
          <button
            className="icon-btn"
            onClick={(e) => {
              const next = addMonths(monthKey, 1)
              if (next === nowKey) keepFocus(e.currentTarget)
              setMonthKey(next)
            }}
            disabled={isCurrent}
            style={isCurrent ? { opacity: 0.35 } : undefined}
            aria-label="Next month"
          >
            <Icon name="chevronRight" size={16} />
          </button>
        </span>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <Icon name="x" size={14} strokeWidth={2.2} />
        </button>
      </div>

      <div className="well" style={{ gap: 4, padding: '12px 14px' }}>
        <div className="row-between" style={{ flexWrap: 'wrap', rowGap: 2 }}>
          <span className="well-num" style={{ fontSize: 22 }}>
            {txns ? formatMinor(spent, currency) : NBSP}
          </span>
          {!isCurrent && (
            <button
              className="link-btn month-now"
              onClick={(e) => {
                keepFocus(e.currentTarget)
                setMonthKey(nowKey)
              }}
            >
              Back to {monthLabel(nowKey)}
            </button>
          )}
        </div>
        <span className="caption" style={{ fontSize: 12 }}>
          {!txns
            ? NBSP
            : count === 0
              ? `Nothing logged in ${label}${isCurrent ? ' yet' : ''}`
              : [
                  isCurrent ? 'Spent so far' : 'Spent',
                  `${count} ${count === 1 ? 'entry' : 'entries'}`,
                  spent > 0 ? `${formatMinor(perDay, currency)} a day` : null
                ]
                  .filter(Boolean)
                  .join(' · ')}
        </span>
        {received > 0 && (
          <span className="caption" style={{ fontSize: 12, color: 'var(--pos-text)', fontWeight: 600 }}>
            Received +{formatMinor(received, currency)}
          </span>
        )}
      </div>

      {/* not for a month with nothing in it, often one from before Taily: "₹50,000 under" would be no news. Nor for a
          past one with only money received in it (a refund logged back then): nothing spent is the same no news */}
      {txns && count > 0 && (isCurrent || spent > 0) && budgetMinor !== null && (
        <BudgetLine
          spent={spent}
          budgetMinor={budgetMinor}
          isCurrent={isCurrent}
          color="var(--pos)"
          owner="your"
          currency={currency}
          onChange={() => budgetEditor.edit({ id: 'overall', title: 'Monthly budget', amount: budgetMinor })}
          changeLabel="Change the monthly budget"
          fixed={isCurrent ? fixedOf(txns, stillDue(rules, monthKey)) : undefined}
        />
      )}

      {txns && count > 0 && (
        <DayList key={monthKey} txns={txns} categories={categories} currency={currency} onEdit={onEdit} pageSize={PAGE} />
      )}

      {picking && <MonthPicker value={monthKey} currency={currency} onPick={setMonthKey} onClose={() => setPicking(false)} />}
      {budgetEditor.dialog}
    </Sheet>
  )
}
