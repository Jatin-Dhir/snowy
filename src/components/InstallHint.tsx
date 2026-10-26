import { useState } from 'react'
import { isIosBrowserTab } from '../lib/platform'
import { Icon } from './Icon'

const KEY = 'taily.ios.install.dismissed'

/** iPhone only, and only until it's installed or dismissed: Safari has no install prompt of its own. */
export function InstallHint() {
  const [hidden, setHidden] = useState(() => localStorage.getItem(KEY) === '1')
  if (hidden || !isIosBrowserTab()) return null

  return (
    <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 14 }}>
      <span className="txn-icon" style={{ background: 'var(--pos-soft)', color: 'var(--accent)', width: 36, height: 36 }}>
        <Icon name="share" size={18} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontWeight: 700, fontSize: 13.5 }}>Install Taily on your iPhone</span>
        <span className="caption" style={{ fontSize: 12 }}>
          Tap Share, then Add to Home Screen. It opens full-screen, and iPhone won't clear its data after a week unused.
        </span>
      </span>
      <button
        className="faint"
        aria-label="Dismiss"
        onClick={() => {
          localStorage.setItem(KEY, '1')
          setHidden(true)
        }}
      >
        <Icon name="x" size={14} strokeWidth={2} />
      </button>
    </div>
  )
}
