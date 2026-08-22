import { useState } from 'react'
import { NumPad } from './NumPad'
import { haptic } from '../state/ui'

/** Four dots + numpad. Calls onComplete with the 4-digit pin; parent decides what's next. */
export function PinPad({
  label,
  error,
  shakeKey,
  onComplete
}: {
  label: string
  error?: string
  shakeKey: number
  onComplete: (pin: string) => void
}) {
  const [entry, setEntry] = useState('')

  function digit(d: string) {
    haptic('light')
    setEntry((e) => {
      if (e.length >= 4) return e
      const next = e + d
      if (next.length === 4) {
        window.setTimeout(() => {
          onComplete(next)
          setEntry('')
        }, 120)
      }
      return next
    })
  }

  return (
    <div
      key={shakeKey}
      className={`pin-wrap${shakeKey > 0 ? ' pin-shake' : ''}`}
      style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
        <span style={{ fontWeight: 700, fontSize: 15 }}>{label}</span>
        <span className="caption" style={{ fontSize: 12, color: 'var(--red)', minHeight: 16 }}>
          {error && shakeKey > 0 ? error : ''}
        </span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 18 }}>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            style={{
              width: 17,
              height: 17,
              borderRadius: 9,
              background: i < entry.length ? 'var(--accent)' : 'var(--bar-idle)',
              boxShadow: i < entry.length ? 'var(--raise-sm)' : 'var(--inset-sm)',
              transform: i < entry.length ? 'scale(1.08)' : 'scale(1)',
              transition: 'background 150ms ease, transform 150ms var(--ease-spring)'
            }}
          />
        ))}
      </div>
      <NumPad
        onDigit={digit}
        onDot={() => undefined}
        onBackspace={() => {
          haptic('light')
          setEntry((e) => e.slice(0, -1))
        }}
      />
    </div>
  )
}
