import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Txn } from '../db/db'
import { setAccountBalance } from '../db/accounts'
import {
  txnsForMonth,
  txnsBetween,
  recentTxns,
  allLiveTxns,
  addTxn,
  removeTxnPermanently,
  softDeleteTxn,
  restoreTxn
} from '../db/repo'
import { addToGoal } from '../db/goals'
import { safeToSpend, saveSuggestion, weekBars, sum, onDay, byCategory, totalBalance, balanceByAccount, pace } from '../db/stats'
import { upcomingRules } from '../db/recurring'
import { formatMinor } from '../lib/money'
import { guessAccount, weeklyAnomalies } from '../lib/smart'
import { notifyAlerts, syncLoanReminders } from '../lib/notify'
import { LoansSheet } from '../components/LoansSheet'
import { TripCard, TripsRow } from '../components/TripCard'
import { useAnimatedNumber } from '../lib/useAnimatedNumber'
import { currentMonthKey, daysInMonth, monthLabel, todayISO, weekDaysOf, weekdayName, fromISO } from '../lib/dates'
import { TransactionRow } from '../components/TransactionRow'
import { InstallHint } from '../components/InstallHint'
import { Icon } from '../components/Icon'
import { Progress } from '../components/Progress'
import { RoomRing } from '../components/RoomRing'
import { Sheet } from '../components/Sheet'
import { haptic, useUi } from '../state/ui'
import { fmtDayHeading } from '../lib/dates'

export function Home({
  currency,
  onEdit,
  onOpenSettings,
  onAdd,
  onOpenBudgets,
  onOpenTrips
}: {
  currency: string
  onEdit: (t: Txn) => void
  onOpenSettings: () => void
  onAdd: () => void
  onOpenBudgets: () => void
  onOpenTrips: () => void
}) {
  const { showToast } = useUi()
  const today = todayISO()
  const monthKey = currentMonthKey()
  const [dismissedNudge, setDismissedNudge] = useState(() => localStorage.getItem('tally.nudge.dismissed') ?? '')
  const [heroPop, setHeroPop] = useState(0)
  const [dayOpen, setDayOpen] = useState<string | null>(null)

  const categories = useLiveQuery(() => db.categories.orderBy('sort').toArray(), []) ?? []
  // undefined until the first read: "nothing logged" waits for it rather than flashing on every visit
  const monthLoaded = useLiveQuery(() => txnsForMonth(monthKey), [monthKey])
  const monthTxns = monthLoaded ?? []
  const week = weekDaysOf(today)
  const weekTxns = useLiveQuery(() => txnsBetween(week[0], week[6]), [week[0], week[6]]) ?? []
  const recent = useLiveQuery(() => recentTxns(600), []) ?? []
  const overallBudget = useLiveQuery(() => db.budgets.get('overall'), [])
  const budgets = useLiveQuery(() => db.budgets.toArray(), []) ?? []
  const rules = useLiveQuery(() => db.rules.toArray(), []) ?? []
  const loans = useLiveQuery(() => db.loans.toArray(), []) ?? []
  const goals = useLiveQuery(() => db.goals.toArray(), []) ?? []
  const accounts = useLiveQuery(() => db.accounts.toArray(), []) ?? []
  const allTxns = useLiveQuery(() => allLiveTxns(), []) ?? []
  // a trip that's on has its own card at the top, so its tile makes way for goals
  const tripOn = useLiveQuery(async () => (await db.trips.toArray()).some((t) => !t.endedISO), []) ?? false
  const [loansOpen, setLoansOpen] = useState(false)
  const [balanceOpen, setBalanceOpen] = useState(false)
  const [editingBalance, setEditingBalance] = useState<string | null>(null)
  const [editBalanceValue, setEditBalanceValue] = useState('')
  const balance = useMemo(() => totalBalance(allTxns, accounts), [allTxns, accounts])
  const byAccountBalance = useMemo(() => balanceByAccount(allTxns, accounts), [allTxns, accounts])
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
    // a real transaction — not just a hidden bump on the goal — so it shows
    // in Activity and actually comes off what's left to spend today, same
    // as any other expense, instead of vanishing invisibly
    const txn = await addTxn({
      amountMinor: amt,
      currency,
      categoryId: 'savings',
      accountId: guessAccount(accounts, recent) ?? 'upi',
      kind: 'out',
      note: saveGoal.name
    })
    await addToGoal(saveGoal.id, amt)
    localStorage.setItem('taily.save.hidden', today)
    setSaveHidden(true)
    haptic('success')
    showToast(`Tucked ${formatMinor(amt, currency)} into ${saveGoal.name}`, () => {
      void addToGoal(saveGoal.id, -amt)
      void removeTxnPermanently(txn.id)
      localStorage.removeItem('taily.save.hidden')
      setSaveHidden(false)
    })
  }

  useEffect(() => {
    if (!balanceOpen) setEditingBalance(null)
  }, [balanceOpen])

  function startEditBalance(id: string, currentMinor: number) {
    setEditingBalance(id)
    setEditBalanceValue((currentMinor / 100).toFixed(2).replace(/\.00$/, ''))
  }

  async function saveBalance(id: string, currentMinor: number) {
    const target = Math.round(parseFloat(editBalanceValue || '0') * 100)
    if (isFinite(target)) {
      await setAccountBalance(id, target, currentMinor)
      haptic('success')
    }
    setEditingBalance(null)
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

  // today: what's left of the day's allowance, as words and as the ring
  const over = sts.hasBudget && sts.remainingToday < 0
  const left = sts.dayAllowance > 0 ? Math.max(0, sts.remainingToday) / sts.dayAllowance : 0
  // sized by the number it will land on, so the count-up never changes the size mid-way
  const heroFinal = formatMinor(sts.hasBudget ? Math.abs(sts.remainingToday) : sts.spentToday, currency)
  const heroSize = heroFinal.length <= 7 ? 44 : heroFinal.length === 8 ? 40 : heroFinal.length === 9 ? 36 : 32

  // the month, against the budget's pace (the same comparison and words Budgets uses)
  const monthName = monthLabel(monthKey)
  const dim = daysInMonth(monthKey)
  const dayOfMonth = parseInt(today.slice(8, 10), 10)
  const budgetMinor = overallBudget && overallBudget.amountMinor > 0 ? overallBudget.amountMinor : 0
  const monthPace = budgetMinor ? pace(monthSpent, budgetMinor, today) : null
  const paceWords = !monthPace
    ? ''
    : monthPace.state === 'over'
      ? `${formatMinor(monthSpent - budgetMinor, currency)} over budget`
      : monthPace.state === 'warn'
        ? `${formatMinor(Math.max(0, monthSpent - budgetMinor * monthPace.dayFraction), currency)} ahead of pace`
        : 'On pace'
  const paceColor = !monthPace ? '' : monthPace.state === 'over' ? 'var(--red)' : monthPace.state === 'warn' ? 'var(--amber)' : 'var(--pos)'
  const paceText = !monthPace ? '' : monthPace.state === 'over' ? 'var(--red)' : monthPace.state === 'warn' ? 'var(--amber-text)' : 'var(--pos-text)'

  // the week, against the budget's even daily share. The line only joins the bars when some day came near
  // it: drawn far above them it would squash the week to stubs, and "all under" says the same thing in words
  const dailyBudget = Math.round(budgetMinor / dim / 100) * 100
  const showLine = dailyBudget > 0 && dailyBudget <= maxBar * 1.5
  const weekScale = showLine ? Math.max(maxBar, dailyBudget) * 1.1 : Math.max(maxBar, 1)
  const daysSoFar = bars.filter((b) => !b.isFuture).length
  const weekAvg = daysSoFar > 0 ? Math.round(weekTotal / daysSoFar / 100) * 100 : 0
  const BAR_MAX = 64

  const liveAccounts = accounts.filter((a) => !a.archived).sort((a, b) => a.sort - b.sort)
  const owedToMe = loans.filter((l) => !l.settledISO && l.direction === 'lent').reduce((a, l) => a + l.amountMinor, 0)
  const iOwe = loans.filter((l) => !l.settledISO && l.direction === 'borrowed').reduce((a, l) => a + l.amountMinor, 0)
  const goal = saveGoal ?? goals[0] ?? null

  // everything that wants a word with you, in one place
  const notes: { key: string; level: 'over' | 'warn' | 'info' | 'bill'; text: string; dismiss: () => void }[] = [
    ...visibleAlerts.map((a) => ({ ...a, dismiss: () => dismissAlert(a.key) })),
    ...(showNudge && nextBill
      ? [
          {
            key: 'bill',
            level: 'bill' as const,
            text: `${nextBill.name} is due ${weekdayName(nextBill.nextRunISO)}: ${formatMinor(nextBill.amountMinor, currency)}.`,
            dismiss: () => {
              localStorage.setItem('tally.nudge.dismissed', nudgeKey)
              setDismissedNudge(nudgeKey)
            }
          }
        ]
      : [])
  ]

  return (
    <div className="screen home">
      <h1 className="sr-only">Home</h1>
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

      <InstallHint />

      <section className="card today-card" aria-label="Today">
        <div className="today-top">
          <div className="today-words">
            <span className="label">{over ? 'Over today by' : sts.hasBudget ? 'Safe to spend today' : 'Spent today'}</span>
            <button
              key={heroPop}
              className="mono hero-num"
              aria-label={`${over ? 'Over today by' : sts.hasBudget ? 'Safe to spend today' : 'Spent today'}: ${heroFinal}`}
              onClick={() => {
                haptic('medium')
                setHeroPop((p) => p + 1)
              }}
              // and on a narrow phone it shrinks with the screen, so it never runs into the ring
              style={{ fontSize: `min(${heroSize}px, ${(82 / heroFinal.length).toFixed(2)}vw)`, color: over ? 'var(--red)' : 'var(--ink)' }}
            >
              {formatMinor(heroAnimated, currency)}
            </button>
            <span className="caption">
              {!sts.hasBudget
                ? todayTxns.length === 0
                  ? 'A fresh day'
                  : `${todayTxns.length} ${todayTxns.length === 1 ? 'entry' : 'entries'} so far today`
                : over
                  ? `past today's ${formatMinor(sts.dayAllowance, currency)}. Tomorrow adjusts`
                  : `of your ${formatMinor(sts.dayAllowance, currency)} for today`}
            </span>
          </div>
          {sts.hasBudget && <RoomRing left={left} over={over} />}
        </div>

        {monthPace ? (
          <button
            className="month-strip"
            onClick={onOpenBudgets}
            aria-label={`${monthName}: ${formatMinor(monthSpent, currency)} of ${formatMinor(budgetMinor, currency)}, ${paceWords}. Open Budgets`}
          >
            <span className="row-between">
              <span className="month-name">{monthName}</span>
              <span className="mono month-figures">
                {formatMinor(monthSpent, currency)}
                <span className="muted"> of {formatMinor(budgetMinor, currency)}</span>
              </span>
            </span>
            <Progress fraction={monthPace.fraction} color={paceColor} tickFraction={monthPace.dayFraction} height={7} />
            <span className="row-between">
              <span className="caption" style={{ color: paceText, fontWeight: 700 }}>
                {paceWords}
              </span>
              <span className="caption">
                Day {dayOfMonth} of {dim}
              </span>
            </span>
          </button>
        ) : (
          <button className="month-strip" onClick={onOpenBudgets}>
            <span className="row-between">
              <span className="month-name">{monthName}</span>
              <span className="mono month-figures">{formatMinor(monthSpent, currency)}</span>
            </span>
            <span className="caption month-cta">Set a monthly budget to see what's safe to spend each day</span>
          </button>
        )}
      </section>

      <TripCard currency={currency} onOpen={onOpenTrips} />

      <button className="card tile tile-wide" onClick={() => setBalanceOpen(true)}>
        <span className="tile-head">
          <span className="tile-icon">
            <Icon name="wallet" size={17} />
          </span>
          <span className="tile-name">Balance</span>
          <span className="mono tile-value" style={balance < 0 ? { color: 'var(--red)' } : undefined}>
            {formatMinor(balance, currency)}
          </span>
        </span>
        {liveAccounts.length > 1 && liveAccounts.some((a) => (byAccountBalance.get(a.id) ?? 0) !== 0) && (
          <span className="tile-chips">
            {liveAccounts.slice(0, 3).map((a) => {
              const b = byAccountBalance.get(a.id) ?? 0
              return (
                <span key={a.id} className="mini-chip">
                  {a.name}
                  <span className="mono" style={b < 0 ? { color: 'var(--red)' } : undefined}>
                    {formatMinor(b, currency)}
                  </span>
                </span>
              )
            })}
            {liveAccounts.length > 3 && <span className="mini-chip">+{liveAccounts.length - 3}</span>}
          </span>
        )}
      </button>

      <div className="tile-grid">
        <button className="card tile" onClick={() => setLoansOpen(true)}>
          <span className="tile-icon">
            <Icon name="person" size={17} />
          </span>
          <span className="tile-name">Lent &amp; borrowed</span>
          {owedToMe > 0 || iOwe > 0 ? (
            <>
              {owedToMe > 0 && (
                <span className="tile-line">
                  <span className="mono" style={{ color: 'var(--pos-text)', fontWeight: 700 }}>
                    {formatMinor(owedToMe, currency)}
                  </span>{' '}
                  to get back
                </span>
              )}
              {iOwe > 0 && (
                <span className="tile-line">
                  <span className="mono" style={{ color: 'var(--amber-text)', fontWeight: 700 }}>
                    {formatMinor(iOwe, currency)}
                  </span>{' '}
                  to pay back
                </span>
              )}
            </>
          ) : (
            <span className="tile-line">Money between you and people</span>
          )}
        </button>
        {tripOn ? (
          <button className="card tile" onClick={onOpenBudgets}>
            <span className="tile-icon">
              <Icon name="heart" size={17} />
            </span>
            <span className="tile-name">{goal ? goal.name : 'Goals'}</span>
            {goal ? (
              <>
                <Progress fraction={goal.targetMinor > 0 ? goal.savedMinor / goal.targetMinor : 0} color="var(--pos)" height={5} />
                <span className="tile-line">
                  <span className="mono" style={{ fontWeight: 700, color: 'var(--ink)' }}>
                    {formatMinor(goal.savedMinor, currency)}
                  </span>{' '}
                  of {formatMinor(goal.targetMinor, currency)}
                </span>
              </>
            ) : (
              <span className="tile-line">Save up for something</span>
            )}
          </button>
        ) : (
          <TripsRow currency={currency} onOpen={onOpenTrips} />
        )}
      </div>

      {notes.length > 0 && (
        <div className="card notes">
          {notes.map((n) => (
            <div key={n.key} className="note-row">
              <span className={`note-dot ${n.level}`} />
              <span className="note-text" style={n.level === 'over' ? { color: 'var(--red)' } : undefined}>
                {n.text}
              </span>
              <button className="note-x" aria-label={`Dismiss: ${n.text}`} onClick={n.dismiss}>
                <Icon name="x" size={13} strokeWidth={2.2} />
              </button>
            </div>
          ))}
        </div>
      )}

      {saveGoal && saveIdea && !saveHidden && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 11, padding: '13px 14px', borderRadius: 14 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <span className="txn-icon" style={{ background: 'var(--pos-soft)', color: 'var(--pos-text)', width: 36, height: 36, flexShrink: 0 }}>
              <Icon name="heart" size={17} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontWeight: 700, fontSize: 14 }}>
                {saveIdea.reason === 'under-pace' ? 'Under pace. Save the difference?' : `A little for ${saveGoal.name}?`}
              </span>
              <span className="caption" style={{ fontSize: 12 }}>
                {saveIdea.reason === 'under-pace'
                  ? `${formatMinor(saveIdea.amountMinor, currency)} of today's allowance is still free`
                  : `${formatMinor(saveIdea.amountMinor, currency)} a day is all it takes`}
                {saveIdea.daysToGoal !== null &&
                  ` · ${saveGoal.name} full in about ${
                    saveIdea.daysToGoal > 60 ? `${Math.round(saveIdea.daysToGoal / 30)} months` : `${saveIdea.daysToGoal} days`
                  }`}
              </span>
            </span>
            <button
              className="note-x"
              aria-label="Not today"
              style={{ flexShrink: 0 }}
              onClick={() => {
                localStorage.setItem('taily.save.hidden', today)
                setSaveHidden(true)
              }}
            >
              <Icon name="x" size={13} strokeWidth={2.2} />
            </button>
          </div>
          <button className="btn" style={{ padding: '11px 16px', fontSize: 14 }} onClick={() => void tuckAway()}>
            Save {formatMinor(saveIdea.amountMinor, currency)}
          </button>
        </div>
      )}

      <div className="card week-card">
        <div className="row-between">
          <h2 className="label">This week</h2>
          <span className="mono" style={{ fontWeight: 700, fontSize: 15 }}>
            {formatMinor(weekTotal, currency)}
          </span>
        </div>
        <div className="weekbars">
          {showLine && (
            <span className="week-line" style={{ bottom: `calc(${Math.round((dailyBudget / weekScale) * BAR_MAX)}px + var(--day-h))` }} />
          )}
          {bars.map((b) => {
            const overDay = dailyBudget > 0 && b.total > dailyBudget && !b.isToday
            return (
              <button
                className="weekbar-col"
                key={b.iso}
                disabled={b.isFuture}
                aria-label={`${weekdayName(b.iso)}: ${formatMinor(b.total, currency)}${overDay ? ', over the daily budget' : ''}`}
                onClick={() => {
                  haptic('selection')
                  setDayOpen(b.iso)
                }}
              >
                <div
                  className="bar"
                  style={{
                    height: b.isFuture ? 6 : Math.max(6, Math.round((b.total / weekScale) * BAR_MAX)),
                    background: b.isToday ? 'var(--pos)' : b.isFuture ? 'var(--bar-empty)' : overDay ? 'var(--amber)' : 'var(--bar-idle)',
                    // a day past the budget's share, softened to sit with the others (an older WebView has no color-mix)
                    opacity: overDay ? 0.5 : undefined
                  }}
                />
                <span
                  className="day"
                  style={{ color: b.isToday ? 'var(--accent-text)' : undefined, fontWeight: b.isFuture ? 500 : undefined }}
                >
                  {weekdayName(b.iso)[0]}
                </span>
              </button>
            )
          })}
        </div>
        {weekTotal > 0 && (
          <div className="row-between">
            <span className="caption">{formatMinor(weekAvg, currency)} a day on average</span>
            {showLine ? (
              <span className="caption week-key">
                <i aria-hidden="true" />
                {formatMinor(dailyBudget, currency)} a day
              </span>
            ) : (
              dailyBudget > 0 && (
                <span className="caption" style={{ color: 'var(--pos-text)', fontWeight: 700 }}>
                  All under {formatMinor(dailyBudget, currency)} a day
                </span>
              )
            )}
          </div>
        )}
      </div>

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
            <h2 className="label">Today</h2>
            <span className="mono muted" style={{ fontWeight: 600, fontSize: 13 }}>
              {formatMinor(sts.spentToday, currency)}
            </span>
          </div>
        )}
        {monthLoaded === undefined ? null : todayTxns.length === 0 ? (
          <div className="empty">
            Nothing logged yet today.
            <br />
            <button style={{ color: 'var(--accent-text)', fontWeight: 600 }} onClick={onAdd}>
              The + is right there. Three seconds.
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

      <LoansSheet open={loansOpen} currency={currency} onClose={() => setLoansOpen(false)} />

      {balanceOpen && (
        <Sheet open onClose={() => setBalanceOpen(false)} label="Balance" style={{ gap: 10 }}>
          <div className="row-between">
            <span className="label" style={{ letterSpacing: '0.14em' }}>Balance</span>
            <button className="icon-btn" onClick={() => setBalanceOpen(false)} aria-label="Close">
              <Icon name="x" size={14} strokeWidth={2.2} />
            </button>
          </div>
          <div className="well" style={{ alignItems: 'center' }}>
            <span className="label" style={{ fontSize: 9.5 }}>Total, across every account</span>
            <span className="well-num" style={{ color: balance < 0 ? 'var(--red)' : undefined }}>
              {formatMinor(balance, currency)}
            </span>
          </div>
          <span className="label" style={{ fontSize: 10, paddingTop: 4 }}>By account</span>
          {accounts
            .filter((a) => !a.archived)
            .map((a) => {
              const acctBalance = byAccountBalance.get(a.id) ?? 0
              return (
                <div key={a.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '4px 0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="txn-icon" style={{ background: 'var(--sunken)', color: 'var(--muted)', width: 32, height: 32 }}>
                      <Icon name="wallet" size={15} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {a.name}
                    </span>
                    {editingBalance !== a.id && (
                      // a pill with a pencil: it looks like what it is, a figure you can change
                      <button
                        className="pill"
                        style={{ padding: '6px 12px', flexShrink: 0 }}
                        onClick={() => startEditBalance(a.id, acctBalance)}
                        aria-label={`Edit balance for ${a.name}, ${formatMinor(acctBalance, currency)}`}
                      >
                        <span className="mono" style={{ fontWeight: 700, fontSize: 14, color: acctBalance < 0 ? 'var(--red)' : 'var(--ink)' }}>
                          {formatMinor(acctBalance, currency)}
                        </span>
                        <Icon name="pencil" size={12} />
                      </button>
                    )}
                  </div>
                  {editingBalance === a.id && (
                    <div style={{ display: 'flex', gap: 8, paddingLeft: 42 }}>
                      <input aria-label={`New balance for ${a.name}`}
                        className="field mono"
                        type="number"
                        inputMode="decimal"
                        autoFocus
                        value={editBalanceValue}
                        onChange={(e) => setEditBalanceValue(e.target.value)}
                        style={{ flex: 1, padding: '8px 12px' }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void saveBalance(a.id, acctBalance)
                        }}
                      />
                      <button
                        className="icon-btn"
                        style={{ color: 'var(--pos-text)' }}
                        onClick={() => void saveBalance(a.id, acctBalance)}
                        aria-label={`Save balance for ${a.name}`}
                      >
                        <Icon name="check" size={15} strokeWidth={2.4} />
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          <span className="caption" style={{ fontSize: 11.5, paddingTop: 4 }}>
            Received money adds here; every expense, including savings tucked away, comes off it.
          </span>
        </Sheet>
      )}

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
