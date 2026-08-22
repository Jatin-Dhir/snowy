// All amounts are integer minor units (paise/cents). No floating-point money.

export const CURRENCIES = [
  { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'British Pound' },
  { code: 'AED', symbol: 'د.إ', name: 'UAE Dirham' },
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen' }
] as const

export function currencySymbol(code: string): string {
  return CURRENCIES.find((c) => c.code === code)?.symbol ?? code
}

function localeFor(currency: string): string {
  return currency === 'INR' ? 'en-IN' : 'en-US'
}

/** ₹1,28,406 or ₹1,28,406.50 — Indian digit grouping for INR, paise only when present. */
export function formatMinor(minor: number, currency = 'INR'): string {
  const code = /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : 'INR'
  const negative = minor < 0
  const abs = Math.abs(minor)
  const hasFraction = abs % 100 !== 0
  const value = abs / 100
  let out: string
  try {
    out = new Intl.NumberFormat(localeFor(code), {
      style: 'currency',
      currency: code,
      minimumFractionDigits: hasFraction ? 2 : 0,
      maximumFractionDigits: hasFraction ? 2 : 0
    }).format(value)
  } catch {
    out = `${currencySymbol(code)}${value.toFixed(hasFraction ? 2 : 0)}`
  }
  return negative ? `−${out}` : out
}

/** Groups a raw digit string the Indian way: "128406" → "1,28,406". */
export function groupIndian(digits: string): string {
  if (digits.length === 0) return '0'
  const clean = digits.replace(/^0+(?=\d)/, '')
  if (clean.length <= 3) return clean
  const last3 = clean.slice(-3)
  let rest = clean.slice(0, -3)
  const parts: string[] = []
  while (rest.length > 2) {
    parts.unshift(rest.slice(-2))
    rest = rest.slice(0, -2)
  }
  if (rest) parts.unshift(rest)
  return parts.join(',') + ',' + last3
}

export function groupWestern(digits: string): string {
  const clean = digits.replace(/^0+(?=\d)/, '')
  return clean.replace(/\B(?=(\d{3})+(?!\d))/g, ',') || '0'
}

/** Live display for the numpad: rupee digits + optional paise entry. */
export function formatEntry(rupees: string, paise: string | null, currency = 'INR'): string {
  const grouped = currency === 'INR' ? groupIndian(rupees || '0') : groupWestern(rupees || '0')
  return paise === null ? grouped : `${grouped}.${paise}`
}

export function entryToMinor(rupees: string, paise: string | null): number {
  const r = parseInt(rupees || '0', 10) || 0
  const p = paise ? parseInt(paise.padEnd(2, '0').slice(0, 2), 10) || 0 : 0
  return r * 100 + p
}

export function minorToEntry(minor: number): { rupees: string; paise: string | null } {
  const r = Math.floor(minor / 100)
  const p = minor % 100
  return { rupees: String(r), paise: p ? String(p).padStart(2, '0') : null }
}
