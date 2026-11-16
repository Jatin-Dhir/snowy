import type { Account, Category, Txn } from '../db/db'
import { fmtTime24 } from './dates'
import { CURRENCIES } from './money'

function esc(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

export function accountLabel(id: string, accounts: Account[]): string {
  return accounts.find((a) => a.id === id)?.name ?? id
}

/**
 * The full record — every column the app knows, so a file round-trips losslessly:
 * kind distinguishes money in from money out, account is the readable name,
 * and id lets a re-import skip what's already here.
 */
export function txnsToCsv(txns: Txn[], categories: Category[], accounts: Account[]): string {
  const catName = new Map(categories.map((c) => [c.id, c.name]))
  const header = ['date', 'time', 'kind', 'amount', 'currency', 'category', 'account', 'note', 'source', 'id']
  const rows = txns.map((t) =>
    [
      t.dateISO,
      fmtTime24(t.ts),
      (t.kind ?? 'out') === 'in' ? 'received' : 'spent',
      (t.amountMinor / 100).toFixed(2),
      t.currency,
      t.categoryId ? (catName.get(t.categoryId) ?? t.categoryId) : 'Uncategorized',
      accountLabel(t.accountId, accounts),
      t.note,
      t.source,
      t.id
    ]
      .map((v) => esc(String(v)))
      .join(',')
  )
  return '﻿' + [header.join(','), ...rows].join('\r\n')
}

/* ---------------------------------- import ---------------------------------- */

/** RFC-ish CSV parser: quoted fields, embedded commas/quotes/newlines, CRLF, BOM. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += ch
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else field += ch
  }
  row.push(field)
  if (row.length > 1 || row[0] !== '') rows.push(row)
  return rows
}

export interface ImportTxn {
  id: string
  amountMinor: number
  currency: string
  /** resolved to ids after any missing ones are created */
  categoryName: string | null
  accountName: string
  kind: 'out' | 'in'
  note: string
  dateISO: string
  ts: number
  source: 'manual' | 'recurring'
}

export interface ImportPlan {
  txns: ImportTxn[]
  newCategories: string[]
  newAccounts: string[]
  duplicates: number
  badRows: number
  /** rows in another currency than the profile's, left out: most first */
  otherCurrency: { code: string; rows: number }[]
  dateFrom: string | null
  dateTo: string | null
}

const HEADER_ALIASES: Record<string, string> = {
  date: 'date', day: 'date', 'transaction date': 'date', 'txn date': 'date', 'value date': 'date',
  time: 'time',
  kind: 'kind', type: 'kind', direction: 'kind',
  amount: 'amount', value: 'amount', amt: 'amount', 'transaction amount': 'amount',
  // most Indian bank statement exports (SBI/HDFC/ICICI/Axis/Kotak…) use two
  // separate columns instead of one signed amount — whichever has a value
  // for a given row decides that row's direction
  debit: 'debit', 'debit amount': 'debit', 'withdrawal amt': 'debit', 'withdrawal amt.': 'debit', withdrawal: 'debit', 'dr amount': 'debit',
  'withdrawal amount': 'debit',
  credit: 'credit', 'credit amount': 'credit', 'deposit amt': 'credit', 'deposit amt.': 'credit', deposit: 'credit', 'cr amount': 'credit',
  'deposit amount': 'credit',
  currency: 'currency',
  // a card's foreign purchase, as it was before the bank turned it into the account's currency (N26, Monzo, most cards)
  'original amount': 'origAmount', 'foreign amount': 'origAmount', 'foreign currency amount': 'origAmount',
  'amount (foreign currency)': 'origAmount', 'local amount': 'origAmount', 'intl.amount': 'origAmount', 'intl amount': 'origAmount',
  'original currency': 'origCurrency', 'foreign currency': 'origCurrency', 'type foreign currency': 'origCurrency', 'local currency': 'origCurrency',
  category: 'category', tag: 'category',
  account: 'account', wallet: 'account', 'paid from': 'account',
  note: 'note', notes: 'note', description: 'note', memo: 'note',
  narration: 'note', particulars: 'note', details: 'note', 'transaction details': 'note', remarks: 'note',
  source: 'source',
  id: 'id'
}

/** Every column name this importer recognizes — used by the PDF extractor to spot a header row among raw positioned text. */
export const KNOWN_HEADER_WORDS: Set<string> = new Set(Object.keys(HEADER_ALIASES))

// The codes a statement can name. A WebView too old to list them all knows the app's own and the commonest others
const KNOWN_CODES: Set<string> = (() => {
  const own: string[] = CURRENCIES.map((c) => c.code)
  try {
    const all = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('currency')
    if (all && all.length > 0) return new Set([...all, ...own])
  } catch {
    /* an engine without the list */
  }
  return new Set([...own, 'AUD', 'CAD', 'CHF', 'CNY', 'HKD', 'NZD', 'SEK', 'NOK', 'DKK', 'THB', 'MYR', 'IDR', 'PHP', 'KRW', 'LKR', 'NPR', 'PKR', 'BDT', 'SAR', 'QAR', 'KWD', 'OMR', 'BHD', 'ZAR', 'BRL', 'MXN', 'TRY'])
})()

/** A currency the way a statement names it: a code in any case, or a sign only one currency uses. A bare "$" is a dozen dollars, so it names none. */
function currencyCode(raw: string): string | null {
  const v = raw.trim().toUpperCase().replace(/\.$/, '')
  if (v === '₹' || v === 'RS') return 'INR'
  if (v === '€') return 'EUR'
  if (v === '£') return 'GBP'
  if (v === 'US$') return 'USD'
  if (v === 'S$') return 'SGD'
  return KNOWN_CODES.has(v) ? v : null
}

/**
 * What a column holds, from its header: one of HEADER_ALIASES, and the currency its amounts are in when the header
 * says so, as "Amount (INR)", "Amount(in Rs.)", ICICI's "Withdrawal Amount (INR )", "Amount in EUR" or "INR Amount" do.
 */
function readHeader(cell: string): { role: string; cur: string | null } {
  const h = cell.trim().toLowerCase().replace(/\s+/g, ' ')
  if (HEADER_ALIASES[h]) return { role: HEADER_ALIASES[h], cur: null }
  const named = /^(.+?) ?[([] ?(?:in )?([^)\]]+?) ?[)\]]$/.exec(h) ?? /^(.+?) in (\S+)$/.exec(h)
  if (named && HEADER_ALIASES[named[1]] && currencyCode(named[2])) return { role: HEADER_ALIASES[named[1]], cur: currencyCode(named[2]) }
  const lead = /^(\S+) (.+)$/.exec(h)
  if (lead && HEADER_ALIASES[lead[2]] && currencyCode(lead[1])) return { role: HEADER_ALIASES[lead[2]], cur: currencyCode(lead[1]) }
  return { role: '', cur: null }
}

/** "3 rows in USD and 1 in EUR left out: this profile keeps its money in INR" */
export function leftOutLine(left: { code: string; rows: number }[], currency: string): string {
  const parts = left.map((l, i) => `${l.rows} ${i === 0 ? (l.rows === 1 ? 'row' : 'rows') + ' ' : ''}in ${l.code}`)
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]
  return `${list} left out: this profile keeps its money in ${currency}`
}

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** A statement's two-digit year is this century's: "26" is 2026. */
const fullYear = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y))

/** `monthFirst`: the file's numbers-only dates are a US bank's, 08/23/2026 (see planImportFromGrid). */
function parseDate(raw: string, monthFirst = false): string | null {
  const v = raw.trim()
  let y: number, mo: number, d: number
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v)
  if (m) {
    ;[y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  } else if ((m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})(?!\d)/.exec(v))) {
    // Indian/European day-first: 23/08/2026, 23-08-2026, or HDFC's 23/08/26; a US bank's month-first 08/23/2026
    ;[d, mo, y] = monthFirst ? [Number(m[2]), Number(m[1]), fullYear(m[3])] : [Number(m[1]), Number(m[2]), fullYear(m[3])]
  } else if ((m = /^(\d{1,2})[\s/-]*([A-Za-z]{3,})\.?[\s/,-]*(\d{4}|\d{2})(?!\d)/.exec(v))) {
    // the month in words, as SBI and most card statements write it: 1 Nov 2026, 01-Nov-26
    ;[d, mo, y] = [Number(m[1]), MONTH_NAMES.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, fullYear(m[3])]
  } else {
    return null
  }
  // a day the calendar doesn't have (31/02, month 13) is a misread: as an entry, no month would ever show it
  if (mo < 1 || mo > 12 || d < 1 || d > new Date(y, mo, 0).getDate()) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.\-]/g, '')
  if (!cleaned || cleaned === '-' || cleaned === '.') return null
  const n = parseFloat(cleaned)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100)
}

/**
 * An amount, and the currency written into it if there is one: "USD 15.00", "15.00 USD", "₹450". Taken off before the
 * number is read, or "Rs. 1,260.00" became ₹0.13 (its dot read as the decimal point). Money out often has its minus
 * in front of the currency, "-USD 15.00" or "-Rs. 1,260.00": the minus stays with the number.
 */
function readAmount(raw: string): { minor: number | null; cur: string | null } {
  const v = raw.trim()
  const lead = /^([-−]?) ?(US\$|S\$|Rs\.?|[₹€£]|[A-Za-z]{3}(?![A-Za-z]))/i.exec(v)
  const leadCur = lead && currencyCode(lead[2])
  if (leadCur && lead) return { minor: parseAmount((lead[1] ? '-' : '') + v.slice(lead[0].length)), cur: leadCur }
  const trail = /(?:^|[^A-Za-z])(Rs\.?|[A-Za-z]{3})$/i.exec(v)
  const trailCur = trail && currencyCode(trail[1])
  if (trailCur && trail) return { minor: parseAmount(v.slice(0, v.length - trail[1].length)), cur: trailCur }
  return { minor: parseAmount(v), cur: null }
}

/** cyrb53: a quick, well-spread 53-bit hash of a string, in base 36 */
function hash53(s: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/**
 * A statement's rows carry no id of their own. One made from what the row says, and how many times
 * the file has said it before, comes out the same whenever the same row is read again (the same file
 * twice, or two statements that overlap), so it's skipped like any entry already here, while two
 * identical payments on one day stay two.
 */
function statementRowId(parts: (string | number)[], repeats: Map<string, number>): string {
  const key = parts.map((p) => String(p).trim().toLowerCase().replace(/\s+/g, ' ')).join('|')
  const n = repeats.get(key) ?? 0
  repeats.set(key, n + 1)
  return `stmt-${hash53(`${key}|${n}`)}`
}

/**
 * Read any reasonable CSV into a ready-to-apply plan. Understands our own
 * export fully; for other files it maps common column names, treats negative
 * amounts as money out when there's no kind column, and never touches the
 * database itself — the caller applies the plan.
 */
export function planCsvImport(
  text: string,
  ctx: {
    categories: Category[]
    accounts: Account[]
    existingIds: Set<string>
    defaultCurrency: string
  }
): ImportPlan | null {
  return planImportFromGrid(parseCsv(text), ctx)
}

/**
 * Same as planCsvImport, but starting from an already-split grid — shared
 * with the PDF importer, which reconstructs a grid from positioned text
 * instead of splitting on commas.
 */
export function planImportFromGrid(
  grid: string[][],
  ctx: {
    categories: Category[]
    accounts: Account[]
    existingIds: Set<string>
    defaultCurrency: string
  }
): ImportPlan | null {
  // a bank's export often starts with the account's details (name, number, period) and only then the
  // table: its header is the first row that names a date and an amount, or debit and credit columns
  const headerOf = (row: string[]) => row.map((h) => readHeader(h).role)
  const at = grid.slice(0, 40).findIndex((row) => {
    const h = headerOf(row)
    return h.includes('date') && (h.includes('amount') || h.includes('debit') || h.includes('credit'))
  })
  if (at < 0 || grid.length - at < 2) return null
  const heads = grid[at].map(readHeader)
  const header = heads.map((h) => h.role)
  const body = grid.slice(at + 1)
  // two amount columns (what a purchase cost, and what the bank charged for it): the one in this profile's
  // currency, else one whose header names no currency
  const amountCols = header.flatMap((role, i) => (role === 'amount' ? [i] : []))
  const amountCol = amountCols.find((i) => heads[i].cur === ctx.defaultCurrency) ?? amountCols.find((i) => !heads[i].cur) ?? amountCols[0] ?? -1
  const col = (name: string) => (name === 'amount' ? amountCol : header.indexOf(name))
  const debitCreditMode = col('amount') < 0 && (col('debit') >= 0 || col('credit') >= 0)
  if (col('date') < 0 || (col('amount') < 0 && !debitCreditMode)) return null

  // The currency an amount is in: its header's ("Amount (INR)"), else a currency column's, else one written into the
  // amount itself. A card statement that lists a foreign purchase's original amount without a currency column of its
  // own names that amount's currency in its "Currency" column: the amount the account was charged needs none
  const origCol = col('origAmount')
  const currencyIsOrig = origCol >= 0 && heads[origCol].cur === null && col('origCurrency') < 0
  const mainHeaderCur = debitCreditMode ? (heads[col('debit')]?.cur ?? heads[col('credit')]?.cur ?? null) : heads[amountCol].cur
  const otherCurrency = new Map<string, number>()

  const catByName = new Map(ctx.categories.map((c) => [c.name.toLowerCase(), c.name]))
  const accByName = new Map(ctx.accounts.map((a) => [a.name.toLowerCase(), a.name]))
  const newCategories = new Map<string, string>()
  const newAccounts = new Map<string, string>()
  const seenIds = new Set<string>()
  const repeats = new Map<string, number>()
  const txns: ImportTxn[] = []
  let duplicates = 0
  let badRows = 0

  const kindCol = col('kind')
  const hasNegatives =
    !debitCreditMode &&
    kindCol < 0 &&
    body.some((r) => (readAmount(r[col('amount')] ?? '').minor ?? 0) < 0)

  // Numbers-only dates are read day first (23/08/2026). A US bank writes the month first (08/23/2026): read that
  // way, its 5 November came in as 11 May and every day past the 12th was "unreadable". A file shows which it is
  // as soon as one date has a second number over 12 and none has a first one over 12
  let firstOver12 = false
  let secondOver12 = false
  for (const r of body) {
    const m = /^(\d{1,2})[/-](\d{1,2})[/-](?:\d{4}|\d{2})(?!\d)/.exec((r[col('date')] ?? '').trim())
    if (!m) continue
    if (Number(m[1]) > 12) firstOver12 = true
    if (Number(m[2]) > 12) secondOver12 = true
  }
  const monthFirst = secondOver12 && !firstOver12

  for (const r of body) {
    const cell = (name: string) => {
      const i = col(name)
      return i >= 0 ? (r[i] ?? '').trim() : ''
    }
    const dateISO = parseDate(cell('date'), monthFirst)

    let amountRaw: number | null
    let cellCur: string | null = null
    let kind: 'out' | 'in' = 'out'
    if (debitCreditMode) {
      // exactly one of the two is populated per row in a real statement;
      // if a row somehow has both, treat it as a debit — the conservative
      // read, since missing an expense is worse than missing income
      const debit = readAmount(cell('debit'))
      const credit = readAmount(cell('credit'))
      if (debit.minor) {
        amountRaw = debit.minor
        cellCur = debit.cur
        kind = 'out'
      } else if (credit.minor) {
        amountRaw = credit.minor
        cellCur = credit.cur
        kind = 'in'
      } else {
        amountRaw = null
      }
    } else {
      const amount = readAmount(cell('amount'))
      amountRaw = amount.minor
      cellCur = amount.cur
    }
    if (!dateISO || amountRaw === null || amountRaw === 0) {
      badRows++
      continue
    }

    // A row in another currency would count its number as this profile's money: 15 dollars as ₹15. It stays out,
    // unless the row also says what it cost in this profile's currency, as a card's foreign purchase does
    let amountMinor = Math.abs(amountRaw)
    const rowCur = mainHeaderCur ?? (currencyIsOrig ? null : currencyCode(cell('currency'))) ?? cellCur
    if (rowCur && rowCur !== ctx.defaultCurrency) {
      const orig = origCol >= 0 ? readAmount(cell('origAmount')) : null
      const origCur =
        heads[origCol]?.cur ??
        (col('origCurrency') >= 0 ? currencyCode(cell('origCurrency')) : currencyIsOrig ? currencyCode(cell('currency')) : null) ??
        orig?.cur ??
        null
      if (orig?.minor && origCur === ctx.defaultCurrency) {
        amountMinor = Math.abs(orig.minor)
      } else {
        otherCurrency.set(rowCur, (otherCurrency.get(rowCur) ?? 0) + 1)
        continue
      }
    }

    // statements mark the direction "Cr" / "Dr" as often as they spell it out
    const kindRaw = cell('kind').toLowerCase().replace(/\.$/, '')
    if (kindRaw) kind = ['in', 'income', 'received', 'credit', 'credited', 'deposit', 'cr'].includes(kindRaw) ? 'in' : 'out'
    else if (hasNegatives) kind = amountRaw < 0 ? 'out' : 'in'

    const note = cell('note')
    const accRaw = cell('account') || 'Cash'
    const id = cell('id') || statementRowId([dateISO, kind, amountMinor, note, accRaw], repeats)
    if (ctx.existingIds.has(id) || seenIds.has(id)) {
      duplicates++
      continue
    }
    seenIds.add(id)

    const catRaw = cell('category')
    let categoryName: string | null = null
    if (catRaw && catRaw.toLowerCase() !== 'uncategorized') {
      categoryName =
        catByName.get(catRaw.toLowerCase()) ?? newCategories.get(catRaw.toLowerCase()) ?? null
      if (!categoryName) {
        newCategories.set(catRaw.toLowerCase(), catRaw)
        categoryName = catRaw
      }
    }

    let accountName = accByName.get(accRaw.toLowerCase()) ?? newAccounts.get(accRaw.toLowerCase()) ?? ''
    if (!accountName) {
      newAccounts.set(accRaw.toLowerCase(), accRaw)
      accountName = accRaw
    }

    // a time that can't be (25:70) means noon, like no time: an entry without a real moment sorts nowhere
    const time = /^(\d{1,2}):(\d{2})/.exec(cell('time'))
    const ts =
      time && Number(time[1]) < 24 && Number(time[2]) < 60
        ? new Date(`${dateISO}T${time[1].padStart(2, '0')}:${time[2]}:00`).getTime()
        : new Date(`${dateISO}T12:00:00`).getTime()

    txns.push({
      id,
      amountMinor,
      currency: ctx.defaultCurrency,
      categoryName,
      accountName,
      kind,
      note,
      dateISO,
      ts,
      source: cell('source') === 'recurring' ? 'recurring' : 'manual'
    })
  }

  if (txns.length === 0 && duplicates === 0 && otherCurrency.size === 0) return null
  const dates = txns.map((t) => t.dateISO).sort()
  return {
    txns,
    newCategories: [...newCategories.values()],
    newAccounts: [...newAccounts.values()],
    duplicates,
    badRows,
    otherCurrency: [...otherCurrency].map(([code, rows]) => ({ code, rows })).sort((a, b) => b.rows - a.rows),
    dateFrom: dates[0] ?? null,
    dateTo: dates[dates.length - 1] ?? null
  }
}
