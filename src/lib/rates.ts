// Live exchange rates from open.er-api.com — free, no key, CORS-open,
// refreshed daily. Only fetched when the user switches currency.

export interface RateInfo {
  rate: number
  /** e.g. "Fri, 22 Aug 2026" — when the provider last refreshed. */
  asOf: string
}

export async function fetchRate(from: string, to: string): Promise<RateInfo | null> {
  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(from)}`, {
      signal: AbortSignal.timeout(8000)
    })
    if (!res.ok) return null
    const data = (await res.json()) as { result?: string; rates?: Record<string, number>; time_last_update_utc?: string }
    if (data.result !== 'success') return null
    const rate = data.rates?.[to]
    if (typeof rate !== 'number' || !isFinite(rate) || rate <= 0) return null
    return { rate, asOf: (data.time_last_update_utc ?? '').split(' ').slice(0, 4).join(' ') }
  } catch {
    return null
  }
}
