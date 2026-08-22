import { useRef } from 'react'
import { Icon } from './Icon'

/** The soft numpad: fires on touch-down, backspace repeats while held. */
export function NumPad({
  onDigit,
  onDot,
  onBackspace
}: {
  onDigit: (d: string) => void
  onDot: () => void
  onBackspace: () => void
}) {
  const holdTimer = useRef<number | null>(null)
  const holdInterval = useRef<number | null>(null)

  function stopHold() {
    if (holdTimer.current) window.clearTimeout(holdTimer.current)
    if (holdInterval.current) window.clearInterval(holdInterval.current)
    holdTimer.current = null
    holdInterval.current = null
  }

  return (
    <div className="numpad">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
        <button
          key={d}
          className="key"
          onPointerDown={(e) => {
            e.preventDefault()
            onDigit(d)
          }}
        >
          {d}
        </button>
      ))}
      <button
        className="key"
        onPointerDown={(e) => {
          e.preventDefault()
          onDot()
        }}
      >
        .
      </button>
      <button
        className="key"
        onPointerDown={(e) => {
          e.preventDefault()
          onDigit('0')
        }}
      >
        0
      </button>
      <button
        className="key"
        aria-label="Backspace"
        onPointerDown={(e) => {
          e.preventDefault()
          onBackspace()
          holdTimer.current = window.setTimeout(() => {
            holdInterval.current = window.setInterval(onBackspace, 110)
          }, 420)
        }}
        onPointerUp={stopHold}
        onPointerLeave={stopHold}
        onPointerCancel={stopHold}
      >
        <Icon name="backspace" size={22} />
      </button>
    </div>
  )
}
