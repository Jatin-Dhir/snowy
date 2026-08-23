import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Txn } from '../db/db'
import { txnsForMonth, txnsBetween, recentTxns, addTxn, removeTxnPermanently, softDeleteTxn, restoreTxn } from '../db/repo'
import { addToGoal } from '../db/goals'
import { learnFrequents } from '../db/suggest'
import { safeToSpend, saveSuggestion, weekBars, sum, onDay, byCategory } from '../db/stats'
import { upcomingRules } from '../db/recurring'
import { formatMinor } from '../lib/money'
import { weeklyAnomalies } from '../lib/smart'
import { notifyAlerts, syncLoanReminders } from '../lib/notify'
import { LoansSheet } from '../components/LoansSheet'
import { useAnimatedNumber } from '../lib/useAnimatedNumber'
import { currentMonthKey, monthLabel, todayISO, weekDaysOf, weekdayName, fromISO } from '../lib/dates'
import { TransactionRow } from '../components/TransactionRow'
import { Icon } from '../components/Icon'
import { Sheet } from '../components/Sheet'
import { haptic, useUi } from '../state/ui'
import { fmtDayHeading } from '../lib/dates'

export function Home({
  currency,
  onEdit,
  onOpenSettings,
  onAdd
}: {
  currency: string
  onEdit: (t: Txn) => void
  onOpenSettings: () => void
  onAdd: () => void
}) {
  const { showToast } = useUi()
  const today = todayISO()
  const monthKey = currentMonthKey()
  const [dismissedNudge, setDismissedNudge] = useState(() => localStorage.getItem('tally.nudge.dismissed') ?? '')
  const [heroPop, setHeroPop] = useState(0)
  const [dayOpen, setDayOpen] = useState<string | null>(null)

  const categories = useLiveQuery(() => db.categories.orderBy('sort').toArray(), []) ?? []
  const monthTxns = useLiveQuery(() => txnsForMonth(monthKey), [monthKey]) ?? []
  const week = weekDaysOf(today)
  const weekTxns = useLiveQuery(() => txnsBetween(week[0], week[6]), [week[0], week[6]]) ?? []
  const recent = useLiveQuery(() => recentTxns(600), []) ?? []
  const overallBudget = useLiveQuery(() => db.budgets.get('overall'), [])
  const budgets = useLiveQuery(() => db.budgets.toArray(), []) ?? []
  const rules = useLiveQuery(() => db.rules.toArray(), []) ?? []
  const loans = useLiveQuery(() => db.loans.toArray(), []) ?? []
  const goals = useLiveQuery(() => db.goals.toArray(), []) ?? []
  const [loansOpen, setLoansOpen] = useState(false)
  const [saveHidden, setSaveHidden] = useState(() => localStorage.getItem('taily.save.hidden') === todayISO())

  const sts = useMemo(
    () => safeToSpend(monthTxns, overallBudget?.amountMinor ?? null, today),
    [monthTxns, overallBudget, today]
  )
  const bars = useMemo(() => weekBars(weekTxns, today), [weekTxns, today])
  const weekTotal = sum(weekTxns.filter((t) => t.dateISO <= today))
  const monthSpent = useMemo(() => sum(monthTxns), [monthTxns])
  const maxBar = Math.max(...bars.map((b) => b.total), 1)
  const todayTxns = useMemo(() => onDay(monthTxns, today), [monthTxns, today])
  const frequents = useMemo(() => learnFrequents(recent, categories), [recent, categories])
  // savings nudge: goals are the "saving is set up" signal; pick the one closest to done
  const saveGoal = useMemo(() => {
    const open = goals.filter((g) => g.savedMinor < g.targetMinor)
    return open.sort((a, b) => b.savedMinor / b.targetMinor - a.savedMinor / a.targetMinor)[0] ?? null
  }, [goals])
  const saveIdea = useMemo(() => {
    if (!saveGoal) return null
    const cutoff = Date.now() - 30 * 86400000
    const last30 = recent.filter((t) => t.ts >= cutoff)
    const avgDaily = last30.length > 0 ? sum(last30) / 30 : 0
    return saveSuggestion(sts, avgDaily, saveGoal.targetMinor - saveGoal.savedMinor)
  }, [saveGoal, recent, sts])

  async function tuckAway() {
    if (!saveGoal || !saveIdea) return
    const amt = saveIdea.amountMinor
    await addToGoal(saveGoal.id, amt)
    localStorage.setItem('taily.save.hidden', today)
    setSaveHidden(true)
    haptic('success')
    showToast(`Tucked ${formatMinor(amt, currency)} into ${saveGoal.name}`, () => {
      void addToGoal(saveGoal.id, -amt)
      localStorage.removeItem('taily.save.hidden')
      setSaveHidden(false)
    })
  }

  const nextBill = upcomingRules(rules, 3)[0]
  const nudgeKey = nextBill ? `${nextBill.id}|${nextBill.nextRunISO}` : ''
  const showNudge = nextBill && dismissedNudge !== nudgeKey
  const heroAnimated = useAnimatedNumber(sts.hasBudget ? Math.abs(sts.remainingToday) : sts.spentToday)

  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(
    () => new Set(JSON.parse(localStorage.getItem('tally.alerts.dismissed') ?? '[]'))
  )

  // hold a row in Today to select several, then delete them together
  const [selecting, setSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  function enterSelect(id: string) {
    setSelecting(true)
    setSelectedIds(new Set([id]))
  }

  function toggleSelect(id: string) {
    setSelectedIds((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      if (next.size === 0) setSelecting(false)
      return next
    })
  }

  function exitSelect() {
    setSelecting(false)
    setSelectedIds(new Set())
  }

  async function deleteSelected() {
    const ids = [...selectedIds]
    if (ids.length === 0) return
    await Promise.all(ids.map((id) => softDeleteTxn(id)))
    haptic('medium')
    showToast(`Deleted ${ids.length} ${ids.length === 1 ? 'entry' : 'entries'}`, () => {
      for (const id of ids) void restoreTxn(id)
    })
    exitSelect()
  }

  const alerts = useMemo(() => {
    const catSpend = byCategory(monthTxns)
    const list: { key: string; level: 'over' | 'warn' | 'info'; text: string }[] = []
    for (const b of budgets) {
      const isOverall = b.id === 'overall'
      const spentB = isOverall ? monthSpent : (catSpend.get(b.id) ?? 0)
      const name = isOverall ? 'Monthly budget' : (categories.find((c) => c.id === b.id)?.name ?? 'Budget')
      const frac = b.amountMinor > 0 ? spentB / b.amountMinor : 0
      if (frac >= 1) {
        list.push({
          key: `${b.id}|${monthKey}|over`,
          level: 'over',
          text: `${name} is over by ${formatMinor(spentB - b.amountMinor, currency)} — be careful.`
        })
      } else if (frac >= 0.85) {
        list.push({
          key: `${b.id}|${monthKey}|warn`,
          level: 'warn',
          text: `${name} is at ${Math.round(frac * 100)}% — ${formatMinor(b.amountMinor - spentB, currency)} left.`
        })
      }
    }
    for (const a of weeklyAnomalies(recent, categories, today)) {
      list.push({
        key: `anom|${a.categoryId}|${weekDaysOf(today)[0]}`,
        level: 'info',
        text: `${a.name} is ${a.ratio.toFixed(1)}× your usual pace this week.`
      })
    }
    for (const l of loans) {
      if (l.settledISO || !l.remindISO || l.remindISO > today) continue
      list.push({
        key: `loan|${l.id}|${l.remindISO}`,
        level: 'warn',
        text:
          l.direction === 'lent'
            ? `Reminder: ${l.person} owes you ${formatMinor(l.amountMinor, l.currency)} — time to collect.`
            : `Reminder: you owe ${l.person} ${formatMinor(l.amountMinor, l.currency)}.`
      })
    }
    return list
  }, [budgets, monthTxns, monthSpent, categories, recent, loans, today, monthKey, currency])

  const visibleAlerts = alerts.filter((a) => !dismissedAlerts.has(a.key)).slice(0, 3)

  useEffect(() => {
    const urgent = alerts.filter((a) => a.level === 'over')
    if (urgent.length > 0) void notifyAlerts(urgent)
  }, [alerts])

  useEffect(() => {
    void syncLoanReminders(loans)
  }, [loans])

  function dismissAlert(key: string) {
    setDismissedAlerts((prev) => {
      const next = new Set(prev)
      next.add(key)
      localStorage.setItem('tally.alerts.dismissed', JSON.stringify([...next].slice(-60)))
      return next
    })
  }

  const dateLabel = fromISO(today)
    .toLocaleString('en-IN', { weekday: 'long', month: 'short', day: 'numeric' })
    .replace(',', ' ·')

  async function quickAdd(f: (typeof frequents)[number]) {
    const txn = await addTxn({
      amountMinor: f.amountMinor,
      currency,
      categoryId: f.categoryId,
      accountId: f.accountId,
      note: f.label === categories.find((c) => c.id === f.categoryId)?.name ? '' : f.label
    })
    haptic('success')
    showToast(`Saved ${formatMinor(f.amountMinor, currency)} · ${f.label}`, () => {
      void removeTxnPermanently(txn.id)
    })
  }

  return (
    <div className="screen">
      <div className="row-between">
        <span className="label">{dateLabel}</span>
        <button
          className="icon-btn"
          style={{ width: 42, height: 42, borderRadius: 21 }}
          onClick={onOpenSettings}
          aria-label="Settings"
        >
          <Icon name="gear" size={21} strokeWidth={1.6} />
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="label">{sts.hasBudget ? 'Safe to spend today' : 'Spent today'}</span>
        <button
          key={heroPop}
          className="mono hero-num"
          aria-label="Safe to spend today"
          onClick={() => {
            haptic('medium')
            setHeroPop((p) => p + 1)
          }}
          style={{
            fontWeight: 800,
            fontSize: 54,
            letterSpacing: '-0.03em',
            lineHeight: 1.05,
            textAlign: 'left',
            width: 'fit-content',
            color: sts.hasBudget && sts.remainingToday < 0 ? 'var(--red)' : 'var(--ink)',
            transition: 'color 300ms ease'
          }}
        >
          {formatMinor(heroAnimated, currency)}
        </button>
        {sts.hasBudget ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <div className="bar-track" style={{ height: 5 }}>
              <div
                className="bar-fill"
                style={{
                  width: `${sts.dayAllowance > 0 ? Math.min(100, (sts.spentToday / sts.dayAllowance) * 100) : 100}%`,
                  background: sts.remainingToday < 0 ? 'var(--red)' : 'var(--pos)'
                }}
              />
            </div>
            <span className="caption">
              {sts.remainingToday < 0
                ? `over today's ${formatMinor(sts.dayAllowance, currency)} — tomorrow adjusts`
                : `of your ${formatMinor(sts.dayAllowance, currency)} day · resets at midnight`}
            </span>
          </div>
        ) : (
          <span className="caption">Set a monthly budget in Budgets to unlock safe-to-spend.</span>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
          <div className="well">
            <span className="label" style={{ fontSize: 9.5 }}>Spent today</span>
            <span className="well-num">{formatMinor(sts.spentToday, currency)}</span>
          </div>
          <div className="well">
            <span className="label" style={{ fontSize: 9.5 }}>Spent in {monthLabel(monthKey).slice(0, 3)}</span>
            <span className="well-num">{formatMinor(monthSpent, currency)}</span>
          </div>
        </div>
      </div>

      {visibleAlerts.map((a) => (
        <div
          key={a.key}
          className="card"
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderRadius: 14 }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              flexShrink: 0,
              background: a.level === 'over' ? 'var(--red)' : a.level === 'warn' ? 'var(--amber)' : 'var(--pos)'
            }}
          />
          <span
            className="caption"
            style={{ flex: 1, fontSize: 13, fontWeight: 600, color: a.level === 'over' ? 'var(--red)' : 'var(--muted)' }}
          >
            {a.text}
          </span>
          <button className="faint" aria-label="Dismiss alert" onClick={() => dismissAlert(a.key)}>
            <Icon name="x" size={14} strokeWidth={2} />
          </button>
        </div>
      ))}

      {saveGoal && saveIdea && !saveHidden && (
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 14 }}>
          <span className="txn-icon" style={{ background: 'var(--pos-soft)', color: 'var(--pos)', width: 36, height: 36 }}>
            <Icon name="heart" size={17} />
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontWeight: 700, fontSize: 14 }}>
              {saveIdea.reason === 'under-pace' ? 'Under pace — save the difference?' : `A little for ${saveGoal.name}?`}
            </span>
            <span className="caption" style={{ fontSize: 12 }}>
              {saveIdea.reason === 'under-pace'
                ? `${formatMinor(saveIdea.amountMinor, currency)} of today's allowance is still free`
                : `${formatMinor(saveIdea.amountMinor, currency)} a day is all it takes`}
              {saveIdea.daysToGoal !== null &&
                ` · ${saveGoal.name} full in ~${
                  saveIdea.daysToGoal > 60 ? `${Math.round(saveIdea.daysToGoal / 30)} months` : `${saveIdea.daysToGoal} days`
                }`}
            </span>
          </span>
          <button
            className="btn"
            style={{ padding: '8px 13px', fontSize: 13, flexShrink: 0 }}
            onClick={() => void tuckAway()}
          >
            Save {formatMinor(saveIdea.amountMinor, currency)}
          </button>
          <button
            className="faint"
            aria-label="Not today"
            onClick={() => {
              localStorage.setItem('taily.save.hidden', today)
              setSaveHidden(true)
            }}
          >
            <Icon name="x" size={14} strokeWidth={2} />
          </button>
        </div>
      )}

      {(() => {
        const owedToMe = loans.filter((l) => !l.settledISO && l.direction === 'lent').reduce((a, l) => a + l.amountMinor, 0)
        const iOwe = loans.filter((l) => !l.settledISO && l.direction === 'borrowed').reduce((a, l) => a + l.amountMinor, 0)
        const parts: string[] = []
        if (owedToMe > 0) parts.push(`${formatMinor(owedToMe, currency)} owed to you`)
        if (iOwe > 0) parts.push(`you owe ${formatMinor(iOwe, currency)}`)
        return (
          <button
            className="card"
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderRadius: 14, textAlign: 'left' }}
            onClick={() => setLoansOpen(true)}
          >
            <span className="txn-icon" style={{ background: 'var(--pos-soft)', color: 'var(--accent)', width: 36, height: 36 }}>
              <Icon name="person" size={18} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontWeight: 700, fontSize: 14 }}>Lent &amp; borrowed</span>
              <span className="caption" style={{ fontSize: 12 }}>
                {parts.length > 0 ? parts.join(' · ') : 'Track money between you and people'}
              </span>
            </span>
            <span className="faint">
              <Icon name="chevronRight" size={16} />
            </span>
          </button>
        )
      })()}

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="row-between">
          <span className="label">This week</span>
          <span className="mono" style={{ fontWeight: 600, fontSize: 14 }}>
            {formatMinor(weekTotal, currency)}
          </span>
        </div>
        <div className="weekbars">
          {bars.map((b) => (
            <button
              className="weekbar-col"
              key={b.iso}
              disabled={b.isFuture}
              aria-label={`${weekdayName(b.iso)}: ${formatMinor(b.total, currency)}`}
              onClick={() => {
                haptic('selection')
                setDayOpen(b.iso)
              }}
            >
              <div
                className="bar"
                style={{
                  height: b.isFuture ? 6 : Math.max(6, Math.round((b.total / maxBar) * 40)),
                  background: b.isToday ? 'var(--pos)' : b.isFuture ? 'var(--bar-empty)' : 'var(--bar-idle)'
                }}
              />
              <span
                className="day"
                style={{ color: b.isToday ? 'var(--accent)' : b.isFuture ? 'var(--faint-future)' : undefined }}
              >
                {weekdayName(b.iso)[0]}
              </span>
            </button>
          ))}
        </div>
      </div>

      {frequents.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span className="label">Frequent · one tap logs it</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {frequents.map((f) => {
              const cat = categories.find((c) => c.id === f.categoryId)
              return (
                <button
                  key={f.key}
                  className="card"
                  style={{ flex: 1, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 3, textAlign: 'left', borderRadius: 14 }}
                  onClick={() => void quickAdd(f)}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <span className="dot" style={{ width: 7, height: 7, borderRadius: 4, background: cat?.color ?? '#7A8794', flexShrink: 0 }} />
                    <span style={{ fontSize: 12.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {f.label}
                    </span>
                  </span>
                  <span className="mono muted" style={{ fontWeight: 600, fontSize: 13 }}>
                    {formatMinor(f.amountMinor, currency)}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {selecting ? (
          <div className="row-between" style={{ paddingBottom: 6 }}>
            <span className="label">{selectedIds.size} selected</span>
            <span style={{ display: 'flex', gap: 8 }}>
              <button
                className="icon-btn"
                style={{ color: 'var(--red)' }}
                onClick={() => void deleteSelected()}
                aria-label="Delete selected"
              >
                <Icon name="trash" size={16} />
              </button>
              <button className="icon-btn" onClick={exitSelect} aria-label="Cancel selection">
                <Icon name="x" size={14} strokeWidth={2.2} />
              </button>
            </span>
          </div>
        ) : (
          <div className="row-between" style={{ paddingBottom: 6 }}>
            <span className="label">Today</span>
            <span className="mono muted" style={{ fontWeight: 600, fontSize: 13 }}>
              {formatMinor(sts.spentToday, currency)}
            </span>
          </div>
        )}
        {todayTxns.length === 0 ? (
          <div className="empty">
            Nothing logged yet today.
            <br />
            <button style={{ color: 'var(--accent)', fontWeight: 600 }} onClick={onAdd}>
              The + is right there — three seconds.
            </button>
          </div>
        ) : (
          todayTxns.map((t) => (
            <TransactionRow
              key={t.id}
              txn={t}
              categories={categories}
              selected={selectedIds.has(t.id)}
              onLongPress={() => enterSelect(t.id)}
              onClick={() => (selecting ? toggleSelect(t.id) : onEdit(t))}
            />
          ))
        )}
      </div>

      {showNudge && nextBill && (
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 14 }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--amber)', flexShrink: 0 }} />
          <span className="caption" style={{ flex: 1, fontSize: 13 }}>
            {nextBill.name} hits {weekdayName(nextBill.nextRunISO)} — {formatMinor(nextBill.amountMinor, currency)}.
          </span>
          <button
            className="faint"
            aria-label="Dismiss"
            onClick={() => {
              localStorage.setItem('tally.nudge.dismissed', nudgeKey)
              setDismissedNudge(nudgeKey)
            }}
          >
            <Icon name="x" size={14} strokeWidth={2} />
          </button>
        </div>
      )}

      <LoansSheet open={loansOpen} currency={currency} onClose={() => setLoansOpen(false)} />

      {dayOpen && (
        <Sheet open onClose={() => setDayOpen(null)} label="Day detail" style={{ gap: 8 }}>
          <div className="row-between">
            <span className="label" style={{ letterSpacing: '0.14em' }}>{fmtDayHeading(dayOpen)}</span>
            <span className="mono" style={{ fontWeight: 700, fontSize: 15 }}>
              {formatMinor(sum(onDay(weekTxns, dayOpen)), currency)}
            </span>
          </div>
          {onDay(weekTxns, dayOpen).length === 0 ? (
            <div className="empty">Nothing logged this day.</div>
          ) : (
            onDay(weekTxns, dayOpen).map((t) => (
              <TransactionRow
                key={t.id}
                txn={t}
                categories={categories}
                onClick={() => {
                  setDayOpen(null)
                  onEdit(t)
                }}
              />
            ))
          )}
        </Sheet>
      )}
    </div>
  )
}
