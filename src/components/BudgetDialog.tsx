import { useState, type ReactNode } from 'react'
import { db } from '../db/db'
import { useUi } from '../state/ui'
import { Icon } from './Icon'
import { Sheet } from './Sheet'

/** One budget's amount a month: set it, change it, or take it away. */
export function BudgetDialog({
  title,
  initialAmount,
  onSave,
  onDelete,
  onClose
}: {
  title: string
  initialAmount: number | null
  onSave: (minor: number) => void
  onDelete?: () => void
  onClose: () => void
}) {
  const shown = initialAmount ? String(Math.round(initialAmount / 100)) : ''
  const [value, setValue] = useState(shown)
  // the field holds whole units: left as it opened, it stands for the exact amount (paise from a currency switch)
  const minor = initialAmount && value === shown ? initialAmount : (parseInt(value, 10) || 0) * 100
  return (
    <Sheet open onClose={onClose} label={title} style={{ gap: 14 }}>
      <div className="row-between">
        <span className="label" style={{ letterSpacing: '0.14em' }}>{title}</span>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <Icon name="x" size={14} strokeWidth={2.2} />
        </button>
      </div>
      <input aria-label="Amount per month"
        className="field mono"
        type="number"
        inputMode="numeric"
        placeholder="Amount per month"
        value={value}
        autoFocus
        min={0}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && minor > 0) onSave(minor)
        }}
        style={{ fontSize: 22, fontWeight: 600, padding: '14px 16px' }}
      />
      <button className="btn" disabled={minor <= 0} onClick={() => onSave(minor)}>
        Save budget
      </button>
      {onDelete && (
        <button className="btn danger" onClick={onDelete}>
          Remove this budget
        </button>
      )}
    </Sheet>
  )
}

/** A budget to set or change: 'overall' for the month, else a tag's id. */
export interface BudgetEdit {
  id: string
  title: string
  /** what it is now, null for none yet */
  amount: number | null
}

/**
 * The budget dialog, wherever a budget can be set or changed: Budgets, Home, a month day by day, a tag's entries.
 * Saving and removing work the same in every one of them, with the same words and the same undo. Render `dialog`
 * where a sheet opened over the others belongs: a sheet that opens later lies on top.
 */
export function useBudgetEditor(): { edit: (b: BudgetEdit) => void; dialog: ReactNode } {
  const { showToast } = useUi()
  const [editing, setEditing] = useState<BudgetEdit | null>(null)

  async function save(id: string, minor: number) {
    // the same amount saved again keeps its original from before a currency switch
    const was = await db.budgets.get(id)
    if (was?.amountMinor !== minor) await db.budgets.put({ id, amountMinor: minor })
    setEditing(null)
    showToast('Budget saved')
  }

  async function remove(id: string) {
    const was = await db.budgets.get(id)
    await db.budgets.delete(id)
    setEditing(null)
    showToast('Budget removed', () => {
      if (was) void db.budgets.put(was)
    })
  }

  const dialog = editing && (
    <BudgetDialog
      key={editing.id}
      title={editing.title}
      initialAmount={editing.amount}
      onSave={(minor) => void save(editing.id, minor)}
      onDelete={editing.amount !== null ? () => void remove(editing.id) : undefined}
      onClose={() => setEditing(null)}
    />
  )
  return { edit: setEditing, dialog }
}
