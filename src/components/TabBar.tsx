import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { haptic } from '../state/ui'

const HINT_KEY = 'taily.voicehint.seen'

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

  // teach the hold-to-speak gesture once, ever — it's otherwise undiscoverable
  const [showHint, setShowHint] = useState(() => !localStorage.getItem(HINT_KEY))
  const [hintLeaving, setHintLeaving] = useState(false)

  function dismissHint() {
    if (!showHint || hintLeaving) return
    localStorage.setItem(HINT_KEY, '1')
    setHintLeaving(true)
    window.setTimeout(() => setShowHint(false), 220)
  }

  useEffect(() => {
    if (!showHint) return
    const t = window.setTimeout(dismissHint, 4500)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHint])

  function holdStart(e: React.PointerEvent) {
    // stop Android's native long-press text-selection/callout from grabbing
    // this gesture out from under the hold-to-speak timer
    e.preventDefault()
    dismissHint()
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
            dismissHint()
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
          {showHint && (
            <span
              className={`voice-hint${hintLeaving ? ' leaving' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                dismissHint()
              }}
            >
              <Icon name="mic" size={12} strokeWidth={2.4} />
              Hold to speak
            </span>
          )}
          <Icon name="plus" size={24} strokeWidth={2.2} />
        </button>
        {TABS.slice(2).map(item)}
      </div>
    </nav>
  )
}
