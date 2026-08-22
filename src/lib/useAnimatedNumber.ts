import { useEffect, useRef, useState } from 'react'

/**
 * Tweens a minor-unit amount toward `target` with an ease-out curve.
 * Intermediate frames are quantized to whole rupees so no stray paise flash by;
 * the final frame is always exactly `target`. Falls back to an instant jump
 * under prefers-reduced-motion, and a timeout guarantees the exact end value
 * even if animation frames are throttled (hidden tab).
 */
export function useAnimatedNumber(target: number, duration = 560): number {
  const [display, setDisplay] = useState(target)
  const prev = useRef(target)

  useEffect(() => {
    const from = prev.current
    prev.current = target
    if (from === target) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(target)
      return
    }
    let raf = 0
    const t0 = performance.now()
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration)
      const e = 1 - Math.pow(1 - p, 3)
      if (p >= 1) {
        setDisplay(target)
        return
      }
      const v = from + (target - from) * e
      setDisplay(Math.round(v / 100) * 100)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    const safety = window.setTimeout(() => setDisplay(target), duration + 80)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(safety)
    }
  }, [target, duration])

  return display
}
