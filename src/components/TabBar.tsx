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
  onAdd
}: {
  tab: Tab
  onTab: (t: Tab) => void
  onAdd: () => void
}) {
  const [burst, setBurst] = useState(false)
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([])
  const [ind, setInd] = useState<{ left: number; width: number } | null>(null)
  const burstTimer = useRef<number | null>(null)
  const fabRef = useRef<HTMLButtonElement | null>(null)
  const dockRef = useRef<HTMLDivElement | null>(null)
  const btnRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({})

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

  function splash() {
    const rect = fabRef.current?.getBoundingClientRect()
    if (!rect) return
    const id = Date.now() + Math.random()
    setRipples((r) => [...r, { id, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }])
    window.setTimeout(() => setRipples((r) => r.filter((p) => p.id !== id)), 680)
  }

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
          ref={fabRef}
          className={`fab${burst ? ' burst' : ''}`}
          onClick={() => {
            haptic('medium')
            if (burstTimer.current) window.clearTimeout(burstTimer.current)
            setBurst(true)
            splash()
            burstTimer.current = window.setTimeout(() => setBurst(false), 440)
            onAdd()
          }}
          aria-label="Add expense"
        >
          <Icon name="plus" size={24} strokeWidth={2.2} />
        </button>
        {TABS.slice(2).map(item)}
        {ripples.map((r) => (
          <span key={r.id} className="fab-ripple" style={{ left: r.x, top: r.y }} />
        ))}
      </div>
    </nav>
  )
}
