import { useEffect, useRef, useState } from 'react'
import { db, saveSettings } from '../db/db'
import { CURRENCIES } from '../lib/money'
import { Icon } from '../components/Icon'
import { haptic } from '../state/ui'

/** The Taily paw — four toes and a soft heel pad, in whatever color it sits on. */
export function TailyMark({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <ellipse cx="5.6" cy="10.2" rx="1.8" ry="2.35" transform="rotate(-24 5.6 10.2)" />
      <ellipse cx="9.3" cy="7.6" rx="1.95" ry="2.5" transform="rotate(-8 9.3 7.6)" />
      <ellipse cx="14.7" cy="7.6" rx="1.95" ry="2.5" transform="rotate(8 14.7 7.6)" />
      <ellipse cx="18.4" cy="10.2" rx="1.8" ry="2.35" transform="rotate(24 18.4 10.2)" />
      <path d="M12 11.9 C15.1 11.9 17.3 13.9 17.3 16.3 C17.3 18.1 16 19.2 14.5 19.8 C13.6 20.2 12.8 20.7 12 20.7 C11.2 20.7 10.4 20.2 9.5 19.8 C8 19.2 6.7 18.1 6.7 16.3 C6.7 13.9 8.9 11.9 12 11.9 Z" />
    </svg>
  )
}

/** First open: one warm animated hello, then currency, then an optional budget. */
export function Welcome({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0)
  const [currency, setCurrency] = useState('INR')
  const [budget, setBudget] = useState('')
  const autoRef = useRef<number | null>(null)

  // the hello holds for a beat, then glides into setup on its own
  useEffect(() => {
    if (step !== 0) return
    autoRef.current = window.setTimeout(() => setStep(1), 2300)
    return () => {
      if (autoRef.current) window.clearTimeout(autoRef.current)
    }
  }, [step])

  function next(to: number) {
    if (autoRef.current) window.clearTimeout(autoRef.current)
    haptic('selection')
    setStep(to)
  }

  async function start(withBudget: boolean) {
    const minor = (parseInt(budget, 10) || 0) * 100
    if (withBudget && minor > 0) await db.budgets.put({ id: 'overall', amountMinor: minor })
    await saveSettings({ initialized: true, currency })
    haptic('success')
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
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 28
      }}
    >
      <div style={{ width: '100%', maxWidth: 400, display: 'flex', flexDirection: 'column', gap: 22, flex: 1, justifyContent: 'center' }}>
        {step === 0 && (
          <div key="s0" className="onb-step" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, textAlign: 'center' }}>
            <span className="onb-logo" style={{ color: 'var(--on-accent)' }}>
              <TailyMark size={52} />
            </span>
            <div className="onb-rise" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span className="display" style={{ fontSize: 40, letterSpacing: '-0.02em' }}>Taily</span>
              <span className="muted" style={{ fontSize: 16 }}>Three seconds to logged.</span>
            </div>
            <span className="caption onb-late" style={{ fontSize: 12.5 }}>
              No account · no cloud · everything stays on this phone
            </span>
          </div>
        )}

        {step === 1 && (
          <div key="s1" className="onb-step" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <h1 className="display" style={{ margin: 0, fontSize: 30, lineHeight: 1.15, letterSpacing: '-0.02em' }}>
                What do you<br />spend in?
              </h1>
              <span className="muted" style={{ fontSize: 14.5 }}>You can switch later — with live conversion.</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {CURRENCIES.map((c) => (
                <button
                  key={c.code}
                  className="action-row"
                  style={currency === c.code ? { boxShadow: 'var(--inset-sm)' } : undefined}
                  onClick={() => {
                    haptic('selection')
                    setCurrency(c.code)
                  }}
                >
                  <span
                    className="txn-icon"
                    style={{
                      background: currency === c.code ? 'var(--accent)' : 'var(--sunken)',
                      color: currency === c.code ? 'var(--on-accent)' : 'var(--muted)',
                      width: 36,
                      height: 36,
                      fontWeight: 800,
                      fontSize: 14.5
                    }}
                  >
                    {c.symbol}
                  </span>
                  <span style={{ flex: 1, fontWeight: 600, fontSize: 14.5 }}>{c.name}</span>
                  {currency === c.code && (
                    <span style={{ color: 'var(--pos)' }}>
                      <Icon name="check" size={16} strokeWidth={2.4} />
                    </span>
                  )}
                </button>
              ))}
            </div>
            <button className="btn" style={{ padding: '14px 18px' }} onClick={() => next(2)}>
              Continue
            </button>
          </div>
        )}

        {step === 2 && (
          <div key="s2" className="onb-step" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <h1 className="display" style={{ margin: 0, fontSize: 30, lineHeight: 1.15, letterSpacing: '-0.02em' }}>
                A monthly<br />budget?
              </h1>
              <span className="muted" style={{ fontSize: 14.5 }}>
                One number unlocks safe-to-spend — how much you can still spend today without wrecking the month.
              </span>
            </div>
            <input
              className="field mono"
              type="number"
              inputMode="numeric"
              placeholder={currency === 'INR' ? 'e.g. 45000' : 'e.g. 2000'}
              value={budget}
              min={0}
              onChange={(e) => setBudget(e.target.value)}
              style={{ fontSize: 20, fontWeight: 600, padding: '15px 16px' }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button className="btn" style={{ padding: '14px 18px' }} onClick={() => void start(true)}>
                Start tracking
              </button>
              <button className="btn ghost" onClick={() => void start(false)}>
                Skip for now
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', paddingBottom: 18 }}>
        {step > 0 && (
          <button className="icon-btn" style={{ marginRight: 6 }} onClick={() => next(step - 1)} aria-label="Back">
            <Icon name="chevronLeft" size={15} />
          </button>
        )}
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: i === step ? 22 : 7,
              height: 7,
              borderRadius: 4,
              background: i === step ? 'var(--accent)' : 'var(--bar-idle)',
              transition: 'width 300ms var(--ease-soft), background 300ms ease'
            }}
          />
        ))}
      </div>
    </div>
  )
}
