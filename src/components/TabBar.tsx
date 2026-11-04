import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { haptic, vibrate } from '../state/ui'

const HINT_KEY = 'taily.voicehint.seen'

/** Held this long, the + listens instead of opening the add sheet. */
const HOLD_MS = 300
/** Moving this far before the hold lands means the finger is doing something else. */
const DRIFT_PX = 24
/** Sliding this far off the button while listening arms cancel. */
const AWAY_PX = 72

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
  onVoiceStart,
  onVoiceAway,
  onVoiceEnd
}: {
  tab: Tab
  onTab: (t: Tab) => void
  onAdd: () => void
  /** the hold landed: start listening while the finger stays down */
  onVoiceStart: () => void
  /** the finger slid off the button (letting go now cancels), or came back */
  onVoiceAway: (away: boolean) => void
  /** the finger lifted; `away` if it was off the button */
  onVoiceEnd: (away: boolean) => void
}) {
  const [ind, setInd] = useState<{ left: number; width: number } | null>(null)
  const [arming, setArming] = useState(false)
  const dockRef = useRef<HTMLDivElement | null>(null)
  const btnRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({})
  const holdTimer = useRef<number | null>(null)
  const press = useRef<{ id: number; x: number; y: number; voice: boolean; away: boolean } | null>(null)
  // when a pointer last finished a press, so the click the browser sends after it is ignored
  const pointerDoneAt = useRef(0)
  // and where the finger lifted, for that click: see the swallow below
  const liftAt = useRef<{ x: number; y: number } | null>(null)

  // The browser sends its click for a press after the finger lifts, and the press has opened the add sheet
  // (or the voice screen) by then. So the click landed on what was now under the finger: the sheet's backdrop,
  // which shut the sheet it had just opened, or the voice mic, which ended listening. That click is the +'s,
  // and so is a double tap's second tap, which typed a digit on the keypad sliding up under it. For a moment,
  // presses and clicks where the finger lifted are swallowed before anything sees them. A tap anywhere else,
  // the + itself once nothing covers it, and a keyboard's press of the + go through as always.
  useEffect(() => {
    function swallow(e: MouseEvent) {
      const at = liftAt.current
      if (!at || performance.now() - pointerDoneAt.current > 800 || Math.hypot(e.clientX - at.x, e.clientY - at.y) > DRIFT_PX) return
      if (e.target instanceof Element && e.target.closest('[data-voice-anchor]')) return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('pointerdown', swallow, true)
    window.addEventListener('click', swallow, true)
    return () => {
      window.removeEventListener('pointerdown', swallow, true)
      window.removeEventListener('click', swallow, true)
    }
  }, [])

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

  function clearHold() {
    if (holdTimer.current) window.clearTimeout(holdTimer.current)
    holdTimer.current = null
    setArming(false)
  }

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return
    // a press whose release never arrived must not leave the + stuck
    if (press.current) {
      clearHold()
      press.current = null
    }
    // the hint bubble lives inside the button: tapping it only dismisses it
    if ((e.target as HTMLElement).closest('.voice-hint')) {
      dismissHint()
      return
    }
    // stop Android's long-press callout and text selection from taking the gesture
    e.preventDefault()
    dismissHint()
    // the finger stays this button's even as the voice screen opens on top of it
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* capture unavailable: pointerleave can't fire anyway with touch-action none */
    }
    press.current = { id: e.pointerId, x: e.clientX, y: e.clientY, voice: false, away: false }
    setArming(true)
    holdTimer.current = window.setTimeout(() => {
      holdTimer.current = null
      setArming(false)
      const p = press.current
      if (!p) return
      p.voice = true
      vibrate('heavy')
      onVoiceStart()
    }, HOLD_MS)
  }

  function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const p = press.current
    if (!p || e.pointerId !== p.id) return
    const distance = Math.hypot(e.clientX - p.x, e.clientY - p.y)
    if (!p.voice) {
      if (distance > DRIFT_PX) {
        clearHold()
        press.current = null
      }
      return
    }
    const away = distance > AWAY_PX
    if (away !== p.away) {
      p.away = away
      vibrate('selection')
      onVoiceAway(away)
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLButtonElement>) {
    const p = press.current
    if (!p || e.pointerId !== p.id) return
    press.current = null
    pointerDoneAt.current = performance.now()
    liftAt.current = { x: e.clientX, y: e.clientY }
    clearHold()
    if (p.voice) {
      onVoiceEnd(p.away)
    } else {
      haptic('medium')
      onAdd()
    }
  }

  function onPointerCancel(e: React.PointerEvent<HTMLButtonElement>) {
    const p = press.current
    if (!p || e.pointerId !== p.id) return
    press.current = null
    pointerDoneAt.current = performance.now()
    clearHold()
    // the system took the touch (a permission prompt, the notification shade): keep listening hands-free
    if (p.voice) onVoiceEnd(false)
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
          className={`fab${arming ? ' arming' : ''}`}
          data-voice-anchor=""
          // a keyboard or a screen reader presses without a pointer; a finger's press was handled on pointerup
          onClick={() => {
            if (performance.now() - pointerDoneAt.current < 800) return
            haptic('medium')
            onAdd()
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
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
