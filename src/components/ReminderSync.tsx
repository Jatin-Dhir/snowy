import { useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Settings } from '../db/db'
import { txnsBetween } from '../db/repo'
import { syncDailyReminder } from '../lib/notify'

/**
 * Keeps the daily nudge to log (Settings, Daily reminder) in step with the day: once anything is logged today,
 * today's nudge goes; a new day, a new time or turning it off reschedules. `today` is App's day, which moves on
 * at midnight and whenever Taily comes back. Draws nothing.
 */
export function ReminderSync({ settings, today }: { settings: Settings; today: string }) {
  // undefined while it loads
  const loggedToday = useLiveQuery(async () => (await txnsBetween(today, today)).length > 0, [today])
  const time = settings.initialized ? settings.reminder : null

  useEffect(() => {
    if (loggedToday === undefined) return
    const timer = window.setTimeout(() => void syncDailyReminder(time, loggedToday), 400)
    return () => window.clearTimeout(timer)
  }, [time, loggedToday, today])

  return null
}
