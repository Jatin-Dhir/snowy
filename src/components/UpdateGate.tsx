import { useState } from 'react'
import { checkForUpdate, type UpdateInfo } from '../lib/updater'
import { TailyMark } from '../screens/Welcome'

/**
 * A newer build exists — block entry until it's installed. No skip: the
 * update itself is what's compulsory here. Fails open by design — this only
 * ever renders when a check has positively confirmed a newer version, never
 * on a network error or an unreachable release feed.
 */
export function UpdateGate({ info, onRecheck }: { info: UpdateInfo; onRecheck: (info: UpdateInfo | null) => void }) {
  const [checking, setChecking] = useState(false)

  async function recheck() {
    setChecking(true)
    const result = await checkForUpdate()
    setChecking(false)
    onRecheck(result.status === 'update' ? result.info : null)
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 95,
        background: 'var(--bg)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 28
      }}
    >
      <div style={{ width: '100%', maxWidth: 400, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
        <span
          style={{
            width: 64,
            height: 64,
            borderRadius: 20,
            background: 'var(--accent)',
            color: 'var(--on-accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: 'var(--raise)'
          }}
        >
          <TailyMark size={34} />
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, textAlign: 'center' }}>
          <h1 className="display" style={{ margin: 0, fontSize: 26, letterSpacing: '-0.02em' }}>
            Update needed
          </h1>
          <span className="muted" style={{ fontSize: 14.5 }}>
            Version {info.version} is out. Taily needs it before it can continue.
          </span>
        </div>

        {info.notes && (
          <div
            className="card"
            style={{
              width: '100%',
              padding: '14px 16px',
              maxHeight: 220,
              overflowY: 'auto',
              textAlign: 'left'
            }}
          >
            <span
              className="caption"
              style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', color: 'var(--muted)' }}
            >
              {info.notes}
            </span>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
          <button className="btn" style={{ padding: '15px 18px' }} onClick={() => window.open(info.url, '_blank')}>
            Update now
          </button>
          <button className="btn ghost" disabled={checking} onClick={() => void recheck()}>
            {checking ? 'Checking…' : "I've updated — check again"}
          </button>
        </div>
      </div>
    </div>
  )
}
