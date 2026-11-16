import { useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Settings } from '../db/db'
import { txnsForMonth } from '../db/repo'
import { widgetLook } from '../lib/theme'
import { monthFigures, syncWidget } from '../lib/widget'

/**
 * Keeps the home-screen widget and the Quick Settings tile up to date: whenever this month's entries, the
 * budget, the currency, app lock or the look change, the summary goes to Android (lib/widget.ts). `today` is
 * App's day, which moves on at midnight and whenever Taily comes back, so a new day's figures go out too. Its own
 * component, so a new entry re-renders this and not the whole app. Draws nothing.
 */
export function WidgetSync({ settings, today }: { settings: Settings; today: string }) {
  const monthKey = today.slice(0, 7)
  const monthTxns = useLiveQuery(() => txnsForMonth(monthKey), [monthKey])
  // null for no budget; undefined only while it loads
  const budget = useLiveQuery(async () => (await db.budgets.get('overall'))?.amountMinor ?? null, [])

  const { initialized, currency, pinHash, theme, accent, accentHue } = settings
  useEffect(() => {
    if (initialized && (monthTxns === undefined || budget === undefined)) return
    // a burst of changes (an import, undo) sends one summary
    const timer = window.setTimeout(() => {
      void syncWidget({
        state: initialized ? 'ready' : 'setup',
        locked: !!pinHash,
        currency,
        theme,
        look: widgetLook(accent, accentHue),
        today,
        budget: budget && budget > 0 ? budget : 0,
        ...(initialized && monthTxns ? monthFigures(monthTxns, today) : { before: 0, days: {}, counts: {} })
      })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [initialized, monthTxns, budget, today, currency, pinHash, theme, accent, accentHue])

  return null
}
