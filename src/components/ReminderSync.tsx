import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Settings } from '../db/db'
import { txnsBetween } from '../db/repo'
import { onReturn, syncDailyReminder, syncLoanReminders } from '../lib/notify'

/**
 * Keeps the daily nudge to log (Settings, Daily reminder) in step with the day: once anything is logged today,
 * today's nudge goes; a new day, a new time or turning it off reschedules. `today` is App's day, which moves on
 * at midnight and whenever Taily comes back. Draws nothing.
 */
export function ReminderSync({ settings, today }: { settings: Settings; today: string }) {
  // undefined while it loads
  const loggedToday = useLiveQuery(async () => (await txnsBetween(today, today)).length > 0, [today])
  const time = settings.initialized ? settings.reminder : null
  // With Android's notifications off for Taily, a sync sets nothing; turned back on in Android's settings, the
  // nudges come back as Taily does, not only on the next new day or entry
  const [returns, setReturns] = useState(0)
  useEffect(() => onReturn(() => setReturns((n) => n + 1)), [])

  useEffect(() => {
    if (loggedToday === undefined) return
    const timer = window.setTimeout(() => void syncDailyReminder(time, loggedToday), 400)
    return () => window.clearTimeout(timer)
  }, [time, loggedToday, today, returns])

  // Lent & borrowed's reminders follow its records wherever they change: it opens from Insights too, where a new
  // reminder waited, and a settled one still went off, until Home was next shown
  const loans = useLiveQuery(() => db.loans.toArray(), [])
  useEffect(() => {
    if (loans) void syncLoanReminders(loans)
  }, [loans])
  // coming back is said twice on Android (the page and the activity): one sync for both
  useEffect(() => {
    if (!loans || returns === 0) return
    const timer = window.setTimeout(() => void syncLoanReminders(loans, { ask: false }), 400)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returns])

  return null
}
