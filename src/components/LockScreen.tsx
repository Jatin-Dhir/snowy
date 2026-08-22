import { useState } from 'react'
import { PinPad } from './PinPad'
import { hashPin } from '../lib/pin'
import { haptic } from '../state/ui'

export function LockScreen({ pinHash, onUnlock }: { pinHash: string; onUnlock: () => void }) {
  const [shakeKey, setShakeKey] = useState(0)

  async function tryPin(pin: string) {
    if ((await hashPin(pin)) === pinHash) {
      haptic('success')
      onUnlock()
    } else {
      haptic('heavy')
      setShakeKey((k) => k + 1)
    }
  }

  return (
    <div
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
          <svg width="42" height="40" viewBox="0 0 44 42" aria-hidden="true" style={{ color: 'var(--accent)' }}>
            <ellipse cx="9" cy="18.5" rx="3.3" ry="4.3" transform="rotate(-24 9 18.5)" fill="currentColor" />
            <ellipse cx="17" cy="13" rx="3.4" ry="4.4" transform="rotate(-8 17 13)" fill="currentColor" />
            <ellipse cx="27" cy="13" rx="3.4" ry="4.4" transform="rotate(8 27 13)" fill="currentColor" />
            <ellipse cx="35" cy="18.5" rx="3.3" ry="4.3" transform="rotate(24 35 18.5)" fill="currentColor" />
            <circle cx="18.7" cy="25.5" r="5.2" fill="currentColor" />
            <circle cx="25.3" cy="25.5" r="5.2" fill="currentColor" />
            <ellipse cx="22" cy="26.5" rx="8.4" ry="5" fill="currentColor" />
            <path d="M14 27 h16 L22 35.6 Z" fill="currentColor" />
          </svg>
          <span className="display" style={{ fontWeight: 800, fontSize: 20 }}>Taily</span>
        </div>
        <PinPad label="Enter your PIN" shakeKey={shakeKey} onComplete={(p) => void tryPin(p)} />
      </div>
    </div>
  )
}
