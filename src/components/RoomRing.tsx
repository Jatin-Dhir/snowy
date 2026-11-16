import { useEffect, useState } from 'react'

/**
 * Today's room to spend, as a ring: the arc is what's left of today's allowance. Taily's cat sits inside it,
 * and its face says how the day is going. The numbers beside it say the same thing in words, so the ring is
 * decoration to a screen reader. A special theme gives the cat its ears and blush (global.css, [data-special]).
 */
export function RoomRing({ left, over, size = 92 }: { left: number; over: boolean; size?: number }) {
  // the arc sweeps up from empty when Home first shows it
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(over ? 0 : Math.max(0, Math.min(1, left))))
    return () => cancelAnimationFrame(id)
  }, [left, over])

  // happy with room to spare, a little uneasy when it runs low, sad (never cross) once the day is over
  const mood = over ? 'sad' : left < 0.35 ? 'careful' : 'happy'
  const r = 33
  const c = 2 * Math.PI * r
  return (
    <svg className={`room-ring mood-${mood}${over ? ' is-over' : ''}`} viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
      {/* the ears never move with the mood: only the face does, the way cat emoji are drawn */}
      <g className="ring-ears">
        <path className="ear" d="M21 36 L22 9 L41 22 Z" />
        <path className="ear" d="M79 36 L78 9 L59 22 Z" />
        <path className="ear-in" d="M26 29 L26.5 16 L35 22.5 Z" />
        <path className="ear-in" d="M74 29 L73.5 16 L65 22.5 Z" />
      </g>
      <circle className="ring-track" cx="50" cy="56" r={r} />
      <circle
        className="ring-arc"
        cx="50"
        cy="56"
        r={r}
        strokeDasharray={c}
        strokeDashoffset={c * (1 - shown)}
        transform="rotate(-90 50 56)"
      />
      <g className="ring-face">
        <ellipse className="blush" cx="33.5" cy="63" rx="4.2" ry="2.6" />
        <ellipse className="blush" cx="66.5" cy="63" rx="4.2" ry="2.6" />
        {mood === 'happy' ? (
          <>
            <path className="stroke" d="M37 54 Q41 49 45 54" />
            <path className="stroke" d="M55 54 Q59 49 63 54" />
            <path className="stroke" d="M44 61.5 Q47 65 50 61.5 Q53 65 56 61.5" />
          </>
        ) : mood === 'careful' ? (
          <>
            <circle className="eye" cx="41" cy="53" r="2.7" />
            <circle className="eye" cx="59" cy="53" r="2.7" />
            {/* a small wobble, not a flat line: uneasy, not stern */}
            <path className="stroke" d="M45 63.4 q2.25 -2.1 4.5 0 t4.5 0" />
          </>
        ) : (
          <>
            {/* the happy face turned over, so it's the same cat: its ^ eyes close downward and its ω mouth
                becomes a pout. No brows: slanted brows are what reads as cross */}
            <path className="stroke" d="M37 53.2 Q41 57.4 45 53.2" />
            <path className="stroke" d="M55 53.2 Q59 57.4 63 53.2" />
            <path className="stroke" d="M44.5 65.6 Q47.25 62 50 65.2 Q52.75 62 55.5 65.6" />
          </>
        )}
      </g>
    </svg>
  )
}
