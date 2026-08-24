import { useLayoutEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { haptic } from '../state/ui'

export type Tab = 'home' | 'activity' | 'budgets' | 'insights'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'activity', label: 'Activity', icon: 'list' },
  { id: 'budgets', label: 'Budgets', icon: 'gauge' },
  { id: 'insights', label: 'Insights', icon: 'bars' }
]

export function TabBar({
  tab,
  onTab,
  onAdd,
  onVoice
}: {
  tab: Tab
  onTab: (t: Tab) => void
  onAdd: () => void
  onVoice: () => void
}) {
  const [ind, setInd] = useState<{ left: number; width: number } | null>(null)
  const dockRef = useRef<HTMLDivElement | null>(null)
  const btnRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({})
  const holdTimer = useRef<number | null>(null)
  const holdFired = useRef(false)

  function holdStart(e: React.PointerEvent) {
    // stop Android's native long-press text-selection/callout from grabbing
    // this gesture out from under the hold-to-speak timer
    e.preventDefault()
    holdFired.current = false
    holdTimer.current = window.setTimeout(() => {
      holdFired.current = true
      haptic('heavy')
      onVoice()
    }, 420)
  }

  function holdCancel() {
    if (holdTimer.current) window.clearTimeout(holdTimer.current)
    holdTimer.current = null
  }

  useLayoutEffect(() => {
    function measure() {
      const dock = dockRef.current
      const btn = btnRefs.current[tab]
      if (!dock || !btn) return
      const d = dock.getBoundingClientRect()
      const b = btn.getBoundingClientRect()
      setInd({ left: b.left - d.left, width: b.width })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [tab])

  const item = (t: (typeof TABS)[number]) => (
    <button
      key={t.id}
      ref={(el) => {
        btnRefs.current[t.id] = el
      }}
      className={`tab${tab === t.id ? ' active' : ''}`}
      onClick={() => {
        haptic('selection')
        onTab(t.id)
      }}
      aria-label={t.label}
    >
      <Icon name={t.icon} size={21} />
      <span>{t.label}</span>
    </button>
  )

  return (
    <nav className="tabbar">
      <div className="dock" ref={dockRef}>
        {ind && <span className="dock-ind" style={{ left: ind.left, width: ind.width }} />}
        {TABS.slice(0, 2).map(item)}
        <button
          className="fab"
          onClick={() => {
            if (holdFired.current) {
              holdFired.current = false
              return
            }
            haptic('medium')
            onAdd()
          }}
          onPointerDown={holdStart}
          onPointerUp={holdCancel}
          onPointerLeave={holdCancel}
          onPointerCancel={holdCancel}
          onContextMenu={(e) => e.preventDefault()}
          aria-label="Add expense — hold to speak"
        >
          <Icon name="plus" size={24} strokeWidth={2.2} />
        </button>
        {TABS.slice(2).map(item)}
      </div>
    </nav>
  )
}
