// Erase everything Taily keeps on this phone, so it can start over from the welcome screen: every profile's
// database, the list of profiles, the small things kept beside them (dismissed nudges, the PIN's try count, the
// last exchange rate), and any reminder still waiting to go off. A Taily Pro unlock stays: it belongs to the
// person's Google account, not to their records, and they'd only have to restore it again.
import Dexie from 'dexie'
import { dbNameFor, loadProfiles } from './profiles'

const KEEP = new Set(['taily.pro', 'taily.pro.code'])

/** True for a database Taily made: the first profile's "tally" and every other profile's "tally-p-…". */
const isOurs = (name: string) => name === 'tally' || name.startsWith('tally-p-')

export async function eraseEverything(): Promise<void> {
  // reminders first: a loan's reminder would still go off after its loan is gone
  try {
    const { Capacitor } = await import('@capacitor/core')
    if (Capacitor.isNativePlatform()) {
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      const pending = await LocalNotifications.getPending()
      if (pending.notifications.length > 0) {
        await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) })
      }
      await LocalNotifications.removeAllDeliveredNotifications().catch(() => undefined)
    }
  } catch {
    /* no notifications on this platform */
  }

  // the home-screen widget and the Quick Settings tile keep this month's totals beside the app. They go now, not when
  // Taily next starts at its welcome screen: closed before that, they'd go on showing the erased money
  try {
    const { forgetWidget } = await import('./widget')
    await forgetWidget()
  } catch {
    /* no widget on this platform */
  }

  // IndexedDB won't delete a database while a connection to it is open, and ours is
  const { db } = await import('../db/db')
  db.close()
  const names = new Set(loadProfiles().list.map((p) => dbNameFor(p.id)))
  try {
    // a profile deleted while something held its database open can leave one behind
    for (const d of (await indexedDB.databases?.()) ?? []) if (d.name && isOurs(d.name)) names.add(d.name)
  } catch {
    /* this browser can't list its databases: the profile list is enough */
  }
  for (const name of names) await Dexie.delete(name)

  for (const key of Object.keys(localStorage)) {
    if ((key.startsWith('taily.') || key.startsWith('tally.')) && !KEEP.has(key)) localStorage.removeItem(key)
  }
}
