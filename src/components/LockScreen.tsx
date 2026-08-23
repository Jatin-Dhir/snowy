import { useState } from 'react'
import { PinPad } from './PinPad'
import { TailyMark } from '../screens/Welcome'
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
          onComplete={(p) => void tryPin(p)}
        />
      </div>
    </div>
  )
}
