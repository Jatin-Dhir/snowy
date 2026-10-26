import { useEffect, useState } from 'react'
import { NumPad } from './NumPad'
import { haptic } from '../state/ui'
import { formatWait, pinCooldownMs } from '../lib/pin'

/**
 * Four dots + numpad. Calls onComplete with the 4-digit pin; parent decides what's next.
 * A `guarded` pad checks an existing PIN: while the wrong-guess cooldown runs it
 * counts down and takes no input. The parent records each miss and bumps shakeKey.
 */
export function PinPad({
  label,
  error,
  hint,
  shakeKey,
  guarded = false,
  onComplete
}: {
  label: string
  error?: string
  hint?: string
  shakeKey: number
  guarded?: boolean
  onComplete: (pin: string) => void
}) {
  const [entry, setEntry] = useState('')
  const [waitMs, setWaitMs] = useState(() => (guarded ? pinCooldownMs() : 0))
  const waiting = waitMs > 0

  // re-read after every miss, then tick down once a second while it runs
  useEffect(() => {
    if (guarded) setWaitMs(pinCooldownMs())
  }, [guarded, shakeKey])
  useEffect(() => {
    if (!waiting) return
    const t = window.setTimeout(() => setWaitMs(pinCooldownMs()), Math.min(waitMs, 1000))
    return () => window.clearTimeout(t)
  }, [waiting, waitMs])

  function digit(d: string) {
    if (waiting || entry.length >= 4) return
    haptic('light')
    const next = entry + d
    setEntry(next)
    // outside the state updater: React may run an updater twice, which would submit the PIN twice
    if (next.length === 4) {
      window.setTimeout(() => {
        onComplete(next)
        setEntry('')
      }, 120)
    }
  }

  const message = waiting
    ? `Too many tries — try again in ${formatWait(waitMs)}`
    : error && shakeKey > 0
      ? error
      : (hint ?? '')

  return (
    <div
      key={shakeKey}
      className={`pin-wrap${shakeKey > 0 ? ' pin-shake' : ''}`}
      style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
        <span style={{ fontWeight: 700, fontSize: 15 }}>{label}</span>
        <span
          className="caption"
          aria-live="polite"
          style={{
            fontSize: 12,
            color: message && message !== hint ? 'var(--red)' : undefined,
            minHeight: 16,
            textAlign: 'center'
          }}
        >
          {message}
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
      <div
        aria-disabled={waiting || undefined}
        style={{ opacity: waiting ? 0.4 : 1, pointerEvents: waiting ? 'none' : undefined, transition: 'opacity 200ms ease' }}
      >
        <NumPad
          onDigit={digit}
          onDot={() => undefined}
          onBackspace={() => {
            haptic('light')
            setEntry((e) => e.slice(0, -1))
          }}
        />
      </div>
    </div>
  )
}
