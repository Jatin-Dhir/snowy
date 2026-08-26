// Turns a PDF bank statement into the same string[][] grid shape the CSV
// importer already understands, so both share one parsing pipeline
// (lib/csv.ts's planImportFromGrid) instead of two.
//
// A PDF has no real table structure — just text glyphs at (x, y)
// positions. The approach: cluster text items into rows by y, find a
// header row by matching known column-name keywords (the same
// HEADER_ALIASES used for CSV), then snap every later row's text to the
// nearest header x-position to rebuild columns. Imperfect by nature —
// every bank lays its statement out differently — but planImportFromGrid
// already rejects any row that doesn't yield a real date + amount, so a
// mis-snapped stray word just becomes a skipped row, never a wrong number.
//
// Uses pdf.js's "legacy" build specifically: it targets older JS engines,
// which matters here given this app's had real older-Android breakage
// before (status bar, haptics) — the safer choice over the evergreen build.

import { KNOWN_HEADER_WORDS } from './csv'

export type PdfExtractResult =
  | { ok: true; grid: string[][] }
  | { ok: false; reason: 'password' | 'wrong-password' | 'no-text' | 'error' }

let workerConfigured = false

async function loadPdfJs() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  if (!workerConfigured) {
    const workerUrl = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
    workerConfigured = true
  }
  return pdfjs
}

interface Item {
  x: number
  y: number
  str: string
}

/** Cluster raw text items into reading-order rows (top to bottom, left to right within a row). */
function clusterRows(items: Item[]): Item[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x)
  const rows: Item[][] = []
  let current: Item[] = []
  let currentY: number | null = null
  const tolerance = 3
  for (const it of sorted) {
    if (currentY === null || Math.abs(it.y - currentY) <= tolerance) {
      current.push(it)
      currentY = currentY === null ? it.y : (currentY + it.y) / 2
    } else {
      if (current.length) rows.push(current.sort((a, b) => a.x - b.x))
      current = [it]
      currentY = it.y
    }
  }
  if (current.length) rows.push(current.sort((a, b) => a.x - b.x))
  return rows
}

/** A row is a plausible header if it has 2+ items matching known statement column words. */
function findHeaderAnchors(rows: Item[][]): Item[] | null {
  for (const row of rows.slice(0, 40)) {
    const hits = row.filter((it) => KNOWN_HEADER_WORDS.has(it.str.trim().toLowerCase()))
    if (hits.length >= 2) return row
  }
  return null
}

/** Snap a data row's fragments onto the header's column x-positions, joining fragments that land in the same bucket. */
function snapToColumns(row: Item[], anchors: Item[]): string[] {
  const cells = anchors.map(() => [] as string[])
  for (const it of row) {
    let best = 0
    let bestDist = Infinity
    for (let i = 0; i < anchors.length; i++) {
      const d = Math.abs(it.x - anchors[i].x)
      if (d < bestDist) {
        bestDist = d
        best = i
      }
    }
    cells[best].push(it.str)
  }
  return cells.map((parts) => parts.join(' ').replace(/\s+/g, ' ').trim())
}

export async function extractPdfGrid(data: Uint8Array, password?: string): Promise<PdfExtractResult> {
  try {
    const pdfjs = await loadPdfJs()
    const doc = await pdfjs
      .getDocument({ data, password })
      .promise.catch((e: unknown) => {
        const err = e as { name?: string; code?: number }
        if (err?.name === 'PasswordException') {
          throw err.code === 1 ? new Error('__password_needed__') : new Error('__password_wrong__')
        }
        throw e
      })

    let headerAnchors: Item[] | null = null
    const grid: string[][] = []

    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p)
      const content = await page.getTextContent()
      const items: Item[] = []
      for (const it of content.items as { str?: string; transform?: number[] }[]) {
        if (it.str && it.str.trim().length > 0 && it.transform) {
          items.push({ x: it.transform[4], y: it.transform[5], str: it.str })
        }
      }
      if (items.length === 0) continue

      const rows = clusterRows(items)
      const pageHeader = findHeaderAnchors(rows)
      if (pageHeader) headerAnchors = pageHeader
      if (!headerAnchors) continue // haven't found a header yet — skip until we do

      if (grid.length === 0) grid.push(headerAnchors.map((a) => a.str.trim()))
      for (const row of rows) {
        if (row === pageHeader) continue
        grid.push(snapToColumns(row, headerAnchors))
      }
    }

    if (grid.length < 2) return { ok: false, reason: 'no-text' }
    return { ok: true, grid }
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    if (msg === '__password_needed__') return { ok: false, reason: 'password' }
    if (msg === '__password_wrong__') return { ok: false, reason: 'wrong-password' }
    return { ok: false, reason: 'error' }
  }
}
