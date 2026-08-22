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
          <svg width="46" height="42" viewBox="0 0 44 40" aria-hidden="true" style={{ color: 'var(--accent)' }}>
            <path d="M11 22 L13 5 L22 16 L31 5 L33 22 A 11.4 10.4 0 1 1 11 22 Z" fill="currentColor" />
            <path d="M15.2 25.6 q 2.4 -3.1 4.8 0" stroke="var(--bg)" strokeWidth="1.7" fill="none" strokeLinecap="round" />
            <path d="M24 25.6 q 2.4 -3.1 4.8 0" stroke="var(--bg)" strokeWidth="1.7" fill="none" strokeLinecap="round" />
            <circle cx="22" cy="29.4" r="1.5" fill="var(--bg)" />
          </svg>
          <span className="display" style={{ fontWeight: 800, fontSize: 20 }}>Snowy</span>
        </div>
        <PinPad label="Enter your PIN" shakeKey={shakeKey} onComplete={(p) => void tryPin(p)} />
      </div>
    </div>
  )
}
