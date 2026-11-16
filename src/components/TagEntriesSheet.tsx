import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Category, type Txn } from '../db/db'
import { fixedOf, stillDue, sum } from '../db/stats'
import { formatMinor } from '../lib/money'
import { monthLabel } from '../lib/dates'
import { useBudgetEditor } from './BudgetDialog'
import { BudgetLine } from './BudgetLine'
import { DayList } from './DayList'
import { Icon } from './Icon'
import { Sheet } from './Sheet'

export interface TagPick {
  /** null for spends without a tag */
  id: string | null
  name: string
  color: string
}

/**
 * What's behind one of Insights' "Where it went" rows, or a tag's card in Budgets: that tag's spends in the month, by
 * day, with the total, how many and the usual size, and its budget. A tap opens an entry to change it; this stays
 * open underneath, so a run of mis-tagged entries can be fixed one after another and leave the list as they go. The
 * budget line has "Change", for the amount; a tag without a budget offers to set one, in the same dialog Budgets uses.
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
  const month = monthLabel(monthKey)
  // the tag's own recurring payments this month, so the budget line's tick sits where its card's does
  const rules = useLiveQuery(() => db.rules.toArray(), []) ?? []
  const fixed = isCurrent && tag.id ? fixedOf(monthTxns, stillDue(rules, monthKey), tag.id) : undefined
  const share = monthSpent > 0 ? Math.round((total / monthSpent) * 100) : 0

  // a tag of yours can have a budget, set right here; not "Untagged", and not a new one for a tag you've put away
  const budgetEditor = useBudgetEditor()
  const cat = tag.id ? categories.find((c) => c.id === tag.id) : undefined
  const hasBudget = budgetMinor !== null && budgetMinor > 0
  const editBudget = () =>
    cat && budgetEditor.edit({ id: cat.id, title: `${tag.name} budget`, amount: hasBudget ? budgetMinor : null })

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

      {hasBudget ? (
        <BudgetLine
          spent={total}
          budgetMinor={budgetMinor}
          isCurrent={isCurrent}
          color={tag.color}
          owner="its"
          currency={currency}
          onChange={cat ? editBudget : undefined}
          changeLabel={`Change the ${tag.name} budget`}
          fixed={fixed}
        />
      ) : (
        cat &&
        !cat.archived && (
          // where the budget line would be, laid out as BudgetLine is: the words, then the link that sets one. The
          // sheet's heading names the tag already, so the words don't, and a long name can't push the link away
          <div className="row-between" style={{ flexWrap: 'wrap', rowGap: 2, padding: '2px 2px 0' }}>
            <span className="caption" style={{ fontSize: 12 }}>
              No budget yet
            </span>
            <button className="link-btn line-link" onClick={editBudget} aria-label={`Set a budget for ${tag.name}`}>
              Set a budget
            </button>
          </div>
        )
      )}

      <DayList txns={txns} categories={categories} currency={currency} onEdit={onEdit} />

      {budgetEditor.dialog}
    </Sheet>
  )
}
