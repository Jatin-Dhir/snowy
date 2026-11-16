// The home-screen widget and the Quick Settings tile can't read Taily's data, so the app leaves them a
// small summary whenever entries, the budget, the recurring payments, the currency or the look change.
// Android works today's figures out from it (TodayMoney.java), after midnight too, without Taily being
// opened. Only totals by day leave the ledger, and each recurring payment's day, amount and next run: no
// names, notes, tags or accounts.

import { DEFAULT_SETTINGS, type Rule, type Txn } from '../db/db'
import { isOut, isRecurring } from '../db/stats'
import { todayISO } from './dates'
import { widgetLook, type WidgetColors } from './theme'

export interface WidgetSummary {
  /** 'setup' until Taily is set up, and again after Erase everything */
  state: 'ready' | 'setup'
  /** app lock is on: the widget keeps money off the home screen */
  locked: boolean
  currency: string
  /** Taily's own theme: 'system' lets the widget follow the phone */
  theme: string
  look: { special: boolean; light: WidgetColors; dark: WidgetColors }
  /** the day these figures were worked out on */
  today: string
  /** the month's overall budget, 0 for none */
  budget: number
  /** spent this month before today, as safeToSpend counts it */
  before: number
  /** spend per day, today and later this month, so a new day needs no new summary */
  days: Record<string, number>
  /** entries per day, the same days */
  counts: Record<string, number>
  /**
   * The part of each day's spend that recurring rules logged, the same days: set aside, not today's spend. Added
   * later: a summary from an older app has none
   */
  fixed?: Record<string, number>
  /**
   * The recurring rules that are on (not paused): each one's day of the month, amount and next run, so the widget
   * sets aside what's still due, in a new month too, as stillDue does. Added with `fixed`
   */
  rules?: WidgetRule[]
}

export interface WidgetRule {
  day: number
  amount: number
  next: string
}

/** A month's entries as the widget needs them. */
export function monthFigures(monthTxns: Txn[], today: string): Pick<WidgetSummary, 'before' | 'days' | 'counts' | 'fixed'> {
  let before = 0
  const days: Record<string, number> = {}
  const counts: Record<string, number> = {}
  const fixed: Record<string, number> = {}
  for (const t of monthTxns) {
    if (t.dateISO < today) {
      if (isOut(t)) before += t.amountMinor
      continue
    }
    counts[t.dateISO] = (counts[t.dateISO] ?? 0) + 1
    if (isOut(t)) days[t.dateISO] = (days[t.dateISO] ?? 0) + t.amountMinor
    if (isOut(t) && isRecurring(t)) fixed[t.dateISO] = (fixed[t.dateISO] ?? 0) + t.amountMinor
  }
  return { before, days, counts, fixed }
}

/** The rules as the widget needs them: the ones that are on, by day, amount and next run. */
export function widgetRules(rules: Rule[]): WidgetRule[] {
  return rules.filter((r) => !r.paused).map((r) => ({ day: r.dayOfMonth, amount: r.amountMinor, next: r.nextRunISO }))
}

interface WidgetPlugin {
  update(options: { summary: WidgetSummary }): Promise<void>
}

// inside an object, never a promise's value: see the note on native() in voice.ts
let plugin: Promise<{ api: WidgetPlugin } | null> | null = null

function native(): Promise<{ api: WidgetPlugin } | null> {
  plugin ??= (async () => {
    try {
      const { Capacitor, registerPlugin } = await import('@capacitor/core')
      return Capacitor.getPlatform() === 'android' ? { api: registerPlugin<WidgetPlugin>('Widget') } : null
    } catch {
      return null
    }
  })()
  return plugin
}

let lastSent = ''

/**
 * Clear all data: the widget and the tile go back to "set up Taily" at once, keeping nothing of the figures they had,
 * in the look a fresh start sends too.
 */
export async function forgetWidget(): Promise<void> {
  const { currency, theme, accent, accentHue } = DEFAULT_SETTINGS
  await syncWidget({
    state: 'setup',
    locked: false,
    currency,
    theme,
    look: widgetLook(accent, accentHue),
    today: todayISO(),
    budget: 0,
    before: 0,
    days: {},
    counts: {},
    fixed: {},
    rules: []
  })
}

/** Hands the summary to the widget, unless it's the one already there. */
export async function syncWidget(summary: WidgetSummary): Promise<void> {
  const json = JSON.stringify(summary)
  if (json === lastSent) return
  const api = (await native())?.api ?? null
  if (!api) return
  try {
    await api.update({ summary })
    lastSent = json
  } catch {
    /* an older native shell without the plugin */
  }
}
