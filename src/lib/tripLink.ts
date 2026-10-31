// A trip to send to the group, with no accounts and no server. The link carries the
// trip itself, after the # (the part of an address a browser never sends anywhere),
// and public/trip.html draws it from there. So the developer's side never sees it:
// it reaches only whoever the link is sent to, and it's the trip as of the moment it
// was shared. Sending a newer one is how the group catches up.
import type { Category, Trip, TripEntry } from '../db/db'
import { fromISO } from './dates'
import { WEB_URL } from './distribution'
import { formatMinor } from './money'
import type { TripSummary } from './split'

// plenty to see where the money went and short enough to survive a chat app;
// the totals and who pays whom always cover every spend
const MAX_SPENDS = 120
const MAX_TITLE = 40

function shortTitle(text: string): string {
  return text.length > MAX_TITLE ? `${text.slice(0, MAX_TITLE - 1).trimEnd()}…` : text
}

function encode(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** The short form public/trip.html reads. Keys and order are that page's contract: change both together. */
export function tripPayload(
  trip: Trip,
  summary: TripSummary,
  entries: TripEntry[],
  categories: Category[],
  currency: string,
  asOf = Date.now()
) {
  const index = new Map(trip.people.map((p, i) => [p.id, i]))
  const category = (id: string | null) => categories.find((c) => c.id === id)
  const tags = summary.byCategory.map((g) => g.categoryId)
  const day = (iso: string) => Math.round((fromISO(iso).getTime() - fromISO(trip.startISO).getTime()) / 86400000)
  const live = entries.filter((e) => !e.deleted).sort((a, b) => b.ts - a.ts)
  return {
    v: 1,
    n: trip.name,
    c: currency,
    s: trip.startISO,
    e: trip.endedISO,
    a: asOf,
    b: trip.budgetMinor,
    t: summary.total,
    p: summary.balances.map((b) => [b.name, b.paid, b.share, b.net]),
    x: summary.transfers.map((t) => [index.get(t.from) ?? 0, index.get(t.to) ?? 0, t.amountMinor]),
    g: summary.byCategory.map((g) => {
      const c = category(g.categoryId)
      return [c?.name ?? 'Untagged', c?.color ?? '#7A8794', g.total]
    }),
    l: live
      .slice(0, MAX_SPENDS)
      .map((e) => [
        day(e.dateISO),
        shortTitle(e.note.trim() || category(e.categoryId)?.name || 'Spend'),
        e.amountMinor,
        index.get(e.paidBy) ?? 0,
        e.among.length,
        tags.indexOf(e.categoryId)
      ]),
    m: Math.max(0, live.length - MAX_SPENDS)
  }
}

export function tripLink(payload: ReturnType<typeof tripPayload>): string {
  return `${WEB_URL}trip.html#${encode(payload)}`
}

/** The message to the group: where it stands in a few lines, and the link for everything else. */
export function tripMessage(trip: Trip, summary: TripSummary, link: string, currency: string): string {
  const name = (id: string) => trip.people.find((p) => p.id === id)?.name ?? 'Someone'
  const lines = [`${trip.name}: ${formatMinor(summary.total, currency)} spent by ${trip.people.length} people`, '']
  if (summary.transfers.length > 0) {
    lines.push('Who pays whom:')
    for (const t of summary.transfers) lines.push(`${name(t.from)} pays ${name(t.to)} ${formatMinor(t.amountMinor, currency)}`)
  } else {
    lines.push('All square. Nobody owes anybody.')
  }
  lines.push('', `Every spend: ${link}`)
  return lines.join('\n')
}
