import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { txnsBetween } from '../db/repo'
import { byCategory, incomeSum, projectMonth, sum } from '../db/stats'
import { formatMinor } from '../lib/money'
import { adviceFor, smartNotes } from '../lib/smart'
import { Donut } from '../components/Donut'
import { Sheet } from '../components/Sheet'
import { addMonths, currentMonthKey, monthKeyOf, monthLabel, monthRange, monthShort, todayISO } from '../lib/dates'
import { Icon } from '../components/Icon'

export function Insights({ currency }: { currency: string }) {
  const nowKey = currentMonthKey()
  const [monthKey, setMonthKey] = useState(nowKey)
  const [reportOpen, setReportOpen] = useState(false)
  const today = todayISO()
  const isCurrent = monthKey === nowKey

  const categories = useLiveQuery(() => db.categories.orderBy('sort').toArray(), []) ?? []
  const rules = useLiveQuery(() => db.rules.toArray(), []) ?? []
  const budgets = useLiveQuery(() => db.budgets.toArray(), []) ?? []

  const windowFrom = monthRange(addMonths(monthKey, -5)).from
  const windowTo = monthRange(monthKey).to
  const windowTxns = useLiveQuery(() => txnsBetween(windowFrom, windowTo), [windowFrom, windowTo]) ?? []

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
        name: id ? (categories.find((c) => c.id === id)?.name ?? 'Other') : 'Uncategorized',
        color: id ? (categories.find((c) => c.id === id)?.color ?? '#7A8794') : '#7A8794'
      }))
      .sort((a, b) => b.total - a.total)
    const top = rows.slice(0, 4)
    const restTotal = rows.slice(4).reduce((a, r) => a + r.total, 0)
    return { top, restTotal, all: rows }
  }, [monthTxns, categories])

  const sixMonths = useMemo(() => {
    const keys = Array.from({ length: 6 }, (_, i) => addMonths(monthKey, i - 5))
    return keys.map((key) => ({
      key,
      total: sum(windowTxns.filter((t) => monthKeyOf(t.dateISO) === key))
    }))
  }, [windowTxns, monthKey])

  const notes = useMemo(() => smartNotes(monthTxns, categories, currency), [monthTxns, categories, currency])
  const chartMax = Math.max(...sixMonths.map((m) => m.total), isCurrent ? projected : 0, 1)
  const activeRules = rules.filter((r) => !r.paused)
  const rulesMonthly = activeRules.reduce((a, r) => a + r.amountMinor, 0)

  const W = 318
  const H = 88
  const base = 70
  const barW = 36
  const gap = (W - 6 * barW) / 7
  const x = (i: number) => gap + i * (barW + gap)
  const h = (v: number) => Math.max(v > 0 ? 4 : 0, Math.round((v / chartMax) * (base - 2)))

  return (
    <div className="screen">
      <div className="row-between">
        <span className="screen-title">Insights</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button className="icon-btn" onClick={() => setMonthKey(addMonths(monthKey, -1))} aria-label="Previous month">
            <Icon name="chevronLeft" size={16} />
          </button>
          <span className="pill" style={{ minWidth: 92, justifyContent: 'center' }}>
            {monthLabel(monthKey)}
          </span>
          <button
            className="icon-btn"
            onClick={() => setMonthKey(addMonths(monthKey, 1))}
            disabled={isCurrent}
            style={isCurrent ? { opacity: 0.35 } : undefined}
            aria-label="Next month"
          >
            <Icon name="chevronRight" size={16} />
          </button>
        </span>
      </div>

      {monthTxns.length === 0 ? (
        <div className="empty">No expenses in {monthLabel(monthKey)}. Log a few and this screen starts answering questions.</div>
      ) : (
        <>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '13px 20px' }}>
            <span className="label">{isCurrent ? 'Spent so far' : 'Spent'}</span>
            <div className="row-between">
              <span className="mono" style={{ fontWeight: 600, fontSize: 32, letterSpacing: '-0.02em' }}>
                {formatMinor(spent, currency)}
              </span>
              {vsPrev !== null && (
                <span
                  className="mono"
                  style={{ fontWeight: 600, fontSize: 13, color: vsPrev <= 0 ? 'var(--pos)' : 'var(--amber)' }}
                >
                  {vsPrev > 0 ? '+' : '−'}
                  {Math.abs(vsPrev)}% vs {monthLabel(prevKey).slice(0, 3)}
                </span>
              )}
            </div>
            {isCurrent && (
              <span className="caption">Projected {formatMinor(projected, currency)} by month end.</span>
            )}
            {received > 0 && (
              <span className="caption" style={{ color: 'var(--pos)', fontWeight: 600 }}>
                Received +{formatMinor(received, currency)} this month
              </span>
            )}
          </div>

          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '15px 20px' }}>
            <span className="label">Where it went</span>
            <Donut
              segments={[
                ...breakdown.top.map((r) => ({ color: r.color, value: r.total })),
                ...(breakdown.restTotal > 0 ? [{ color: 'var(--faint-future)', value: breakdown.restTotal }] : [])
              ]}
              centerTop={formatMinor(spent, currency)}
              centerBottom={monthLabel(monthKey)}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {breakdown.top.map((r) => (
                <div key={String(r.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '3px 0' }}>
                  <span style={{ width: 8, height: 8, borderRadius: 4, background: r.color, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontWeight: 500, fontSize: 14 }}>{r.name}</span>
                  <span className="mono" style={{ fontWeight: 600, fontSize: 13.5 }}>
                    {formatMinor(r.total, currency)}
                  </span>
                  <span className="mono faint" style={{ fontSize: 11.5, width: 34, textAlign: 'right' }}>
                    {Math.round((r.total / spent) * 100)}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          {notes.length > 0 && (
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '13px 20px' }}>
              <span className="label">Smart notes</span>
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
              <span className="caption" style={{ fontSize: 11.5 }}>What happened, and how to do better</span>
            </span>
            <span className="faint">
              <Icon name="chevronRight" size={15} />
            </span>
          </button>

          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '13px 20px' }}>
            <div className="row-between">
              <span className="label">Six months</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', margin: '0 auto', maxWidth: '100%' }}>
                <line x1="0" y1={base + 0.5} x2={W} y2={base + 0.5} stroke="var(--line)" strokeWidth="1" />
                {sixMonths.map((m, i) => {
                  const isLast = i === 5
                  const solidH = h(m.total)
                  return (
                    <g key={m.key}>
                      {isLast && isCurrent && projected > m.total && (
                        <rect
                          x={x(i)}
                          y={base - h(projected)}
                          width={barW}
                          height={h(projected)}
                          rx="6"
                          fill="none"
                          stroke="var(--pos)"
                          strokeWidth="1.4"
                          strokeDasharray="3 3"
                          opacity="0.7"
                        />
                      )}
                      {solidH > 0 && (
                        <rect
                          x={x(i)}
                          y={base - solidH}
                          width={barW}
                          height={solidH}
                          rx="6"
                          fill={isLast ? 'var(--pos)' : 'var(--bar-idle)'}
                        />
                      )}
                      <text
                        x={x(i) + barW / 2}
                        y={H - 4}
                        textAnchor="middle"
                        fontFamily="Plus Jakarta Sans, Segoe UI, sans-serif"
                        fontSize="9"
                        fill={isLast ? 'var(--accent)' : 'var(--faint)'}
                      >
                        {monthShort(m.key)}
                      </text>
                    </g>
                  )
                })}
              </svg>
            </div>
            {isCurrent && (
              <span className="caption" style={{ fontSize: 11.5, textAlign: 'center' }}>
                Solid = spent so far · dashed outline = where this month is heading
              </span>
            )}
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
              <span className="well-num" style={{ color: received > 0 ? 'var(--pos)' : undefined }}>
                {received > 0 ? `+${formatMinor(received, currency)}` : '—'}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="label" style={{ fontSize: 10.5 }}>How to improve</span>
            {adviceFor({ monthTxns, monthKey, categories, budgets, rulesMonthly, currency }).map((tip, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span
                  className="mono"
                  style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 13, width: 18, flexShrink: 0 }}
                >
                  {i + 1}.
                </span>
                <span style={{ fontSize: 13.5, color: 'var(--muted)', fontWeight: 500 }}>{tip}</span>
              </div>
            ))}
          </div>
        </Sheet>
      )}

      {activeRules.length > 0 && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '13px 20px' }}>
          <div className="row-between">
            <span className="label">Recurring</span>
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
