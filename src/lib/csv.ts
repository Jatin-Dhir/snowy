import type { Account, Category, Txn } from '../db/db'
import { fmtTime } from './dates'

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
      fmtTime(t.ts),
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

/**
 * Saves a CSV from the browser. An iPhone has no real "download" from a Home
 * Screen app, so hand the file to the share sheet (Save to Files, Mail, AirDrop)
 * when it's on offer. Resolves false if the person dismissed the sheet.
 */
export async function downloadCsv(content: string, filename: string): Promise<boolean> {
  if (/iPad|iPhone|iPod/.test(navigator.userAgent) && typeof navigator.canShare === 'function') {
    const file = new File([content], filename, { type: 'text/csv' })
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename })
        return true
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return false
        // Safari wants a fresh tap for share() — fall through to a plain download
      }
    }
  }
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
  return true
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
  credit: 'credit', 'credit amount': 'credit', 'deposit amt': 'credit', 'deposit amt.': 'credit', deposit: 'credit', 'cr amount': 'credit',
  currency: 'currency',
  category: 'category', tag: 'category',
  account: 'account', wallet: 'account', 'paid from': 'account',
  note: 'note', notes: 'note', description: 'note', memo: 'note',
  narration: 'note', particulars: 'note', details: 'note', 'transaction details': 'note', remarks: 'note',
  source: 'source',
  id: 'id'
}

/** Every column name this importer recognizes — used by the PDF extractor to spot a header row among raw positioned text. */
export const KNOWN_HEADER_WORDS: Set<string> = new Set(Object.keys(HEADER_ALIASES))

function parseDate(raw: string): string | null {
  const v = raw.trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v)
  if (m) {
    const [, y, mo, d] = m
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  // Indian/European day-first: 23/08/2026 or 23-08-2026
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(v)
  if (m) {
    const [, d, mo, y] = m
    if (parseInt(mo, 10) > 12) return null
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  return null
}

function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.\-]/g, '')
  if (!cleaned || cleaned === '-' || cleaned === '.') return null
  const n = parseFloat(cleaned)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100)
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
  if (grid.length < 2) return null
  const header = grid[0].map((h) => HEADER_ALIASES[h.trim().toLowerCase()] ?? '')
  const col = (name: string) => header.indexOf(name)
  const debitCreditMode = col('amount') < 0 && (col('debit') >= 0 || col('credit') >= 0)
  if (col('date') < 0 || (col('amount') < 0 && !debitCreditMode)) return null

  const catByName = new Map(ctx.categories.map((c) => [c.name.toLowerCase(), c.name]))
  const accByName = new Map(ctx.accounts.map((a) => [a.name.toLowerCase(), a.name]))
  const newCategories = new Map<string, string>()
  const newAccounts = new Map<string, string>()
  const seenIds = new Set<string>()
  const txns: ImportTxn[] = []
  let duplicates = 0
  let badRows = 0

  const kindCol = col('kind')
  const hasNegatives =
    !debitCreditMode &&
    kindCol < 0 &&
    grid.slice(1).some((r) => parseFloat((r[col('amount')] ?? '').replace(/[^0-9.\-]/g, '')) < 0)

  for (const r of grid.slice(1)) {
    const cell = (name: string) => {
      const i = col(name)
      return i >= 0 ? (r[i] ?? '').trim() : ''
    }
    const dateISO = parseDate(cell('date'))

    let amountRaw: number | null
    let kind: 'out' | 'in' = 'out'
    if (debitCreditMode) {
      // exactly one of the two is populated per row in a real statement;
      // if a row somehow has both, treat it as a debit — the conservative
      // read, since missing an expense is worse than missing income
      const debit = parseAmount(cell('debit'))
      const credit = parseAmount(cell('credit'))
      if (debit) {
        amountRaw = debit
        kind = 'out'
      } else if (credit) {
        amountRaw = credit
        kind = 'in'
      } else {
        amountRaw = null
      }
    } else {
      amountRaw = parseAmount(cell('amount'))
    }
    if (!dateISO || amountRaw === null || amountRaw === 0) {
      badRows++
      continue
    }
    const id = cell('id')
    if (id && (ctx.existingIds.has(id) || seenIds.has(id))) {
      duplicates++
      continue
    }
    if (id) seenIds.add(id)

    const kindRaw = cell('kind').toLowerCase()
    if (kindRaw) kind = ['in', 'income', 'received', 'credit', 'deposit'].includes(kindRaw) ? 'in' : 'out'
    else if (hasNegatives) kind = amountRaw < 0 ? 'out' : 'in'

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

    const accRaw = cell('account') || 'Cash'
    let accountName = accByName.get(accRaw.toLowerCase()) ?? newAccounts.get(accRaw.toLowerCase()) ?? ''
    if (!accountName) {
      newAccounts.set(accRaw.toLowerCase(), accRaw)
      accountName = accRaw
    }

    const time = /^(\d{1,2}):(\d{2})/.exec(cell('time'))
    const ts = time
      ? new Date(`${dateISO}T${time[1].padStart(2, '0')}:${time[2]}:00`).getTime()
      : new Date(`${dateISO}T12:00:00`).getTime()

    txns.push({
      id: id || crypto.randomUUID(),
      amountMinor: Math.abs(amountRaw),
      currency: cell('currency').toUpperCase() || ctx.defaultCurrency,
      categoryName,
      accountName,
      kind,
      note: cell('note'),
      dateISO,
      ts,
      source: cell('source') === 'recurring' ? 'recurring' : 'manual'
    })
  }

  if (txns.length === 0 && duplicates === 0) return null
  const dates = txns.map((t) => t.dateISO).sort()
  return {
    txns,
    newCategories: [...newCategories.values()],
    newAccounts: [...newAccounts.values()],
    duplicates,
    badRows,
    dateFrom: dates[0] ?? null,
    dateTo: dates[dates.length - 1] ?? null
  }
}
