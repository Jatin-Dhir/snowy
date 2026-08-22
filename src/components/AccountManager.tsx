import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { addAccount, renameAccount, setAccountArchived } from '../db/accounts'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import { haptic, useUi } from '../state/ui'

/** Name every place money lives — banks, wallets, cash, other people's cards. */
export function AccountManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { showToast } = useUi()
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const accounts = useLiveQuery(() => db.accounts.orderBy('sort').toArray(), []) ?? []
  const active = accounts.filter((a) => !a.archived)
  const archived = accounts.filter((a) => a.archived)

  async function create() {
    const made = await addAccount(newName)
    if (made) {
      haptic('success')
      setNewName('')
      showToast(`${made.name} added`)
    } else if (newName.trim()) {
      showToast('An account with that name already exists')
    }
  }

  async function saveRename(id: string) {
    await renameAccount(id, editName)
    setEditing(null)
  }

  return (
    <Sheet open={open} onClose={onClose} label="Accounts" style={{ gap: 10 }}>
      <div className="row-between">
        <span className="label" style={{ letterSpacing: '0.14em' }}>Accounts</span>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <Icon name="x" size={14} strokeWidth={2.2} />
        </button>
      </div>
      <span className="caption" style={{ fontSize: 12.5 }}>
        Wherever money moves from — banks, wallets, cash, cards. Add as many as you live with.
      </span>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          className="field"
          placeholder="New account — e.g. HDFC, Paytm, Mom's card"
          value={newName}
          maxLength={30}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void create()
          }}
        />
        <button className="btn" style={{ width: 86 }} disabled={!newName.trim()} onClick={() => void create()}>
          Add
        </button>
      </div>

      {active.map((a) => (
        <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
          <span className="txn-icon" style={{ background: 'var(--pos-soft)', color: 'var(--accent)', width: 34, height: 34 }}>
            <Icon name="wallet" size={16} />
          </span>
          {editing === a.id ? (
            <>
              <input
                className="field"
                value={editName}
                maxLength={30}
                style={{ flex: 1, padding: '8px 12px' }}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveRename(a.id)
                }}
              />
              <button className="icon-btn" style={{ color: 'var(--pos)' }} onClick={() => void saveRename(a.id)} aria-label="Save name">
                <Icon name="check" size={15} strokeWidth={2.4} />
              </button>
            </>
          ) : (
            <>
              <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 14.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {a.name}
              </span>
              <button
                className="icon-btn"
                onClick={() => {
                  setEditing(a.id)
                  setEditName(a.name)
                }}
                aria-label={`Rename ${a.name}`}
              >
                <Icon name="pencil" size={14} />
              </button>
              {active.length > 1 && (
                <button
                  className="icon-btn"
                  style={{ color: 'var(--red)' }}
                  onClick={() => {
                    void setAccountArchived(a.id, true)
                    showToast(`${a.name} hidden — its history stays`)
                  }}
                  aria-label={`Hide ${a.name}`}
                >
                  <Icon name="x" size={14} strokeWidth={2.2} />
                </button>
              )}
            </>
          )}
        </div>
      ))}

      {archived.length > 0 && (
        <>
          <span className="label" style={{ fontSize: 10, paddingTop: 4 }}>Hidden</span>
          {archived.map((a) => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2px 0', opacity: 0.6 }}>
              <span style={{ flex: 1, minWidth: 0, fontWeight: 500, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {a.name}
              </span>
              <button
                className="icon-btn"
                onClick={() => void setAccountArchived(a.id, false)}
                aria-label={`Bring back ${a.name}`}
              >
                <Icon name="refresh" size={14} />
              </button>
            </div>
          ))}
        </>
      )}
    </Sheet>
  )
}
