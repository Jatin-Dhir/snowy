import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { addRule, deleteRule, togglePauseRule } from '../db/recurring'
import { formatMinor } from '../lib/money'
import { todayISO } from '../lib/dates'
import { Icon } from './Icon'
import { haptic, useUi } from '../state/ui'

/** Monthly payments & subscriptions: they log themselves on their day. */
export function RecurringManager({ currency }: { currency: string }) {
  const { showToast } = useUi()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [day, setDay] = useState(String(parseInt(todayISO().slice(8, 10), 10)))
  const [cat, setCat] = useState('bills')

  const categories = useLiveQuery(() => db.categories.orderBy('sort').toArray(), []) ?? []
  const rules = useLiveQuery(() => db.rules.toArray(), []) ?? []
  const catOf = (id: string | null) => categories.find((c) => c.id === id)

  const minor = Math.round(parseFloat(amount) * 100) || 0
  const dayNum = Math.min(31, Math.max(1, parseInt(day, 10) || 1))
  const canSave = name.trim().length > 0 && minor > 0

  async function saveRule() {
    if (!canSave) return
    await addRule({ name: name.trim(), amountMinor: minor, categoryId: cat, dayOfMonth: dayNum })
    haptic('success')
    setAdding(false)
    setName('')
    setAmount('')
    showToast(`${name.trim()} logs itself on day ${dayNum} every month`)
  }

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 18px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span className="label" style={{ fontSize: 10.5 }}>Monthly payments &amp; subscriptions</span>
        <span className="caption" style={{ fontSize: 11.5 }}>
          Added once, logged automatically on their day — rent, Netflix, SIP, gym.
        </span>
      </div>

      {rules.map((r) => {
        const c = catOf(r.categoryId)
        return (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: r.paused ? 0.5 : 1 }}>
            <span
              className="txn-icon"
              style={{ background: `${c?.color ?? '#7A8794'}26`, color: c?.color ?? '#7A8794', width: 36, height: 36 }}
            >
              <Icon name={c?.icon ?? 'receipt'} size={17} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span
                style={{
                  display: 'block',
                  fontWeight: 600,
                  fontSize: 14,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}
              >
                {r.name}
              </span>
              <span className="caption" style={{ fontSize: 11.5 }}>
                {r.paused ? 'paused' : `day ${r.dayOfMonth} of every month`}
                {c ? ` · ${c.name}` : ''}
              </span>
            </span>
            <span className="mono" style={{ fontWeight: 700, fontSize: 13.5 }}>
              {formatMinor(r.amountMinor, currency)}
            </span>
            <button
              className="icon-btn"
              style={{ width: 28, height: 28 }}
              onClick={() => void togglePauseRule(r.id)}
              aria-label={r.paused ? 'Resume' : 'Pause'}
            >
              <Icon name={r.paused ? 'play' : 'pause'} size={13} />
            </button>
            <button
              className="icon-btn"
              style={{ width: 28, height: 28, color: 'var(--red)' }}
              onClick={() => void deleteRule(r.id)}
              aria-label="Delete rule"
            >
              <Icon name="trash" size={13} />
            </button>
          </div>
        )
      })}

      {adding ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 4 }}>
          <input
            className="field"
            placeholder="Name — e.g. Rent, Netflix, SIP"
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              className="field mono"
              type="number"
              inputMode="decimal"
              placeholder="Amount"
              value={amount}
              min={0}
              onChange={(e) => setAmount(e.target.value)}
            />
            <span className="caption" style={{ flexShrink: 0, fontSize: 12.5 }}>on day</span>
            <input
              className="field mono"
              style={{ width: 74 }}
              type="number"
              inputMode="numeric"
              min={1}
              max={31}
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="label" style={{ fontSize: 10 }}>Tag it as</span>
            <div className="chip-row" style={{ flexWrap: 'nowrap', overflowX: 'auto', paddingBottom: 2 }}>
              {categories
                .filter((c) => !c.archived)
                .map((c) => (
                  <button
                    key={c.id}
                    className={`chip${cat === c.id ? ' selected' : ''}`}
                    style={{ flexShrink: 0, ...(cat === c.id ? { background: `${c.color}26` } : {}) }}
                    onClick={() => {
                      haptic('selection')
                      setCat(c.id)
                    }}
                  >
                    <span className="dot" style={{ background: c.color }} />
                    {c.name}
                  </button>
                ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn ghost" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button className="btn" disabled={!canSave} onClick={() => void saveRule()}>
              {canSave ? `Add — ${formatMinor(minor, currency)} on day ${dayNum}` : 'Add'}
            </button>
          </div>
        </div>
      ) : (
        <button className="btn ghost" onClick={() => setAdding(true)}>
          <Icon name="plus" size={15} strokeWidth={2.4} /> Add a monthly payment
        </button>
      )}
    </div>
  )
}
