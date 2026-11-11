import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Capacitor } from '@capacitor/core'
import { PinPad } from './PinPad'
import { TailyMark } from '../screens/Welcome'
import { saveSettings } from '../db/db'
import { clearPinFailures, hashPin, isLegacyHash, recordPinFailure, verifyPin } from '../lib/pin'
import { leaveApp, onBack } from '../lib/backButton'
import { focusFallback } from '../lib/sheetFocus'
import { haptic } from '../state/ui'

/**
 * Covers the app until the PIN is entered. It sits on top of the mounted app
 * instead of replacing it, so unlocking after a re-lock lands you exactly
 * where you were. Everything behind it is inert meanwhile: no focus, no taps,
 * nothing for a screen reader to read out.
 */
export function LockScreen({ pinHash, onUnlock }: { pinHash: string; onUnlock: () => void }) {
  const [shakeKey, setShakeKey] = useState(0)
  const [forgot, setForgot] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // what an open sheet already holds inert stays that way after unlocking
    const behind = [...document.body.children].filter((el) => el !== rootRef.current && !el.hasAttribute('inert'))
    for (const el of behind) el.setAttribute('inert', '')
    // whatever had focus just lost it, and this is the one place left for it
    rootRef.current?.focus({ preventScroll: true })
    return () => {
      for (const el of behind) el.removeAttribute('inert')
      focusFallback()
    }
  }, [])

  // Back can't reach what's behind the lock (closing a sheet there would lose what was
  // being entered): it leaves Taily, and the lock stays
  useEffect(() => onBack(() => void leaveApp(), true), [])

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
      tabIndex={-1}
      style={{
        outline: 'none',
        position: 'fixed',
        inset: 0,
        zIndex: 90,
        background: 'var(--bg)',
        display: 'flex',
        overflowY: 'auto',
        padding: 24
      }}
    >
      {/* auto margins centre it, and a short screen scrolls instead of cutting off the top */}
      <div style={{ margin: 'auto', width: '100%', maxWidth: 340, display: 'flex', flexDirection: 'column', gap: 26 }}>
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
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <button
            className="faint"
            style={{ fontWeight: 600, fontSize: 13, padding: '8px 12px' }}
            aria-expanded={forgot}
            onClick={() => setForgot((v) => !v)}
          >
            Forgot your PIN?
          </button>
          {forgot && (
            <span className="caption" style={{ display: 'block', fontSize: 12.5, textAlign: 'center', textWrap: 'pretty' }}>
              {Capacitor.isNativePlatform()
                ? "Taily keeps everything on this phone and can't reset your PIN. To start over, clear Taily's storage in Android Settings › Apps › Taily › Storage. That deletes your entries, so restore your latest encrypted backup afterwards."
                : "Taily keeps everything in this browser and can't reset your PIN. To start over, clear this site's data in your browser settings. That deletes your entries, so restore your latest encrypted backup afterwards."}
            </span>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
