import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Txn } from '../db/db'
import { txnsBetween } from '../db/repo'
import { byCategory, incomeSum, isRealSpend, pace, projectMonth, sum } from '../db/stats'
import { formatCompact, formatMinor } from '../lib/money'
import { adviceFor, smartNotes } from '../lib/smart'
import { LoansSheet } from '../components/LoansSheet'
import { Sheet } from '../components/Sheet'
import {
  addMonths,
  currentMonthKey,
  daysInMonth,
  fromISO,
  monthKeyOf,
  monthLabel,
  monthRange,
  monthShort,
  todayISO
} from '../lib/dates'
import { Icon } from '../components/Icon'
import { MonthPicker } from '../components/MonthPicker'
import { MonthSheet } from '../components/MonthSheet'
import { TagEntriesSheet, type TagPick } from '../components/TagEntriesSheet'
import { haptic } from '../state/ui'

export function Insights({
  currency,
  onAdd,
  onEdit,
  onOpenSettings
}: {
  currency: string
  onAdd: () => void
  onEdit: (t: Txn) => void
  onOpenSettings: () => void
}) {
  const nowKey = currentMonthKey()
  const [monthKey, setMonthKey] = useState(nowKey)
  // the six months the chart shows, ending here. A month picked in it stays where it is, so the chart can be used to
  // pick; a month the arrows reach outside it slides it along by as little as it takes
  const [chartEnd, setChartEnd] = useState(nowKey)
  const [reportOpen, setReportOpen] = useState(false)
  // the month this screen shows, read back day by day: from the "Spent" card
  const [monthOpen, setMonthOpen] = useState(false)
  // every month, to jump to one: from the month's name
  const [picking, setPicking] = useState(false)
  const [showRest, setShowRest] = useState(false)
  // a "Where it went" row, opened to show what's in it
  const [openTag, setOpenTag] = useState<TagPick | null>(null)
  const today = todayISO()
  const isCurrent = monthKey === nowKey

  useEffect(() => {
    setShowRest(false)
    setOpenTag(null)
  }, [monthKey])

  function show(key: string) {
    setMonthKey(key)
    setChartEnd((end) => {
      if (key > end) return key
      if (key >= addMonths(end, -5)) return end
      const fromKey = addMonths(key, 5)
      return fromKey > nowKey ? nowKey : fromKey
    })
  }

  const categories = useLiveQuery(() => db.categories.orderBy('sort').toArray(), []) ?? []
  const rules = useLiveQuery(() => db.rules.toArray(), []) ?? []
  const budgets = useLiveQuery(() => db.budgets.toArray(), []) ?? []
  const overallBudget = useLiveQuery(() => db.budgets.get('overall'), [])

  // the chart's six months, and the one before them: the month before the one shown, for "vs Oct"
  const windowFrom = monthRange(addMonths(chartEnd, -6)).from
  const windowTo = monthRange(chartEnd).to
  // undefined until the first read: the empty state waits for it rather than flashing on every visit
  const windowLoaded = useLiveQuery(() => txnsBetween(windowFrom, windowTo), [windowFrom, windowTo])
  const windowTxns = windowLoaded ?? []

  const monthTxns = useMemo(() => windowTxns.filter((t) => monthKeyOf(t.dateISO) === monthKey), [windowTxns, monthKey])
  const spent = sum(monthTxns)
  const received = incomeSum(monthTxns)
  const projected = isCurrent ? projectMonth(monthTxns, monthKey, today) : spent

  const prevKey = addMonths(monthKey, -1)
  const vsPrev = useMemo(() => {
    const dayCap = isCurrent ? today.slice(8, 10) : '31'
    const prevThroughDay = sum(
      windowTxns.filter((t) => monthKeyOf(t.dateISO) === prevKey && t.dateISO.slice(8, 10) <= dayCap)
    )
    if (prevThroughDay <= 0) return null
    return Math.round(((spent - prevThroughDay) / prevThroughDay) * 100)
  }, [windowTxns, prevKey, spent, isCurrent, today])

  const breakdown = useMemo(() => {
    const totals = byCategory(monthTxns)
    const rows = [...totals.entries()]
      .map(([id, total]) => ({
        id,
        total,
        name: id ? (categories.find((c) => c.id === id)?.name ?? 'Other') : 'Untagged',
        color: id ? (categories.find((c) => c.id === id)?.color ?? '#7A8794') : '#7A8794'
      }))
      .sort((a, b) => b.total - a.total)
    const top = rows.slice(0, 4)
    const restTotal = rows.slice(4).reduce((a, r) => a + r.total, 0)
    return { top, restTotal, all: rows }
  }, [monthTxns, categories])

  const sixMonths = useMemo(() => {
    const keys = Array.from({ length: 6 }, (_, i) => addMonths(chartEnd, i - 5))
    return keys.map((key) => ({
      key,
      total: sum(windowTxns.filter((t) => monthKeyOf(t.dateISO) === key))
    }))
  }, [windowTxns, chartEnd])

  const budgetCtx = useMemo(() => {
    if (!overallBudget || overallBudget.amountMinor <= 0) return null
    const pct = Math.round((spent / overallBudget.amountMinor) * 100)
    const budgetLabel = formatMinor(overallBudget.amountMinor, currency)
    if (!isCurrent) return { pct, budgetLabel, paceLabel: null as string | null }
    const p = pace(spent, overallBudget.amountMinor)
    const paceLabel = p.state === 'over' ? 'over' : p.state === 'warn' ? 'ahead of pace' : 'on pace'
    return { pct, budgetLabel, paceLabel }
  }, [overallBudget, spent, isCurrent, currency])

  const notes = useMemo(() => smartNotes(monthTxns, categories, currency), [monthTxns, categories, currency])
  const chartMax = Math.max(...sixMonths.map((m) => m.total), 1)
  const activeRules = rules.filter((r) => !r.paused)
  const rulesMonthly = activeRules.reduce((a, r) => a + r.amountMinor, 0)

  const loans = useLiveQuery(() => db.loans.toArray(), []) ?? []
  const [loansOpen, setLoansOpen] = useState(false)
  const owedToMe = loans.filter((l) => !l.settledISO && l.direction === 'lent').reduce((a, l) => a + l.amountMinor, 0)
  const iOwe = loans.filter((l) => !l.settledISO && l.direction === 'borrowed').reduce((a, l) => a + l.amountMinor, 0)

  // the monthly report: real numbers first, advice second
  const report = useMemo(() => {
    // "heaviest day" / "per day" / "no-spend days" describe purchase habits —
    // a savings tuck-away shouldn't make a day look artificially heavy
    const outs = monthTxns.filter(isRealSpend)
    const daysElapsed = isCurrent ? Math.max(1, parseInt(today.slice(8, 10), 10)) : daysInMonth(monthKey)
    const byDay = new Map<string, number>()
    for (const t of outs) byDay.set(t.dateISO, (byDay.get(t.dateISO) ?? 0) + t.amountMinor)
    let biggestDay: { iso: string; total: number } | null = null
    for (const [iso, total] of byDay) {
      if (!biggestDay || total > biggestDay.total) biggestDay = { iso, total }
    }
    // mid-month, compare against the same days of last month — not its full
    // total — so the deltas agree with the header's vs-last-month figure
    const dayCap = isCurrent ? today.slice(8, 10) : '99'
    const prevTxns = windowTxns.filter(
      (t) => monthKeyOf(t.dateISO) === prevKey && t.dateISO.slice(8, 10) <= dayCap
    )
    const prevTotals = byCategory(prevTxns)
    const topTags = breakdown.top.slice(0, 3).map((r) => {
      const prev = prevTotals.get(r.id) ?? 0
      return { ...r, delta: prev > 0 ? Math.round(((r.total - prev) / prev) * 100) : null }
    })
    return {
      // an average, so whole rupees, like Home's week
      dailyAvg: Math.round(spent / daysElapsed / 100) * 100,
      biggestDay,
      noSpendDays: Math.max(0, daysElapsed - byDay.size),
      topTags
    }
  }, [monthTxns, windowTxns, breakdown, prevKey, spent, isCurrent, today, monthKey])

  // `after` follows the name (the rest row's chevron), so the amount and % columns line up on every row
  const catRow = (r: { total: number; name: string; color: string }, after?: ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ width: 8, height: 8, borderRadius: 4, background: r.color, flexShrink: 0 }} />
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontWeight: 500,
          fontSize: 14,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}
      >
        {r.name}
        {after}
      </span>
      <span className="mono" style={{ fontWeight: 600, fontSize: 13.5 }}>
        {formatMinor(r.total, currency)}
      </span>
      <span className="mono faint" style={{ fontSize: 11.5, width: 34, textAlign: 'right' }}>
        {Math.round((r.total / spent) * 100)}%
      </span>
    </div>
  )

  // a row that opens: the same quiet chevron as "Everything else", after the name so the figures stay in line
  const opens = (
    <span className="faint" aria-hidden="true" style={{ display: 'inline-flex', marginLeft: 4, verticalAlign: '-2px' }}>
      <Icon name="chevronRight" size={13} />
    </span>
  )

  const W = 318
  const H = 102
  const base = 82
  const barW = 36
  const gap = (W - 6 * barW) / 7
  const x = (i: number) => gap + i * (barW + gap)
  const h = (v: number) => Math.max(v > 0 ? 4 : 0, Math.round((v / chartMax) * (base - 18)))

  return (
    <div className="screen">
      {/* wraps on the narrowest phones rather than pushing Settings off the screen */}
      <div className="row-between" style={{ flexWrap: 'wrap', rowGap: 8 }}>
        <h1 className="screen-title">Insights</h1>
        <span style={{ display: 'flex', alignItems: 'center', gap: 3, marginLeft: 'auto' }}>
          <button className="icon-btn" onClick={() => show(addMonths(monthKey, -1))} aria-label="Previous month">
            <Icon name="chevronLeft" size={16} />
          </button>
          {/* the arrows either side step it on; the name itself opens every month to jump to */}
          <span className="month-title" aria-live="polite">
            <button className="month-pick" aria-haspopup="dialog" onClick={() => setPicking(true)}>
              {monthLabel(monthKey)}
              <span className="month-pick-chev" aria-hidden="true">
                <Icon name="chevronDown" size={11} strokeWidth={2.4} />
              </span>
            </button>
          </span>
          <button
            className="icon-btn"
            onClick={() => show(addMonths(monthKey, 1))}
            disabled={isCurrent}
            style={isCurrent ? { opacity: 0.35 } : undefined}
            aria-label="Next month"
          >
            <Icon name="chevronRight" size={16} />
          </button>
          <button
            className="icon-btn"
            style={{ width: 36, height: 36, borderRadius: 18, marginLeft: 4 }}
            onClick={onOpenSettings}
            aria-label="Settings"
          >
            <Icon name="gear" size={18} strokeWidth={1.6} />
          </button>
        </span>
      </div>

      {windowLoaded === undefined ? null : monthTxns.length === 0 ? (
        <div className="empty" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <span>No expenses in {monthLabel(monthKey)}. Log a few and this screen starts answering questions.</span>
          {isCurrent ? (
            <button className="btn" style={{ width: 'auto', padding: '10px 22px' }} onClick={onAdd}>
              Add an expense
            </button>
          ) : (
            // the same words as the month read back in Activity, for the same way home
            <button className="btn ghost" style={{ width: 'auto', padding: '10px 22px' }} onClick={() => show(nowKey)}>
              Back to {monthLabel(nowKey)}
            </button>
          )}
        </div>
      ) : (
        <>
          {/* the month's figures open the month itself, day by day, on the month this screen shows */}
          <button
            className="card"
            style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '13px 20px', textAlign: 'left' }}
            onClick={() => setMonthOpen(true)}
          >
            <span className="label" style={{ display: 'inline-flex', alignItems: 'center' }}>
              {isCurrent ? 'Spent so far' : 'Spent'}
              {opens}
            </span>
            <span className="row-between" style={{ width: '100%' }}>
              <span className="mono" style={{ fontWeight: 600, fontSize: 32, letterSpacing: '-0.02em' }}>
                {formatMinor(spent, currency)}
              </span>
              {vsPrev !== null && (
                <span
                  className="mono"
                  style={{ fontWeight: 600, fontSize: 13, color: vsPrev <= 0 ? 'var(--pos-text)' : 'var(--amber-text)' }}
                >
                  {vsPrev > 0 ? '+' : '−'}
                  {Math.abs(vsPrev)}% vs {monthLabel(prevKey).slice(0, 3)}
                </span>
              )}
            </span>
            {budgetCtx && (
              <span className="caption">
                {budgetCtx.pct}% of your {budgetCtx.budgetLabel} budget{budgetCtx.paceLabel ? ` · ${budgetCtx.paceLabel}` : ''}
              </span>
            )}
            {isCurrent && today !== monthRange(monthKey).to && (
              <span className="caption">Projected {formatMinor(projected, currency)} by month end.</span>
            )}
            {received > 0 && (
              <span className="caption" style={{ color: 'var(--pos-text)', fontWeight: 600 }}>
                Received +{formatMinor(received, currency)} {isCurrent ? 'this month' : `in ${monthLabel(monthKey)}`}
              </span>
            )}
            {/* everything on the card is its name, with where it leads after it */}
            <span className="sr-only">Show {monthLabel(monthKey)} day by day</span>
          </button>

          {/* a month with only money received in it (pay day, before anything is spent) has nothing to show here */}
          {spent > 0 && (
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 13, padding: '15px 20px' }}>
              <h2 className="label">Where it went</h2>
              {breakdown.top.map((r) => (
                <button
                  key={String(r.id)}
                  className="tag-row"
                  style={{ display: 'flex', flexDirection: 'column', gap: 5 }}
                  onClick={() => setOpenTag(r)}
                  aria-label={`${r.name}: ${formatMinor(r.total, currency)}, ${Math.round((r.total / spent) * 100)}%. Show its entries`}
                >
                  {catRow(r, opens)}
                  <div className="bar-track" style={{ height: 6 }}>
                    <div
                      className="bar-fill"
                      style={{ width: `${Math.max(2, (r.total / spent) * 100)}%`, background: r.color }}
                    />
                  </div>
                </button>
              ))}
              {breakdown.restTotal > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <button
                    style={{ display: 'flex', flexDirection: 'column', gap: 5, width: '100%', textAlign: 'start' }}
                    onClick={() => setShowRest((v) => !v)}
                    aria-expanded={showRest}
                  >
                    {catRow(
                      { total: breakdown.restTotal, name: 'Everything else', color: 'var(--faint-future)' },
                      <span
                        className="faint"
                        style={{
                          display: 'inline-flex',
                          marginLeft: 4,
                          verticalAlign: '-2px',
                          transform: showRest ? 'rotate(90deg)' : undefined,
                          transition: 'transform .15s'
                        }}
                      >
                        <Icon name="chevronRight" size={13} />
                      </span>
                    )}
                    <div className="bar-track" style={{ height: 6 }}>
                      <div
                        className="bar-fill"
                        style={{ width: `${Math.max(2, (breakdown.restTotal / spent) * 100)}%`, background: 'var(--faint-future)' }}
                      />
                    </div>
                  </button>
                  {showRest && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 18, paddingTop: 2 }}>
                      {breakdown.all.slice(4).map((r) => (
                        <button
                          key={String(r.id)}
                          className="tag-row"
                          style={{ display: 'flex', alignItems: 'center', gap: 10 }}
                          onClick={() => setOpenTag(r)}
                          aria-label={`${r.name}: ${formatMinor(r.total, currency)}. Show its entries`}
                        >
                          <span style={{ width: 6, height: 6, borderRadius: 3, background: r.color, flexShrink: 0 }} />
                          <span
                            style={{
                              flex: 1,
                              minWidth: 0,
                              fontSize: 13,
                              fontWeight: 500,
                              color: 'var(--muted)',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis'
                            }}
                          >
                            {r.name}
                            {opens}
                          </span>
                          <span className="mono" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--muted)' }}>
                            {formatMinor(r.total, currency)}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {notes.length > 0 && (
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '13px 20px' }}>
              <h2 className="label">Smart notes</h2>
              {notes.map((n, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span style={{ width: 7, height: 7, borderRadius: 4, background: 'var(--pos)', flexShrink: 0, marginTop: 6 }} />
                  <span style={{ fontSize: 13.5, color: 'var(--muted)', fontWeight: 500 }}>{n}</span>
                </div>
              ))}
            </div>
          )}

          <button className="action-row" onClick={() => setReportOpen(true)}>
            <span className="txn-icon" style={{ background: 'var(--pos-soft)', color: 'var(--accent)', width: 38, height: 38 }}>
              <Icon name="bars" size={18} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontWeight: 700, fontSize: 14 }}>Monthly report &amp; tips</span>
              <span className="caption" style={{ display: 'block', fontSize: 11.5 }}>What happened, and how to do better</span>
            </span>
            <span className="faint">
              <Icon name="chevronRight" size={15} />
            </span>
          </button>

          <button className="action-row" onClick={() => setLoansOpen(true)}>
            <span className="txn-icon" style={{ background: 'var(--pos-soft)', color: 'var(--accent)', width: 38, height: 38 }}>
              <Icon name="person" size={18} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontWeight: 700, fontSize: 14 }}>Lent &amp; borrowed</span>
              <span className="caption" style={{ display: 'block', fontSize: 11.5 }}>
                {owedToMe > 0 || iOwe > 0
                  ? [
                      owedToMe > 0 ? `${formatMinor(owedToMe, currency)} owed to you` : '',
                      iOwe > 0 ? `you owe ${formatMinor(iOwe, currency)}` : ''
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : 'Money between you and people'}
              </span>
            </span>
            <span className="faint">
              <Icon name="chevronRight" size={15} />
            </span>
          </button>

          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '13px 20px' }}>
            <div className="row-between">
              <h2 className="label">Six months</h2>
              {/* the bars look like a chart, not buttons: this says they are */}
              <span className="caption" style={{ fontSize: 11.5 }}>
                Tap a month to see it
              </span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <div className="six-chart" style={{ width: W, height: H }}>
                <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', maxWidth: '100%' }} aria-hidden="true">
                  <line x1="0" y1={base + 0.5} x2={W} y2={base + 0.5} stroke="var(--line)" strokeWidth="1" />
                  {sixMonths.map((m, i) => {
                    // the month the screen shows, wherever it sits in the six
                    const shown = m.key === monthKey
                    const solidH = h(m.total)
                    return (
                      <g key={m.key}>
                        {solidH > 0 && (
                          <rect
                            x={x(i)}
                            y={base - solidH}
                            width={barW}
                            height={solidH}
                            rx="6"
                            style={{ fill: shown ? 'var(--pos)' : 'var(--bar-idle)', transition: 'fill 180ms ease' }}
                          />
                        )}
                        {m.total >= 50 && (
                          <text
                            x={x(i) + barW / 2}
                            y={base - solidH - 5}
                            textAnchor="middle"
                            fontFamily="Space Grotesk, Plus Jakarta Sans, sans-serif"
                            fontWeight="600"
                            fontSize="12"
                            fill={shown ? 'var(--ink)' : 'var(--faint)'}
                          >
                            {formatCompact(m.total, currency)}
                          </text>
                        )}
                        <text
                          x={x(i) + barW / 2}
                          y={H - 4}
                          textAnchor="middle"
                          fontFamily="Plus Jakarta Sans, Segoe UI, sans-serif"
                          fontSize="12.5"
                          fill={shown ? 'var(--accent-text)' : 'var(--faint)'}
                        >
                          {monthShort(m.key)}
                        </text>
                      </g>
                    )
                  })}
                </svg>
                {/* each month's column is a button laid over the chart: a tap shows that month and the chart stays put,
                    so the next tap can pick another. A month with nothing spent has nothing to show */}
                {sixMonths.map((m, i) => (
                  <button
                    key={m.key}
                    className="six-hit"
                    style={{ left: `${((x(i) - gap / 2) / W) * 100}%`, width: `${((barW + gap) / W) * 100}%` }}
                    disabled={m.total <= 0}
                    aria-pressed={m.key === monthKey}
                    aria-label={`${monthLabel(m.key)}: ${formatMinor(m.total, currency)}`}
                    onClick={() => {
                      if (m.key === monthKey) return
                      haptic('selection')
                      show(m.key)
                    }}
                  />
                ))}
              </div>
            </div>
            <span className="caption" style={{ fontSize: 11.5, textAlign: 'center', textWrap: 'balance' }}>
              {sixMonths.some((m) => m.key === nowKey)
                ? `Total spent each month — ${monthLabel(nowKey)} is still counting`
                : 'Total spent each month'}
            </span>
          </div>
        </>
      )}

      {reportOpen && (
        <Sheet open onClose={() => setReportOpen(false)} label="Monthly report" style={{ gap: 14 }}>
          <div className="row-between">
            <span className="label" style={{ letterSpacing: '0.14em' }}>
              {monthLabel(monthKey)} report
            </span>
            <button className="icon-btn" onClick={() => setReportOpen(false)} aria-label="Close">
              <Icon name="x" size={14} strokeWidth={2.2} />
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="well">
              <span className="label" style={{ fontSize: 9.5 }}>Spent</span>
              <span className="well-num">{formatMinor(spent, currency)}</span>
            </div>
            <div className="well">
              <span className="label" style={{ fontSize: 9.5 }}>Received</span>
              <span className="well-num" style={{ color: received > 0 ? 'var(--pos-text)' : undefined }}>
                {received > 0 ? `+${formatMinor(received, currency)}` : '—'}
              </span>
            </div>
            <div className="well">
              <span className="label" style={{ fontSize: 9.5 }}>Per day</span>
              <span className="well-num">{formatMinor(report.dailyAvg, currency)}</span>
            </div>
            <div className="well">
              <span className="label" style={{ fontSize: 9.5 }}>No-spend days</span>
              <span className="well-num" style={{ color: report.noSpendDays > 0 ? 'var(--pos-text)' : undefined }}>
                {report.noSpendDays}
              </span>
            </div>
          </div>

          {report.biggestDay && (
            <div className="row-between" style={{ padding: '2px 2px 0' }}>
              <span className="caption" style={{ fontSize: 12.5 }}>
                Heaviest day: {fromISO(report.biggestDay.iso).toLocaleString('en-IN', { day: 'numeric', month: 'short' })}
              </span>
              <span className="mono" style={{ fontWeight: 700, fontSize: 13 }}>
                {formatMinor(report.biggestDay.total, currency)}
              </span>
            </div>
          )}

          {report.topTags.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="label" style={{ fontSize: 10.5 }}>
                Top tags vs {monthLabel(prevKey).slice(0, 3)}
                {isCurrent ? ' (same days)' : ''}
              </span>
              {report.topTags.map((r) => (
                <div key={String(r.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2px 0' }}>
                  <span style={{ width: 8, height: 8, borderRadius: 4, background: r.color, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontWeight: 500, fontSize: 13.5 }}>{r.name}</span>
                  <span className="mono" style={{ fontWeight: 600, fontSize: 13 }}>
                    {formatMinor(r.total, currency)}
                  </span>
                  <span
                    className="mono"
                    style={{
                      fontSize: 11.5,
                      fontWeight: 700,
                      width: 52,
                      textAlign: 'right',
                      color: r.delta === null ? 'var(--faint)' : r.delta > 0 ? 'var(--amber-text)' : 'var(--pos-text)'
                    }}
                  >
                    {r.delta === null ? 'new' : `${r.delta > 0 ? '▲' : '▼'}${Math.abs(r.delta)}%`}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="label" style={{ fontSize: 10.5 }}>Do better</span>
            {adviceFor({ monthTxns, monthKey, categories, budgets, rulesMonthly, currency })
              .slice(0, 3)
              .map((tip, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span
                    className="mono"
                    style={{ color: 'var(--accent-text)', fontWeight: 700, fontSize: 13, width: 18, flexShrink: 0 }}
                  >
                    {i + 1}.
                  </span>
                  <span style={{ fontSize: 13.5, color: 'var(--muted)', fontWeight: 500 }}>{tip}</span>
                </div>
              ))}
          </div>
        </Sheet>
      )}

      <LoansSheet open={loansOpen} currency={currency} onClose={() => setLoansOpen(false)} />

      {monthOpen && (
        <MonthSheet currency={currency} initialMonth={monthKey} onEdit={onEdit} onClose={() => setMonthOpen(false)} />
      )}
      {picking && <MonthPicker value={monthKey} currency={currency} onPick={show} onClose={() => setPicking(false)} />}

      {openTag && (
        <TagEntriesSheet
          tag={openTag}
          monthKey={monthKey}
          isCurrent={isCurrent}
          monthTxns={monthTxns}
          monthSpent={spent}
          budgetMinor={openTag.id ? (budgets.find((b) => b.id === openTag.id)?.amountMinor ?? null) : null}
          categories={categories}
          currency={currency}
          onEdit={onEdit}
          onClose={() => setOpenTag(null)}
        />
      )}

      {activeRules.length > 0 && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '13px 20px' }}>
          <div className="row-between">
            <h2 className="label">Recurring</h2>
            <span className="mono muted" style={{ fontWeight: 600, fontSize: 12.5 }}>
              {formatMinor(rulesMonthly, currency)}/mo
            </span>
          </div>
          {activeRules.map((r) => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
              <span style={{ flex: 1, fontWeight: 500, fontSize: 14 }}>{r.name}</span>
              <span className="caption" style={{ fontSize: 11.5 }}>
                day {r.dayOfMonth}
              </span>
              <span className="mono" style={{ fontWeight: 600, fontSize: 13.5 }}>
                {formatMinor(r.amountMinor, currency)}
              </span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px dotted var(--line-strong)', paddingTop: 6 }}>
            <span className="caption">
              that's <b style={{ color: 'var(--ink)' }}>{formatMinor(rulesMonthly * 12, currency)} a year</b>
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
