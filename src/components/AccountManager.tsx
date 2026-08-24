import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { addAccount, renameAccount, setAccountArchived, setAccountBalance } from '../db/accounts'
import { allLiveTxns } from '../db/repo'
import { balanceByAccount } from '../db/stats'
import { formatMinor } from '../lib/money'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import { haptic, useUi } from '../state/ui'

/** Name every place money lives — banks, wallets, cash, other people's cards. */
export function AccountManager({ open, currency, onClose }: { open: boolean; currency: string; onClose: () => void }) {
  const { showToast } = useUi()
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editingBalance, setEditingBalance] = useState<string | null>(null)
  const [editBalanceValue, setEditBalanceValue] = useState('')

  // scrim taps bypass the header X, so clear any half-finished edit whenever
  // the sheet is dismissed — reopening should never land mid-edit
  useEffect(() => {
    if (open) return
    setNewName('')
    setEditing(null)
    setEditingBalance(null)
  }, [open])

  const accounts = useLiveQuery(() => db.accounts.orderBy('sort').toArray(), []) ?? []
  const allTxns = useLiveQuery(() => allLiveTxns(), []) ?? []
  const balances = balanceByAccount(allTxns, accounts)
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

  function startEditBalance(id: string, currentMinor: number) {
    setEditingBalance(id)
    setEditBalanceValue((currentMinor / 100).toFixed(2).replace(/\.00$/, ''))
  }

  async function saveBalance(id: string, currentMinor: number) {
    const target = Math.round(parseFloat(editBalanceValue || '0') * 100)
    if (isFinite(target)) {
      await setAccountBalance(id, target, currentMinor)
      haptic('success')
    }
    setEditingBalance(null)
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
        Wherever money moves from — banks, wallets, cash, cards. Add as many as you live with. Tap a
        balance to set it directly.
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

      {active.map((a) => {
        const bal = balances.get(a.id) ?? 0
        return (
          <div key={a.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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

            {editingBalance === a.id ? (
              <div style={{ display: 'flex', gap: 8, paddingLeft: 44 }}>
                <input
                  className="field mono"
                  type="number"
                  inputMode="decimal"
                  autoFocus
                  value={editBalanceValue}
                  onChange={(e) => setEditBalanceValue(e.target.value)}
                  style={{ flex: 1, padding: '8px 12px' }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void saveBalance(a.id, bal)
                  }}
                />
                <button
                  className="icon-btn"
                  style={{ color: 'var(--pos)' }}
                  onClick={() => void saveBalance(a.id, bal)}
                  aria-label={`Save balance for ${a.name}`}
                >
                  <Icon name="check" size={15} strokeWidth={2.4} />
                </button>
              </div>
            ) : (
              <button
                style={{ alignSelf: 'flex-end', paddingRight: 2 }}
                onClick={() => startEditBalance(a.id, bal)}
                aria-label={`Set balance for ${a.name}`}
              >
                <span className="mono" style={{ fontWeight: 700, fontSize: 14, color: bal < 0 ? 'var(--red)' : 'var(--muted)' }}>
                  {formatMinor(bal, currency)}
                </span>
              </button>
            )}
          </div>
        )
      })}

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
