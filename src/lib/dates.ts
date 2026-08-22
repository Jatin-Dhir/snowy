const DAY_MS = 86400000

export function toISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function todayISO(): string {
  return toISO(new Date())
}

export function fromISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDaysISO(iso: string, days: number): string {
  const d = fromISO(iso)
  d.setDate(d.getDate() + days)
  return toISO(d)
}

/** "2026-08" */
export function monthKeyOf(iso: string): string {
  return iso.slice(0, 7)
}

export function currentMonthKey(): string {
  return monthKeyOf(todayISO())
}

export function monthRange(key: string): { from: string; to: string } {
  const [y, m] = key.split('-').map(Number)
  const from = `${key}-01`
  const to = toISO(new Date(y, m, 0))
  return { from, to }
}

export function daysInMonth(key: string): number {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

export function addMonths(key: string, n: number): string {
  const [y, m] = key.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function monthLabel(key: string, opts: { withYear?: boolean } = {}): string {
  const [y, m] = key.split('-').map(Number)
  const name = new Date(y, m - 1, 1).toLocaleString('en-IN', { month: 'long' })
  return opts.withYear || y !== new Date().getFullYear() ? `${name} ${y}` : name
}

export function monthShort(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleString('en-IN', { month: 'short' }).toUpperCase()
}

/** Monday-started week containing `iso`, as 7 ISO dates. */
export function weekDaysOf(iso: string): string[] {
  const d = fromISO(iso)
  const shift = (d.getDay() + 6) % 7 // Mon=0
  const mon = new Date(d.getTime() - shift * DAY_MS)
  return Array.from({ length: 7 }, (_, i) => toISO(new Date(mon.getTime() + i * DAY_MS)))
}

export function fmtTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function fmtDayHeading(iso: string): string {
  const today = todayISO()
  if (iso === today) {
    const d = fromISO(iso)
    return `Today · ${d.toLocaleString('en-IN', { weekday: 'short', month: 'short', day: 'numeric' })}`
  }
  if (iso === addDaysISO(today, -1)) return 'Yesterday'
  const d = fromISO(iso)
  const sameYear = iso.slice(0, 4) === today.slice(0, 4)
  return d.toLocaleString('en-IN', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' })
  })
}

export function fmtShortDate(iso: string): string {
  const d = fromISO(iso)
  return d.toLocaleString('en-IN', { weekday: 'short', day: 'numeric' })
}

export function weekdayName(iso: string): string {
  return fromISO(iso).toLocaleString('en-IN', { weekday: 'long' })
}

/** Next occurrence of a day-of-month strictly after `afterISO` (clamped to month length). */
export function nextMonthlyOccurrence(dayOfMonth: number, afterISO: string): string {
  const after = fromISO(afterISO)
  for (let i = 0; i < 24; i++) {
    const y = after.getFullYear()
    const m = after.getMonth() + i
    const base = new Date(y, m, 1)
    const clamped = Math.min(dayOfMonth, new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate())
    const candidate = new Date(base.getFullYear(), base.getMonth(), clamped)
    if (toISO(candidate) > afterISO) return toISO(candidate)
  }
  return afterISO
}
