import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// Sheets stack (Add → Tags); the page behind stays frozen while any are up.
const bodyLock = { count: 0 }

/**
 * Bottom sheet: watery slide-up entrance, slide-down exit, and
 * swipe-down-to-dismiss from the grab strip at the top.
 */
export function Sheet({
  open,
  onClose,
  label,
  style,
  children
}: {
  open: boolean
  onClose: () => void
  label: string
  style?: CSSProperties
  children: ReactNode
}) {
  const [phase, setPhase] = useState<'closed' | 'in' | 'out'>(open ? 'in' : 'closed')
  const timer = useRef<number | null>(null)
  const sheetEl = useRef<HTMLDivElement | null>(null)
  const drag = useRef({ startY: 0, dy: 0, active: false })

  useEffect(() => {
    if (open) {
      if (timer.current) window.clearTimeout(timer.current)
      setPhase('in')
    } else {
      setPhase((p) => {
        if (p !== 'in') return p
        timer.current = window.setTimeout(() => setPhase('closed'), 250)
        return 'out'
      })
    }
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [open])

  const visible = phase !== 'closed'
  useEffect(() => {
    if (!visible) return
    bodyLock.count++
    document.body.style.overflow = 'hidden'
    return () => {
      bodyLock.count = Math.max(0, bodyLock.count - 1)
      if (bodyLock.count === 0) document.body.style.overflow = ''
    }
  }, [visible])

  function dragStart(e: React.PointerEvent) {
    drag.current = { startY: e.clientY, dy: 0, active: true }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  function dragMove(e: React.PointerEvent) {
    const s = drag.current
    if (!s.active) return
    s.dy = Math.max(0, e.clientY - s.startY)
    const el = sheetEl.current
    if (el) {
      el.style.transition = 'none'
      el.style.transform = `translateY(${s.dy}px)`
    }
  }

  function dragEnd() {
    const s = drag.current
    if (!s.active) return
    s.active = false
    const el = sheetEl.current
    if (!el) return
    if (s.dy > 100) {
      el.style.transition = 'transform 230ms cubic-bezier(0.32, 0.72, 0, 1)'
      el.style.transform = 'translateY(110%)'
      window.setTimeout(onClose, 190)
    } else if (s.dy > 0) {
      el.style.transition = 'transform 320ms cubic-bezier(0.34, 1.45, 0.64, 1)'
      el.style.transform = 'translateY(0)'
      window.setTimeout(() => {
        if (el) {
          el.style.transition = ''
          el.style.transform = ''
        }
      }, 340)
    }
  }

  if (phase === 'closed') return null
  const out = phase === 'out'
  // portal to <body>: a sheet nested inside another sheet (tags, currency,
  // PIN, loan detail) must not inherit its parent's scroll or transform —
  // fixed positioning inside a transformed scrollable ancestor breaks both
  return createPortal(
    <>
      <div className={`scrim${out ? ' scrim-out' : ''}`} onClick={onClose} />
      <div
        ref={sheetEl}
        className={`sheet${out ? ' sheet-out' : ''}`}
        role="dialog"
        aria-label={label}
        style={style}
      >
        <div
          className="sheet-grab"
          onPointerDown={dragStart}
          onPointerMove={dragMove}
          onPointerUp={dragEnd}
          onPointerCancel={dragEnd}
        >
          <div className="sheet-handle" />
        </div>
        {children}
      </div>
    </>,
    document.body
  )
}
