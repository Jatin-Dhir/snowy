import { useRef } from 'react'
import type { Category, Txn } from '../db/db'
import { formatMinor } from '../lib/money'
import { fmtTime } from '../lib/dates'
import { Icon } from './Icon'
import { haptic } from '../state/ui'

export function categoryOf(txn: Txn, categories: Category[]): Category | null {
  return categories.find((c) => c.id === txn.categoryId) ?? null
}

export function TransactionRow({
  txn,
  categories,
  onClick,
  onLongPress,
  selected = false
}: {
  txn: Txn
  categories: Category[]
  onClick?: () => void
  onLongPress?: () => void
  selected?: boolean
}) {
  const cat = categoryOf(txn, categories)
  const color = cat?.color ?? '#7A8794'
  const isIn = (txn.kind ?? 'out') === 'in'
  const title = txn.note.trim() || cat?.name || (isIn ? 'Received' : 'Untagged')
  const subParts = [cat?.name ?? (isIn ? 'Money in' : 'Untagged'), fmtTime(txn.ts)]
  if (txn.source === 'recurring') subParts.push('auto')
  const isFresh = Date.now() - txn.createdAt < 1600

  const pressTimer = useRef<number | null>(null)
  const longFired = useRef(false)

  function pressStart() {
    if (!onLongPress) return
    longFired.current = false
    pressTimer.current = window.setTimeout(() => {
      longFired.current = true
      haptic('heavy')
      onLongPress()
    }, 480)
  }

  function pressCancel() {
    if (pressTimer.current) window.clearTimeout(pressTimer.current)
  }

  return (
    <button
      className={`txn-row${isFresh ? ' txn-new' : ''}`}
      style={selected ? { background: 'var(--pos-soft)', paddingLeft: 8, paddingRight: 8 } : undefined}
      onClick={() => {
        if (longFired.current) {
          longFired.current = false
          return
        }
        onClick?.()
      }}
      onPointerDown={pressStart}
      onPointerUp={pressCancel}
      onPointerLeave={pressCancel}
      onPointerCancel={pressCancel}
      onContextMenu={(e) => {
        if (onLongPress) e.preventDefault()
      }}
    >
      <span
        className="txn-icon"
        style={
          selected
            ? { background: 'var(--accent)', color: 'var(--on-accent)' }
            : { background: `${color}26`, color }
        }
      >
        <Icon name={selected ? 'check' : (cat?.icon ?? (isIn ? 'arrowDown' : 'dots'))} size={20} />
      </span>
      <span className="txn-main">
        <span className="txn-title">{title}</span>
        <span className="txn-sub">{subParts.join(' · ')}</span>
      </span>
      <span className="txn-amount" style={isIn ? { color: 'var(--pos)' } : undefined}>
        {isIn ? '+' : ''}
        {formatMinor(txn.amountMinor, txn.currency)}
      </span>
    </button>
  )
}
