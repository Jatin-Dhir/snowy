export interface DonutSegment {
  color: string
  value: number
}

/** A clean donut: rounded segments with small gaps and a centred total. */
export function Donut({
  segments,
  centerTop,
  centerBottom,
  size = 190
}: {
  segments: DonutSegment[]
  centerTop: string
  centerBottom: string
  size?: number
}) {
  const total = segments.reduce((a, s) => a + s.value, 0)
  const R = 74
  const C = 2 * Math.PI * R
  // round caps overhang by strokeWidth/2 (12px) on each side of a boundary,
  // so the dash gap must exceed 24px for any daylight to show
  const gap = segments.length > 1 ? 30 : 0
  let offset = -C / 4 // start at 12 o'clock
  const arcs = segments
    .filter((s) => s.value > 0)
    .map((s, i) => {
      const len = Math.max(0, (s.value / total) * C - gap)
      const arc = { ...s, len, offset }
      offset += (s.value / total) * C
      return { ...arc, key: i }
    })

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 190 190"
      role="img"
      aria-label="Spending by tag"
      style={{ display: 'block', margin: '0 auto', maxWidth: '100%' }}
    >
      <circle cx="95" cy="95" r={R} fill="none" stroke="var(--sunken)" strokeWidth="24" />
      {arcs.map((a) => (
        <circle
          key={a.key}
          cx="95"
          cy="95"
          r={R}
          fill="none"
          stroke={a.color}
          strokeWidth="24"
          strokeLinecap="round"
          strokeDasharray={`${a.len} ${C - a.len}`}
          strokeDashoffset={-a.offset}
          style={{ transition: 'stroke-dasharray 400ms var(--ease-soft)' }}
        />
      ))}
      <text
        x="95"
        y="90"
        textAnchor="middle"
        fontFamily="Space Grotesk, Plus Jakarta Sans, sans-serif"
        fontWeight="700"
        fontSize="21"
        fill="var(--ink)"
      >
        {centerTop}
      </text>
      <text
        x="95"
        y="110"
        textAnchor="middle"
        fontFamily="Plus Jakarta Sans, sans-serif"
        fontWeight="600"
        fontSize="10.5"
        fill="var(--faint)"
      >
        {centerBottom}
      </text>
    </svg>
  )
}
