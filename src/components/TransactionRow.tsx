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
  selected = false,
  selecting = false
}: {
  txn: Txn
  categories: Category[]
  onClick?: () => void
  onLongPress?: () => void
  selected?: boolean
  /** while picking several rows, each row says whether it's picked */
  selecting?: boolean
}) {
  const cat = categoryOf(txn, categories)
  const color = cat?.color ?? '#7A8794'
  const isIn = (txn.kind ?? 'out') === 'in'
  const title = txn.note.trim() || cat?.name || (isIn ? 'Received' : 'Untagged')
  const catLabel = cat?.name ?? (isIn ? 'Money in' : 'Untagged')
  // don't repeat the tag as both the title and the first word of the
  // subtitle — the common case is exactly a tag-only entry with no note.
  // A trip share leads: it's why the amount is less than the bill, and a narrow row cuts the end
  const subParts = [
    ...(txn.tripName ? [`${txn.tripName} share`] : []),
    ...(catLabel === title ? [] : [catLabel]),
    fmtTime(txn.ts)
  ]
  if (txn.source === 'recurring') subParts.push('auto')
  const isFresh = Date.now() - txn.createdAt < 1600

  const pressTimer = useRef<number | null>(null)
  const longFired = useRef(false)

  function pressStart(e: React.PointerEvent) {
    if (!onLongPress) return
    e.preventDefault()
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
      aria-pressed={selecting ? selected : undefined}
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
        if (!onLongPress) return
        e.preventDefault()
        // the keyboard's context-menu key (or Shift+F10) selects the row, as a long press does.
        // A touch's long press may get here first: either way it runs once
        if (longFired.current) return
        pressCancel() // a phone that sends this before the long-press timer runs it once, here
        longFired.current = true
        onLongPress()
        window.setTimeout(() => (longFired.current = false), 700)
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
        <span className="txn-sub" style={selected ? { color: 'var(--ink)' } : undefined}>{subParts.join(' · ')}</span>
      </span>
      <span className="txn-amount" style={isIn ? { color: 'var(--pos-text)' } : undefined}>
        {isIn ? '+' : ''}
        {formatMinor(txn.amountMinor, txn.currency)}
      </span>
    </button>
  )
}
