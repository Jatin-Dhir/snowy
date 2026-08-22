import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { addRule, deleteRule, togglePauseRule } from '../db/recurring'
import { formatMinor } from '../lib/money'
import { todayISO } from '../lib/dates'
import { Icon } from './Icon'
import { useUi } from '../state/ui'

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

  async function saveRule() {
    const minor = Math.round(parseFloat(amount) * 100) || 0
    const d = Math.min(31, Math.max(1, parseInt(day, 10) || 1))
    if (!name.trim() || minor <= 0) return
    await addRule({ name: name.trim(), amountMinor: minor, categoryId: cat, dayOfMonth: d })
    setAdding(false)
    setName('')
    setAmount('')
    showToast(`${name.trim()} logs itself on day ${d} every month`)
  }

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 18px' }}>
      <div className="row-between">
        <span className="label" style={{ fontSize: 10.5 }}>Monthly payments &amp; subscriptions</span>
        {!adding && (
          <button style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 13 }} onClick={() => setAdding(true)}>
            + Add
          </button>
        )}
      </div>
      {rules.length === 0 && !adding && (
        <span className="caption">
          Rent, Netflix, SIP, gym — add them once and Taily logs them automatically every month.
        </span>
      )}
      {rules.map((r) => (
        <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: r.paused ? 0.5 : 1 }}>
          <span style={{ flex: 1, fontWeight: 600, fontSize: 14 }}>{r.name}</span>
          <span className="caption" style={{ fontSize: 11.5 }}>day {r.dayOfMonth}</span>
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
      ))}
      {adding && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4 }}>
          <input
            className="field"
            placeholder="Name — e.g. Rent, Netflix, SIP"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="field mono"
              type="number"
              inputMode="decimal"
              placeholder="Amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <input
              className="field mono"
              style={{ width: 92 }}
              type="number"
              inputMode="numeric"
              min={1}
              max={31}
              placeholder="Day"
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
          </div>
          <select className="field" value={cat} onChange={(e) => setCat(e.target.value)}>
            {categories
              .filter((c) => !c.archived)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn ghost" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button className="btn" onClick={() => void saveRule()}>
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
