import { useState } from 'react'
import { NumPad } from './NumPad'
import { haptic } from '../state/ui'

/** Four dots + numpad. Calls onComplete with the 4-digit pin; parent decides what's next. */
export function PinPad({
  label,
  shakeKey,
  onComplete
}: {
  label: string
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
      style={{ display: 'flex', flexDirection: 'column', gap: 18 }}
    >
      <span className="label" style={{ textAlign: 'center', fontSize: 11 }}>{label}</span>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 14 }}>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            style={{
              width: 14,
              height: 14,
              borderRadius: 7,
              background: i < entry.length ? 'var(--accent)' : 'var(--bar-idle)',
              boxShadow: i < entry.length ? 'var(--raise-sm)' : 'var(--inset-sm)',
              transition: 'background 150ms ease'
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
