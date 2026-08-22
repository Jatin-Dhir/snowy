import type { Loan } from '../db/db'
import { formatMinor } from './money'

// System notifications (native app only). Each alert key notifies once ever.
export async function notifyAlerts(alerts: { key: string; text: string }[]): Promise<void> {
  try {
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) return
    const { LocalNotifications } = await import('@capacitor/local-notifications')

    const sent = new Set<string>(JSON.parse(localStorage.getItem('tally.notified') ?? '[]'))
    const fresh = alerts.filter((a) => !sent.has(a.key))
    if (fresh.length === 0) return

    let perm = await LocalNotifications.checkPermissions()
    if (perm.display !== 'granted') {
      perm = await LocalNotifications.requestPermissions()
      if (perm.display !== 'granted') return
    }

    await LocalNotifications.schedule({
      notifications: fresh.map((a, i) => ({
        id: (Date.now() % 100000000) + i,
        title: 'Spendy',
        body: a.text
      }))
    })

    for (const a of fresh) sent.add(a.key)
    localStorage.setItem('tally.notified', JSON.stringify([...sent].slice(-100)))
  } catch {
    // notifications unavailable — the dashboard warning still shows
  }
}

function numericId(key: string): number {
  let h = 7
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0
  return 100000000 + (Math.abs(h) % 1000000000)
}

/**
 * Keeps scheduled loan reminders in sync with the ledger (native app only):
 * every outstanding loan with a future reminder gets a system notification
 * at 10:00 that day; settled or deleted loans get theirs cancelled.
 */
export async function syncLoanReminders(loans: Loan[]): Promise<void> {
  try {
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) return
    const { LocalNotifications } = await import('@capacitor/local-notifications')

    const wanted = loans
      .filter((l) => !l.settledISO && l.remindISO)
      .map((l) => ({ ...l, remindISO: l.remindISO as string }))
      .filter((l) => new Date(l.remindISO + 'T10:00:00').getTime() > Date.now())

    if (wanted.length > 0) {
      let perm = await LocalNotifications.checkPermissions()
      if (perm.display !== 'granted') {
        perm = await LocalNotifications.requestPermissions()
        if (perm.display !== 'granted') return
      }
    }

    // cancel anything of ours that is no longer wanted
    const ourIds = new Set(loans.map((l) => numericId(`loan|${l.id}`)))
    const wantedIds = new Set(wanted.map((l) => numericId(`loan|${l.id}`)))
    const pending = await LocalNotifications.getPending()
    const stale = pending.notifications.filter((n) => ourIds.has(n.id) && !wantedIds.has(n.id))
    if (stale.length > 0) {
      await LocalNotifications.cancel({ notifications: stale.map((n) => ({ id: n.id })) })
    }

    if (wanted.length > 0) {
      await LocalNotifications.schedule({
        notifications: wanted.map((l) => ({
          id: numericId(`loan|${l.id}`),
          title: 'Spendy reminder',
          body:
            l.direction === 'lent'
              ? `${l.person} owes you ${formatMinor(l.amountMinor, l.currency)} — time to collect.`
              : `You owe ${l.person} ${formatMinor(l.amountMinor, l.currency)}.`,
          schedule: { at: new Date(l.remindISO + 'T10:00:00') }
        }))
      })
    }
  } catch {
    // native notifications unavailable — Home alerts still cover it
  }
}
