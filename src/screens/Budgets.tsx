import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Goal, type Txn } from '../db/db'
import { addGoal, addToGoal, deleteGoal, restoreGoal, updateGoal } from '../db/goals'
import { addTxn, recentTxns, txnsForMonth } from '../db/repo'
import { byCategory, fixedOf, pace, projectMonth, stillDue, sum } from '../db/stats'
import { upcomingRules } from '../db/recurring'
import { formatMinor } from '../lib/money'
import { guessAccount } from '../lib/smart'
import { currentMonthKey, daysInMonth, monthLabel, shortDate, todayISO } from '../lib/dates'
import { Progress } from '../components/Progress'
import { Icon } from '../components/Icon'
import { Sheet } from '../components/Sheet'
import { TagManager } from '../components/TagManager'
import { RecurringManager } from '../components/RecurringManager'
import { TagEntriesSheet, type TagPick } from '../components/TagEntriesSheet'
import { MonthSheet } from '../components/MonthSheet'
import { useBudgetEditor } from '../components/BudgetDialog'
import { haptic, useUi } from '../state/ui'

/** Create or manage one savings goal: rename, retarget, add or take out money. */
function GoalDialog({
  goal,
  currency,
  onClose
}: {
  goal: Goal | null
  currency: string
  onClose: () => void
}) {
  const { showToast } = useUi()
  const [name, setName] = useState(goal?.name ?? '')
  const shownTarget = goal ? String(Math.round(goal.targetMinor / 100)) : ''
  const [target, setTarget] = useState(shownTarget)
  const [amount, setAmount] = useState('')
  // the field holds whole units: left as it opened (a rename), it stands for the goal's exact target
  const targetMinor = goal && target === shownTarget ? goal.targetMinor : (parseInt(target, 10) || 0) * 100
  const amountMinor = Math.round(parseFloat(amount) * 100) || 0
  const canSave = name.trim().length > 0 && targetMinor > 0
  const accounts = useLiveQuery(() => db.accounts.toArray(), []) ?? []
  const recent = useLiveQuery(() => recentTxns(600), []) ?? []

  async function save() {
    if (!canSave) return
    if (goal) {
      await updateGoal(goal.id, { name: name.trim(), targetMinor })
      showToast('Goal updated')
    } else {
      await addGoal(name.trim(), targetMinor)
      showToast(`Saving for ${name.trim()} — add to it any time`)
    }
    haptic('success')
    onClose()
  }

  async function move(sign: 1 | -1) {
    if (!goal || amountMinor <= 0) return
    // only what's in the goal can come out of it: any more would land in the balance from nowhere
    const held = (await db.goals.get(goal.id))?.savedMinor ?? 0
    const moved = sign === 1 ? amountMinor : Math.min(amountMinor, held)
    if (moved <= 0) return
    // a real transaction, same as the Home nudge — money into savings comes
    // off what's left to spend; money back out shows up as available again
    await addTxn({
      amountMinor: moved,
      currency,
      categoryId: 'savings',
      accountId: guessAccount(accounts, recent) ?? 'upi',
      kind: sign === 1 ? 'out' : 'in',
      note: goal.name,
      // the entry knows its goal, so deleting it takes the money back out
      goalId: goal.id
    })
    await addToGoal(goal.id, sign * moved)
    haptic('success')
    const g = await db.goals.get(goal.id)
    if (g && sign === 1) {
      showToast(
        g.savedMinor >= g.targetMinor
          ? `${g.name} fully funded — you did it!`
          : `Added — ${formatMinor(Math.max(0, g.targetMinor - g.savedMinor), currency)} to go`
      )
    } else if (g) {
      showToast(moved < amountMinor ? `Took out ${formatMinor(moved, currency)}, all ${g.name} had` : `Took out ${formatMinor(moved, currency)}`)
    }
    setAmount('')
    onClose()
  }

  return (
    <Sheet open onClose={onClose} label={goal ? goal.name : 'New goal'} style={{ gap: 12 }}>
      <div className="row-between">
        <span className="label" style={{ letterSpacing: '0.14em' }}>
          {goal ? 'Edit goal' : 'Saving for…'}
        </span>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <Icon name="x" size={14} strokeWidth={2.2} />
        </button>
      </div>

      {goal && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="label" style={{ fontSize: 10 }}>Add or take out money</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <input aria-label="Amount"
              className="field mono"
              type="number"
              inputMode="decimal"
              placeholder="Amount"
              value={amount}
              min={0}
              onChange={(e) => setAmount(e.target.value)}
            />
            <button className="btn" style={{ width: 96 }} disabled={amountMinor <= 0} onClick={() => void move(1)}>
              Add
            </button>
            <button
              className="btn ghost"
              style={{ width: 96 }}
              disabled={amountMinor <= 0 || goal.savedMinor <= 0}
              onClick={() => void move(-1)}
            >
              Take out
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className="label" style={{ fontSize: 10 }}>{goal ? 'Rename or retarget' : 'What and how much?'}</span>
        <input aria-label="What you're saving for"
          className="field"
          placeholder="What for? — e.g. iPhone, Goa trip, emergency fund"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
        />
        <input aria-label="Target amount"
          className="field mono"
          type="number"
          inputMode="numeric"
          placeholder="Target amount"
          value={target}
          min={0}
          onChange={(e) => setTarget(e.target.value)}
        />
        <button className="btn" disabled={!canSave} onClick={() => void save()}>
          {goal ? 'Save changes' : 'Start saving'}
        </button>
        {goal && (
          <button
            className="btn danger"
            onClick={() => {
              void deleteGoal(goal.id).then((removed) => {
                showToast(`${goal.name} removed`, removed ? () => void restoreGoal(removed) : undefined)
              })
              onClose()
            }}
          >
            Delete this goal
          </button>
        )}
      </div>
    </Sheet>
  )
}

export function Budgets({
  currency,
  onEdit,
  onOpenSettings
}: {
  currency: string
  onEdit: (t: Txn) => void
  onOpenSettings: () => void
}) {
  const monthKey = currentMonthKey()
  const today = todayISO()
  const budgetEditor = useBudgetEditor()
  const [pickingCategory, setPickingCategory] = useState(false)
  const [manageTags, setManageTags] = useState(false)
  const [goalDialog, setGoalDialog] = useState<{ goal: Goal | null } | null>(null)
  // a budget's card opens what made it up: a tag's entries, or the whole month's for the monthly budget. The tag's
  // sheet keeps the month it was opened for: open at midnight as a month ends, it would otherwise follow the screen
  // into a month with nothing in it yet
  const [openTag, setOpenTag] = useState<(TagPick & { monthKey: string }) | null>(null)
  const [monthOpen, setMonthOpen] = useState(false)

  const categories = useLiveQuery(() => db.categories.orderBy('sort').toArray(), []) ?? []
  const budgets = useLiveQuery(() => db.budgets.toArray(), []) ?? []
  const goals = useLiveQuery(() => db.goals.toArray(), []) ?? []
  const monthTxns = useLiveQuery(() => txnsForMonth(monthKey), [monthKey]) ?? []
  const tagMonthLoaded = useLiveQuery(() => (openTag ? txnsForMonth(openTag.monthKey) : undefined), [openTag?.monthKey])
  // until it's read, the month on screen is the same month: no flash of an empty sheet as it opens
  const tagMonthTxns = tagMonthLoaded ?? (openTag?.monthKey === monthKey ? monthTxns : [])
  const rules = useLiveQuery(() => db.rules.toArray(), []) ?? []

  const spent = sum(monthTxns)
  const catSpend = useMemo(() => byCategory(monthTxns), [monthTxns])
  const overall = budgets.find((b) => b.id === 'overall') ?? null
  const catBudgets = budgets.filter((b) => b.id !== 'overall')
  // the month's recurring payments still to come: counted once each in where the month lands
  const due = useMemo(() => stillDue(rules, monthKey), [rules, monthKey])
  const projected = projectMonth(monthTxns, monthKey, today, due)
  const bills = upcomingRules(rules, 14)
  const budgetless = categories.filter((c) => !c.archived && !catBudgets.some((b) => b.id === c.id))

  function stateColor(state: 'ok' | 'warn' | 'over', fallback: string): string {
    return state === 'over' ? 'var(--over-fill)' : state === 'warn' ? 'var(--amber)' : fallback
  }

  function stateText(state: 'ok' | 'warn' | 'over', fallback: string): string {
    return state === 'over' ? 'var(--over-text)' : state === 'warn' ? 'var(--amber-text)' : fallback
  }

  // the tick is what the budget expects spent by today: recurring payments on their days, the rest day by day
  const overallPace = overall ? pace(spent, overall.amountMinor, today, fixedOf(monthTxns, due)) : null

  // a tag's card opens what made it up: the quiet chevron Insights' rows have, close after the name
  const opens = (
    <span className="faint" aria-hidden="true" style={{ display: 'inline-flex', flexShrink: 0, marginLeft: -5 }}>
      <Icon name="chevronRight" size={13} />
    </span>
  )

  return (
    <div className="screen">
      <div className="row-between">
        <h1 className="screen-title">Budgets</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="month-label">{monthLabel(monthKey)}</span>
          <button
            className="icon-btn"
            style={{ width: 36, height: 36, borderRadius: 18 }}
            onClick={onOpenSettings}
            aria-label="Settings"
          >
            <Icon name="gear" size={18} strokeWidth={1.6} />
          </button>
        </div>
      </div>

      {overall && overallPace ? (
        // what made the month: its entries day by day, where "Change" sets the amount
        <button
          className="card"
          style={{ display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'left' }}
          onClick={() => setMonthOpen(true)}
        >
          <div className="row-between budget-month-head">
            <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span className="mono" style={{ fontWeight: 600, fontSize: 24 }}>
                {formatMinor(spent, currency)}
              </span>
              <span className="mono faint" style={{ fontSize: 12.5, fontWeight: 500 }}>
                of {formatMinor(overall.amountMinor, currency)}
              </span>
            </span>
            <span
              className="mono caps"
              style={{
                fontWeight: 600,
                fontSize: 12,
                marginLeft: 'auto',
                color: stateText(overallPace.state, 'var(--pos-text)')
              }}
            >
              {overallPace.state === 'over' ? 'Over' : overallPace.state === 'warn' ? 'Ahead of pace' : 'On pace'}
            </span>
          </div>
          <Progress
            fraction={overallPace.fraction}
            color={stateColor(overallPace.state, 'var(--pos)')}
            tickFraction={overallPace.expectedFraction}
            height={8}
          />
          <span className="caption">
            {/* on the month's last day a projection would only repeat what's spent: say how it ended instead */}
            {parseInt(today.slice(8, 10), 10) === daysInMonth(monthKey)
              ? spent <= overall.amountMinor
                ? `Last day of the month — ${formatMinor(overall.amountMinor - spent, currency)} under budget.`
                : `Last day of the month — ${formatMinor(spent - overall.amountMinor, currency)} over budget.`
              : `Day ${parseInt(today.slice(8, 10), 10)} of ${daysInMonth(monthKey)} — the tick is today. Projected ${formatMinor(projected, currency)}.`}
          </span>
          {/* everything on the card is its name, with where it leads after it */}
          <span className="sr-only">Show {monthLabel(monthKey)}'s entries</span>
        </button>
      ) : (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>Set a monthly budget</span>
          <span className="caption">One number unlocks safe-to-spend on Home and the pace line here.</span>
          <button className="btn" onClick={() => budgetEditor.edit({ id: 'overall', title: 'Monthly budget', amount: null })}>
            Set monthly budget
          </button>
        </div>
      )}

      {catBudgets.map((b) => {
        const cat = categories.find((c) => c.id === b.id)
        if (!cat) return null
        // a tag's own recurring payments and rules, the same way
        const catPace = pace(catSpend.get(cat.id) ?? 0, b.amountMinor, today, fixedOf(monthTxns, due, cat.id))
        const left = b.amountMinor - catPace.spent
        return (
          // what made it up: the tag's entries this month, where "Change" sets the amount
          <button
            key={b.id}
            className="card"
            style={{ display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left', borderRadius: 16, padding: '13px 18px' }}
            onClick={() => setOpenTag({ id: cat.id, name: cat.name, color: cat.color, monthKey })}
          >
            {/* a long name and big figures don't fit side by side on a narrow phone: the figures drop under the name
                rather than squeeze it, and the name keeps its end */}
            <div className="row-between" style={{ flexWrap: 'wrap', rowGap: 4 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 9, fontWeight: 600, fontSize: 15, minWidth: 0 }}>
                <span style={{ width: 9, height: 9, borderRadius: 5, background: cat.color, flexShrink: 0 }} />
                <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{cat.name}</span>
                {opens}
              </span>
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 6, whiteSpace: 'nowrap', marginLeft: 'auto' }}>
                <span className="mono" style={{ fontWeight: 600, fontSize: 15, color: stateText(catPace.state, 'var(--ink)') }}>
                  {formatMinor(catPace.spent, currency)}
                </span>
                <span className="mono faint" style={{ fontSize: 12, fontWeight: 500 }}>
                  / {formatMinor(b.amountMinor, currency)}
                </span>
              </span>
            </div>
            <Progress fraction={catPace.fraction} color={stateColor(catPace.state, cat.color)} tickFraction={catPace.expectedFraction} />
            <span className="caption" style={{ fontSize: 12 }}>
              {left >= 0
                ? `${formatMinor(left, currency)} left${catPace.state === 'warn' ? ' · ahead of pace' : ' · on pace'}`
                : `Over by ${formatMinor(-left, currency)} — it happens; next month resets`}
            </span>
            <span className="sr-only">Show its entries</span>
          </button>
        )
      })}

      {budgetless.length > 0 && (
        <button className="btn ghost" onClick={() => setPickingCategory(true)}>
          <Icon name="plus" size={16} strokeWidth={2.2} /> Add a budget for a tag
        </button>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2 className="label">Saving for</h2>
        {[...goals]
          .sort((a, b) => a.createdAt - b.createdAt)
          .map((g) => {
            const frac = g.targetMinor > 0 ? g.savedMinor / g.targetMinor : 0
            const done = g.savedMinor >= g.targetMinor
            return (
              <button
                key={g.id}
                className="card"
                style={{ display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left', borderRadius: 16, padding: '13px 18px' }}
                onClick={() => setGoalDialog({ goal: g })}
              >
                <div className="row-between">
                  <span
                    style={{
                      fontWeight: 600,
                      fontSize: 15,
                      minWidth: 0,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}
                  >
                    {done ? '🎉 ' : ''}
                    {g.name}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexShrink: 0 }}>
                    <span className="mono" style={{ fontWeight: 600, fontSize: 15, color: done ? 'var(--pos-text)' : 'var(--ink)' }}>
                      {formatMinor(g.savedMinor, currency)}
                    </span>
                    <span className="mono faint" style={{ fontSize: 12, fontWeight: 500 }}>
                      / {formatMinor(g.targetMinor, currency)}
                    </span>
                  </span>
                </div>
                <Progress fraction={Math.min(1, frac)} color={done ? 'var(--pos)' : 'var(--accent)'} />
                <span className="caption" style={{ fontSize: 12 }}>
                  {done
                    ? 'Fully funded — go get it'
                    : `${Math.round(frac * 100)}% there · ${formatMinor(g.targetMinor - g.savedMinor, currency)} to go`}
                </span>
              </button>
            )
          })}
        <button className="btn ghost" onClick={() => setGoalDialog({ goal: null })}>
          <Icon name="plus" size={16} strokeWidth={2.2} /> Start saving for something
        </button>
      </div>

      <RecurringManager currency={currency} />

      {bills.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h2 className="label" style={{ paddingBottom: 4 }}>
            Next 14 days
          </h2>
          {bills.map((r) => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0' }}>
              <span className="mono caps" style={{ fontWeight: 600, fontSize: 11.5, width: 56, flexShrink: 0, color: 'var(--amber-text)' }}>
                {shortDate(r.nextRunISO)}
              </span>
              <span style={{ flex: 1, fontWeight: 500, fontSize: 14 }}>{r.name}</span>
              <span className="mono muted" style={{ fontWeight: 600, fontSize: 14 }}>
                {formatMinor(r.amountMinor, currency)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* its budget line's "Change" opens the budget dialog over it */}
      {monthOpen && <MonthSheet currency={currency} onEdit={onEdit} onClose={() => setMonthOpen(false)} />}

      {openTag && (
        <TagEntriesSheet
          tag={openTag}
          monthKey={openTag.monthKey}
          isCurrent={openTag.monthKey === monthKey}
          monthTxns={tagMonthTxns}
          monthSpent={sum(tagMonthTxns)}
          budgetMinor={catBudgets.find((b) => b.id === openTag.id)?.amountMinor ?? null}
          categories={categories}
          currency={currency}
          onEdit={onEdit}
          onClose={() => setOpenTag(null)}
        />
      )}

      {budgetEditor.dialog}

      {pickingCategory && (
        <Sheet open onClose={() => setPickingCategory(false)} label="Pick a tag" style={{ gap: 10 }}>
            <span className="label" style={{ letterSpacing: '0.14em' }}>Budget which tag?</span>
            <div className="cat-grid">
              {budgetless.map((c) => (
                <button
                  key={c.id}
                  className="chip"
                  onClick={() => {
                    setPickingCategory(false)
                    budgetEditor.edit({ id: c.id, title: `${c.name} budget`, amount: null })
                  }}
                >
                  <span className="dot" style={{ background: c.color }} />
                  {c.name}
                </button>
              ))}
            </div>
            <button className="btn ghost" onClick={() => setManageTags(true)}>
              <Icon name="plus" size={15} strokeWidth={2.4} /> Make a custom tag
            </button>
        </Sheet>
      )}

      {goalDialog && <GoalDialog goal={goalDialog.goal} currency={currency} onClose={() => setGoalDialog(null)} />}

      <TagManager open={manageTags} onClose={() => setManageTags(false)} />
    </div>
  )
}
