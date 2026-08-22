export function Progress({
  fraction,
  color,
  tickFraction,
  height = 6
}: {
  fraction: number
  color: string
  tickFraction?: number
  height?: number
}) {
  const width = Math.max(0, Math.min(1, fraction)) * 100
  return (
    <div className="bar-track" style={{ height, borderRadius: height / 2 }}>
      <div className="bar-fill" style={{ width: `${width}%`, background: color, borderRadius: height / 2 }} />
      {tickFraction !== undefined && (
        <div
          className="bar-tick"
          style={{ left: `${Math.min(99, tickFraction * 100)}%`, height: height + 6, top: -3 }}
        />
      )}
    </div>
  )
}
