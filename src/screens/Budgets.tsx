import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Goal } from '../db/db'
import { addGoal, addToGoal, deleteGoal, restoreGoal, updateGoal } from '../db/goals'
import { addTxn, recentTxns, txnsForMonth } from '../db/repo'
import { byCategory, pace, projectMonth, sum } from '../db/stats'
import { upcomingRules } from '../db/recurring'
import { formatMinor } from '../lib/money'
import { guessAccount } from '../lib/smart'
import { currentMonthKey, daysInMonth, monthLabel, todayISO } from '../lib/dates'
import { Progress } from '../components/Progress'
import { Icon } from '../components/Icon'
import { Sheet } from '../components/Sheet'
import { TagManager } from '../components/TagManager'
import { RecurringManager } from '../components/RecurringManager'
import { haptic, useUi } from '../state/ui'

function BudgetDialog({
  title,
  initialAmount,
  onSave,
  onDelete,
  onClose
}: {
  title: string
  initialAmount: number | null
  onSave: (minor: number) => void
  onDelete?: () => void
  onClose: () => void
}) {
  const [value, setValue] = useState(initialAmount ? String(Math.round(initialAmount / 100)) : '')
  const minor = (parseInt(value, 10) || 0) * 100
  return (
    <Sheet open onClose={onClose} label={title} style={{ gap: 14 }}>
        <div className="row-between">
          <span className="label" style={{ letterSpacing: '0.14em' }}>{title}</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" size={14} strokeWidth={2.2} />
          </button>
        </div>
        <input
          className="field mono"
          type="number"
          inputMode="numeric"
          placeholder="Amount per month"
          value={value}
          autoFocus
          min={0}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && minor > 0) onSave(minor)
          }}
          style={{ fontSize: 22, fontWeight: 600, padding: '14px 16px' }}
        />
        <button className="btn" disabled={minor <= 0} onClick={() => onSave(minor)}>
          Save budget
        </button>
        {onDelete && (
          <button className="btn danger" onClick={onDelete}>
            Remove this budget
          </button>
        )}
    </Sheet>
  )
}

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
  const [target, setTarget] = useState(goal ? String(Math.round(goal.targetMinor / 100)) : '')
  const [amount, setAmount] = useState('')
  const targetMinor = (parseInt(target, 10) || 0) * 100
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
    // a real transaction, same as the Home nudge — money into savings comes
    // off what's left to spend; money back out shows up as available again
    await addTxn({
      amountMinor,
      currency,
      categoryId: 'savings',
      accountId: guessAccount(accounts, recent) ?? 'upi',
      kind: sign === 1 ? 'out' : 'in',
      note: goal.name
    })
    await addToGoal(goal.id, sign * amountMinor)
    haptic('success')
    const g = await db.goals.get(goal.id)
    if (g && sign === 1) {
      showToast(
        g.savedMinor >= g.targetMinor
          ? `${g.name} fully funded — you did it!`
          : `Added — ${formatMinor(Math.max(0, g.targetMinor - g.savedMinor), currency)} to go`
      )
    } else if (g) {
      showToast(`Took out ${formatMinor(amountMinor, currency)}`)
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
            <input
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
        <input
          className="field"
          placeholder="What for? — e.g. iPhone, Goa trip, emergency fund"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
        />
        <input
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

export function Budgets({ currency, onOpenSettings }: { currency: string; onOpenSettings: () => void }) {
  const { showToast } = useUi()
  const monthKey = currentMonthKey()
  const today = todayISO()
  const [dialog, setDialog] = useState<{ id: string; title: string; amount: number | null } | null>(null)
  const [pickingCategory, setPickingCategory] = useState(false)
  const [manageTags, setManageTags] = useState(false)
  const [goalDialog, setGoalDialog] = useState<{ goal: Goal | null } | null>(null)

  const categories = useLiveQuery(() => db.categories.orderBy('sort').toArray(), []) ?? []
  const budgets = useLiveQuery(() => db.budgets.toArray(), []) ?? []
  const goals = useLiveQuery(() => db.goals.toArray(), []) ?? []
  const monthTxns = useLiveQuery(() => txnsForMonth(monthKey), [monthKey]) ?? []
  const rules = useLiveQuery(() => db.rules.toArray(), []) ?? []

  const spent = sum(monthTxns)
  const catSpend = useMemo(() => byCategory(monthTxns), [monthTxns])
  const overall = budgets.find((b) => b.id === 'overall') ?? null
  const catBudgets = budgets.filter((b) => b.id !== 'overall')
  const dayFraction = parseInt(today.slice(8, 10), 10) / daysInMonth(monthKey)
  const projected = projectMonth(monthTxns, monthKey, today)
  const bills = upcomingRules(rules, 14)
  const budgetless = categories.filter((c) => !c.archived && !catBudgets.some((b) => b.id === c.id))

  async function saveBudget(id: string, minor: number) {
    await db.budgets.put({ id, amountMinor: minor })
    setDialog(null)
    showToast('Budget saved')
  }

  async function removeBudget(id: string) {
    await db.budgets.delete(id)
    setDialog(null)
    showToast('Budget removed')
  }

  function stateColor(state: 'ok' | 'warn' | 'over', fallback: string): string {
    return state === 'over' ? 'var(--red)' : state === 'warn' ? 'var(--amber)' : fallback
  }

  const overallPace = overall ? pace(spent, overall.amountMinor, today) : null

  return (
    <div className="screen">
      <div className="row-between">
        <span className="screen-title">Budgets</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="pill">{monthLabel(monthKey)}</span>
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
        <button
          className="card"
          style={{ display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'left' }}
          onClick={() => setDialog({ id: 'overall', title: 'Monthly budget', amount: overall.amountMinor })}
        >
          <div className="row-between">
            <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span className="mono" style={{ fontWeight: 600, fontSize: 24 }}>
                {formatMinor(spent, currency)}
              </span>
              <span className="mono faint" style={{ fontSize: 12.5, fontWeight: 500 }}>
                of {formatMinor(overall.amountMinor, currency)}
              </span>
            </span>
            <span
              className="mono"
              style={{
                fontWeight: 600,
                fontSize: 12,
                color: stateColor(overallPace.state, 'var(--pos)')
              }}
            >
              {overallPace.state === 'over' ? 'OVER' : overallPace.state === 'warn' ? 'AHEAD OF PACE' : 'ON PACE'}
            </span>
          </div>
          <Progress
            fraction={overallPace.fraction}
            color={stateColor(overallPace.state, 'var(--pos)')}
            tickFraction={dayFraction}
            height={8}
          />
          <span className="caption">
            Day {parseInt(today.slice(8, 10), 10)} of {daysInMonth(monthKey)} — the tick is today. Projected{' '}
            {formatMinor(projected, currency)}.
          </span>
        </button>
      ) : (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>Set a monthly budget</span>
          <span className="caption">One number unlocks safe-to-spend on Home and the pace line here.</span>
          <button className="btn" onClick={() => setDialog({ id: 'overall', title: 'Monthly budget', amount: null })}>
            Set monthly budget
          </button>
        </div>
      )}

      {catBudgets.map((b) => {
        const cat = categories.find((c) => c.id === b.id)
        if (!cat) return null
        const catPace = pace(catSpend.get(cat.id) ?? 0, b.amountMinor, today)
        const left = b.amountMinor - catPace.spent
        return (
          <button
            key={b.id}
            className="card"
            style={{ display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left', borderRadius: 16, padding: '13px 18px' }}
            onClick={() => setDialog({ id: b.id, title: `${cat.name} budget`, amount: b.amountMinor })}
          >
            <div className="row-between">
              <span style={{ display: 'flex', alignItems: 'center', gap: 9, fontWeight: 600, fontSize: 15 }}>
                <span style={{ width: 9, height: 9, borderRadius: 5, background: cat.color }} />
                {cat.name}
              </span>
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span className="mono" style={{ fontWeight: 600, fontSize: 15, color: stateColor(catPace.state, 'var(--ink)') }}>
                  {formatMinor(catPace.spent, currency)}
                </span>
                <span className="mono faint" style={{ fontSize: 12, fontWeight: 500 }}>
                  / {formatMinor(b.amountMinor, currency)}
                </span>
              </span>
            </div>
            <Progress fraction={catPace.fraction} color={stateColor(catPace.state, cat.color)} tickFraction={dayFraction} />
            <span className="caption" style={{ fontSize: 12 }}>
              {left >= 0
                ? `${formatMinor(left, currency)} left${catPace.state === 'warn' ? ' · ahead of pace' : ' · on pace'}`
                : `Over by ${formatMinor(-left, currency)} — it happens; next month resets`}
            </span>
          </button>
        )
      })}

      {budgetless.length > 0 && (
        <button className="btn ghost" onClick={() => setPickingCategory(true)}>
          <Icon name="plus" size={16} strokeWidth={2.2} /> Add a budget for a tag
        </button>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span className="label">Saving for</span>
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
                    <span className="mono" style={{ fontWeight: 600, fontSize: 15, color: done ? 'var(--pos)' : 'var(--ink)' }}>
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
          <span className="label" style={{ paddingBottom: 4 }}>
            Next 14 days
          </span>
          {bills.map((r) => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0' }}>
              <span className="mono" style={{ fontWeight: 600, fontSize: 11.5, width: 56, color: 'var(--amber)' }}>
                {r.nextRunISO.slice(8, 10)} {monthLabel(r.nextRunISO.slice(0, 7)).slice(0, 3).toUpperCase()}
              </span>
              <span style={{ flex: 1, fontWeight: 500, fontSize: 14 }}>{r.name}</span>
              <span className="mono muted" style={{ fontWeight: 600, fontSize: 14 }}>
                {formatMinor(r.amountMinor, currency)}
              </span>
            </div>
          ))}
        </div>
      )}

      {dialog && (
        <BudgetDialog
          title={dialog.title}
          initialAmount={dialog.amount}
          onSave={(minor) => void saveBudget(dialog.id, minor)}
          onDelete={dialog.amount !== null ? () => void removeBudget(dialog.id) : undefined}
          onClose={() => setDialog(null)}
        />
      )}

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
                    setDialog({ id: c.id, title: `${c.name} budget`, amount: null })
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
