import type { Category, Txn } from '../db/db'
import { fmtTime } from './dates'

function esc(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

export function txnsToCsv(txns: Txn[], categories: Category[]): string {
  const catName = new Map(categories.map((c) => [c.id, c.name]))
  const header = ['date', 'time', 'amount', 'currency', 'category', 'account', 'note', 'source']
  const rows = txns.map((t) =>
    [
      t.dateISO,
      fmtTime(t.ts),
      (t.amountMinor / 100).toFixed(2),
      t.currency,
      t.categoryId ? (catName.get(t.categoryId) ?? t.categoryId) : 'Uncategorized',
      t.accountId,
      t.note,
      t.source
    ]
      .map((v) => esc(String(v)))
      .join(',')
  )
  return '﻿' + [header.join(','), ...rows].join('\r\n')
}

export function downloadCsv(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
