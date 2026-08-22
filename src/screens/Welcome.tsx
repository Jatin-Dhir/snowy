import { useState } from 'react'
import { db, saveSettings } from '../db/db'
import { CURRENCIES } from '../lib/money'

export function Welcome({ onDone }: { onDone: () => void }) {
  const [currency, setCurrency] = useState('INR')
  const [budget, setBudget] = useState('')

  async function start() {
    const minor = (parseInt(budget, 10) || 0) * 100
    if (minor > 0) await db.budgets.put({ id: 'overall', amountMinor: minor })
    await saveSettings({ initialized: true, currency })
    onDone()
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 70,
        background: 'var(--bg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24
      }}
    >
      <div style={{ width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <svg width="38" height="36" viewBox="0 0 44 42" aria-hidden="true" style={{ color: 'var(--accent)' }}>
            <ellipse cx="9" cy="18.5" rx="3.3" ry="4.3" transform="rotate(-24 9 18.5)" fill="currentColor" />
            <ellipse cx="17" cy="13" rx="3.4" ry="4.4" transform="rotate(-8 17 13)" fill="currentColor" />
            <ellipse cx="27" cy="13" rx="3.4" ry="4.4" transform="rotate(8 27 13)" fill="currentColor" />
            <ellipse cx="35" cy="18.5" rx="3.3" ry="4.3" transform="rotate(24 35 18.5)" fill="currentColor" />
            <circle cx="18.7" cy="25.5" r="5.2" fill="currentColor" />
            <circle cx="25.3" cy="25.5" r="5.2" fill="currentColor" />
            <ellipse cx="22" cy="26.5" rx="8.4" ry="5" fill="currentColor" />
            <path d="M14 27 h16 L22 35.6 Z" fill="currentColor" />
          </svg>
          <span className="display" style={{ fontWeight: 700, fontSize: 26 }}>Taily</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h1 className="display" style={{ margin: 0, fontSize: 34, lineHeight: 1.15, letterSpacing: '-0.02em' }}>
            Three seconds<br />to logged.
          </h1>
          <p className="muted" style={{ margin: 0, fontSize: 15.5 }}>
            No account, no sync-ups, no forms. Your expenses stay on this device, and logging one takes two taps.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="label" style={{ fontSize: 10.5 }}>Currency</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {CURRENCIES.slice(0, 4).map((c) => (
              <button
                key={c.code}
                className={`pill${currency === c.code ? ' active' : ''}`}
                onClick={() => setCurrency(c.code)}
              >
                {c.symbol} {c.code}
              </button>
            ))}
            <select
              className="pill"
              value={CURRENCIES.slice(0, 4).some((c) => c.code === currency) ? '' : currency}
              onChange={(e) => e.target.value && setCurrency(e.target.value)}
              style={{ appearance: 'none' }}
            >
              <option value="">more…</option>
              {CURRENCIES.slice(4).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.symbol} {c.code}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="label" style={{ fontSize: 10.5 }}>Monthly budget · optional</span>
          <input
            className="field mono"
            type="number"
            inputMode="numeric"
            placeholder="e.g. 45000 — unlocks safe-to-spend"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            style={{ fontSize: 17, fontWeight: 600 }}
          />
        </div>

        <button className="btn" style={{ padding: '15px 18px' }} onClick={() => void start()}>
          Start tracking
        </button>
      </div>
    </div>
  )
}
