import { useEffect, useRef, type ButtonHTMLAttributes } from 'react'
import { Icon } from './Icon'

/**
 * One soft key. A pointer fires it on the way down, and the click that press ends in isn't a
 * second one. Any other click is Enter, Space or a screen reader, with no way down to fire on.
 */
function Key({ fire, ...button }: ButtonHTMLAttributes<HTMLButtonElement> & { fire: () => void }) {
  const firedOnDown = useRef(false)
  return (
    <button
      className="key"
      {...button}
      onPointerDown={(e) => {
        e.preventDefault()
        firedOnDown.current = true
        fire()
        button.onPointerDown?.(e)
      }}
      onKeyDown={(e) => {
        firedOnDown.current = false
        // held down it's one press, as under a finger: a PIN can't fill itself in
        if (e.repeat && e.key === 'Enter') e.preventDefault()
      }}
      onClick={() => {
        if (!firedOnDown.current) fire()
        firedOnDown.current = false
      }}
    />
  )
}

/**
 * The soft numpad: fires on touch-down, backspace repeats while held. The keyboard's own number
 * keys type on it too, unless a field has them or something on top holds this pad inert.
 */
export function NumPad({
  onDigit,
  onDot,
  onBackspace
}: {
  onDigit: (d: string) => void
  /** Without it (a PIN) the key's corner of the grid is left empty. */
  onDot?: () => void
  onBackspace: () => void
}) {
  const pad = useRef<HTMLDivElement>(null)
  const holdTimer = useRef<number | null>(null)
  const holdInterval = useRef<number | null>(null)

  function stopHold() {
    if (holdTimer.current) window.clearTimeout(holdTimer.current)
    if (holdInterval.current) window.clearInterval(holdInterval.current)
    holdTimer.current = null
    holdInterval.current = null
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT') return
      if (e.ctrlKey || e.metaKey || e.altKey || pad.current?.closest('[inert]')) return
      if (e.key === 'Backspace') onBackspace()
      // only Backspace repeats, as on the soft keys: a held digit can't fill in a PIN
      else if (e.repeat) return
      else if (e.key >= '0' && e.key <= '9') onDigit(e.key)
      else if (e.key === '.') onDot?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div ref={pad} className="numpad">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
        <Key key={d} fire={() => onDigit(d)}>
          {d}
        </Key>
      ))}
      {onDot ? (
        <Key aria-label="Decimal point" fire={onDot}>
          .
        </Key>
      ) : (
        // a PIN has no decimal point: its corner stays empty, as on a phone's own PIN pad, so 0 keeps its place
        <span aria-hidden="true" />
      )}
      <Key fire={() => onDigit('0')}>0</Key>
      <Key
        aria-label="Backspace"
        fire={onBackspace}
        onPointerDown={() => {
          holdTimer.current = window.setTimeout(() => {
            holdInterval.current = window.setInterval(onBackspace, 110)
          }, 420)
        }}
        onPointerUp={stopHold}
        onPointerLeave={stopHold}
        onPointerCancel={stopHold}
      >
        <Icon name="backspace" size={22} />
      </Key>
    </div>
  )
}
