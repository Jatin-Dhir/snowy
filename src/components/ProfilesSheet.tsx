import { useState } from 'react'
import {
  addProfile,
  deleteProfile,
  loadProfiles,
  renameProfile,
  switchProfile,
  type Profile
} from '../lib/profiles'
import { hasPro } from '../lib/pro'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import { haptic, useUi } from '../state/ui'

/**
 * Profiles are separate record books — two people on one phone, or one person
 * keeping home and shop apart. Each has its own entries, budgets, goals,
 * settings, even its own PIN. Nothing leaks between them.
 */
export function ProfilesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { showToast } = useUi()
  const [state, setState] = useState(() => loadProfiles())
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<Profile | null>(null)

  function refresh() {
    setState(loadProfiles())
  }

  function create() {
    if (!hasPro('profiles')) return
    const made = addProfile(newName)
    if (made) {
      haptic('success')
      setNewName('')
      refresh()
      showToast(`${made.name} created — tap it to switch`)
    } else if (newName.trim()) {
      showToast('A profile with that name already exists')
    }
  }

  function saveRename(id: string) {
    renameProfile(id, editName)
    setEditing(null)
    refresh()
  }

  function pick(p: Profile) {
    if (p.id === state.current) return
    haptic('success')
    switchProfile(p.id) // reloads into the other profile's data
  }

  async function reallyDelete(p: Profile) {
    setConfirmDelete(null)
    await deleteProfile(p.id)
    refresh()
    showToast(`${p.name} deleted for good`)
  }

  return (
    <Sheet open={open} onClose={onClose} label="Profiles" style={{ gap: 10 }}>
      <div className="row-between">
        <span className="label" style={{ letterSpacing: '0.14em' }}>Profiles</span>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <Icon name="x" size={14} strokeWidth={2.2} />
        </button>
      </div>
      <span className="caption" style={{ fontSize: 12.5 }}>
        Separate record books on one phone — for two people, or to keep things apart. Each has its own
        entries, budgets, goals and PIN. Tap one to switch.
      </span>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          className="field"
          placeholder="New profile — e.g. Mom, Shop, Trips"
          value={newName}
          maxLength={24}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') create()
          }}
        />
        <button className="btn" style={{ width: 86 }} disabled={!newName.trim()} onClick={create}>
          Add
        </button>
      </div>

      {state.list.map((p) => {
        const isCurrent = p.id === state.current
        return (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
            <button
              className="txn-icon"
              style={{
                background: isCurrent ? 'var(--accent)' : 'var(--pos-soft)',
                color: isCurrent ? 'var(--on-accent)' : 'var(--accent)',
                width: 34,
                height: 34,
                fontWeight: 800,
                fontSize: 14
              }}
              onClick={() => pick(p)}
              aria-label={isCurrent ? `${p.name} (current)` : `Switch to ${p.name}`}
            >
              {p.name.slice(0, 1).toUpperCase()}
            </button>
            {editing === p.id ? (
              <>
                <input
                  className="field"
                  value={editName}
                  maxLength={24}
                  style={{ flex: 1, padding: '8px 12px' }}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveRename(p.id)
                  }}
                />
                <button className="icon-btn" style={{ color: 'var(--pos)' }} onClick={() => saveRename(p.id)} aria-label="Save name">
                  <Icon name="check" size={15} strokeWidth={2.4} />
                </button>
              </>
            ) : (
              <>
                <button
                  style={{ flex: 1, minWidth: 0, textAlign: 'left', fontWeight: 600, fontSize: 14.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                  onClick={() => pick(p)}
                >
                  {p.name}
                  {isCurrent && (
                    <span className="caption" style={{ fontSize: 11, display: 'block', color: 'var(--muted)' }}>
                      You're here now
                    </span>
                  )}
                </button>
                <button
                  className="icon-btn"
                  onClick={() => {
                    setEditing(p.id)
                    setEditName(p.name)
                  }}
                  aria-label={`Rename ${p.name}`}
                >
                  <Icon name="pencil" size={14} />
                </button>
                {state.list.length > 1 && (
                  <button
                    className="icon-btn"
                    style={{ color: 'var(--red)' }}
                    onClick={() => setConfirmDelete(p)}
                    aria-label={`Delete ${p.name}`}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                )}
              </>
            )}
          </div>
        )
      })}

      {confirmDelete && (
        <Sheet open onClose={() => setConfirmDelete(null)} label="Delete profile" style={{ gap: 12 }}>
          <div className="row-between">
            <span className="label" style={{ letterSpacing: '0.14em' }}>Delete {confirmDelete.name}?</span>
            <button className="icon-btn" onClick={() => setConfirmDelete(null)} aria-label="Close">
              <Icon name="x" size={14} strokeWidth={2.2} />
            </button>
          </div>
          <span className="caption" style={{ fontSize: 13 }}>
            Every entry, budget, goal and setting in {confirmDelete.name} is erased permanently. There is
            no undo. Export its CSV first if you might want the records.
          </span>
          <button className="btn danger" onClick={() => void reallyDelete(confirmDelete)}>
            Delete everything in {confirmDelete.name}
          </button>
          <button className="btn ghost" onClick={() => setConfirmDelete(null)}>
            Keep it
          </button>
        </Sheet>
      )}
    </Sheet>
  )
}
