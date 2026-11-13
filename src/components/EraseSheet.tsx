import { useState } from 'react'
import { eraseEverything } from '../lib/erase'
import { loadProfiles } from '../lib/profiles'
import { Icon } from './Icon'
import { Sheet } from './Sheet'

/**
 * Settings ▸ Erase everything. It can't be undone, so the sheet says exactly what goes, offers a CSV copy first,
 * and points to a new profile for someone who wants a clean start without losing what they have.
 */
export function EraseSheet({
  open,
  canStartProfile,
  onClose,
  onExport,
  onStartProfile
}: {
  open: boolean
  /** profiles are unlocked, so a fresh profile is a real alternative */
  canStartProfile: boolean
  onClose: () => void
  onExport: () => void
  onStartProfile: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const profiles = open ? loadProfiles().list.length : 1

  async function erase() {
    setBusy(true)
    setFailed(false)
    try {
      await eraseEverything()
      // the whole app starts again against empty storage, at the welcome screen
      window.location.reload()
    } catch {
      setBusy(false)
      setFailed(true)
    }
  }

  return (
    <Sheet open={open} onClose={() => !busy && onClose()} label="Erase everything" style={{ gap: 14 }}>
      <div className="row-between">
        <span className="label" style={{ letterSpacing: '0.14em' }}>Erase everything</span>
        <button className="icon-btn" onClick={onClose} disabled={busy} aria-label="Close">
          <Icon name="x" size={14} strokeWidth={2.2} />
        </button>
      </div>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
        This deletes every expense, budget, goal, account, loan and trip on this phone
        {profiles > 1 ? `, in all ${profiles} profiles` : ''}, along with your settings and app lock. Taily then
        starts again from the welcome screen.
      </p>
      <p className="caption" style={{ margin: 0, fontSize: 12.5 }}>
        It can't be undone. Taily Pro stays unlocked.
      </p>
      {failed && (
        <p role="alert" style={{ margin: 0, fontSize: 12.5, color: 'var(--red)' }}>
          Taily couldn't erase everything. Close the app fully, open it again and try once more.
        </p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 4 }}>
        <button className="btn ghost" onClick={onExport} disabled={busy}>
          <Icon name="download" size={16} /> Save a CSV copy first
        </button>
        <button className="btn danger" onClick={() => void erase()} disabled={busy}>
          <Icon name="trash" size={16} /> {busy ? 'Erasing…' : 'Erase everything'}
        </button>
      </div>
      {canStartProfile && (
        <p className="caption" style={{ margin: 0, fontSize: 12.5, textAlign: 'center' }}>
          Want a clean start but keep all this?{' '}
          <button className="link-btn" onClick={onStartProfile} disabled={busy}>
            Start a new profile
          </button>
        </p>
      )}
    </Sheet>
  )
}
