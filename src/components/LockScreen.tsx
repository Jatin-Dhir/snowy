import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { PinPad } from './PinPad'
import { TailyMark } from '../screens/Welcome'
import { saveSettings } from '../db/db'
import { clearPinFailures, hashPin, isLegacyHash, recordPinFailure, verifyPin } from '../lib/pin'
import { haptic } from '../state/ui'

/**
 * Covers the app until the PIN is entered. It sits on top of the mounted app
 * instead of replacing it, so unlocking after a re-lock lands you exactly
 * where you were. Everything behind it is inert meanwhile: no focus, no taps,
 * nothing for a screen reader to read out.
 */
export function LockScreen({ pinHash, onUnlock }: { pinHash: string; onUnlock: () => void }) {
  const [shakeKey, setShakeKey] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const behind = [...document.body.children].filter((el) => el !== rootRef.current)
    for (const el of behind) el.setAttribute('inert', '')
    return () => {
      for (const el of behind) el.removeAttribute('inert')
    }
  }, [])

  async function tryPin(pin: string) {
    if (await verifyPin(pin, pinHash)) {
      clearPinFailures()
      haptic('success')
      if (isLegacyHash(pinHash)) await saveSettings({ pinHash: await hashPin(pin) })
      onUnlock()
    } else {
      recordPinFailure()
      haptic('heavy')
      setShakeKey((k) => k + 1)
    }
  }

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="Taily is locked"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 90,
        background: 'var(--bg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24
      }}
    >
      <div style={{ width: '100%', maxWidth: 340, display: 'flex', flexDirection: 'column', gap: 26 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              width: 56,
              height: 56,
              borderRadius: 18,
              background: 'var(--accent)',
              color: 'var(--on-accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: 'var(--raise)'
            }}
          >
            <TailyMark size={30} />
          </span>
          <span className="display" style={{ fontWeight: 800, fontSize: 20 }}>Taily</span>
        </div>
        <PinPad
          label="Enter your PIN"
          error="That's not it — try again"
          shakeKey={shakeKey}
          guarded
          onComplete={(p) => void tryPin(p)}
        />
      </div>
    </div>,
    document.body
  )
}
