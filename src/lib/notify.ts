import type { Loan } from '../db/db'
import { formatMinor } from './money'
import { currentDbName } from './profiles'

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
        title: 'Taily',
        body: a.text,
        // shown now, so there's no alarm to make exact, and asking for one sends the person to
        // Android's settings first (see syncLoanReminders)
        isExactNotification: false
      }))
    })

    for (const a of fresh) sent.add(a.key)
    localStorage.setItem('tally.notified', JSON.stringify([...sent].slice(-100)))
  } catch {
    // notifications unavailable — the dashboard warning still shows
  }
}

/** Whether Taily may post notifications, asking once if Android hasn't been asked yet (native app only). */
export async function canNotify(): Promise<boolean> {
  try {
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) return false
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    let perm = await LocalNotifications.checkPermissions()
    if (perm.display !== 'granted') perm = await LocalNotifications.requestPermissions()
    return perm.display === 'granted'
  } catch {
    return false
  }
}

/**
 * Whether Android lets Taily post notifications right now, without asking: they can be turned off in Android's
 * settings at any time. Null where there's nothing to ask (the web app).
 */
export async function notificationsAllowed(): Promise<boolean | null> {
  try {
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) return null
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    return (await LocalNotifications.checkPermissions()).display === 'granted'
  } catch {
    return null
  }
}

/** Runs `fn` each time Taily comes back to the front, until the returned function is called. */
export function onReturn(fn: () => void): () => void {
  const onVisible = () => {
    if (document.visibilityState === 'visible') fn()
  }
  document.addEventListener('visibilitychange', onVisible)
  // the WebView's own visibility isn't reliable on every Android version: the activity says it too
  let sub: { remove(): void } | undefined
  let disposed = false
  void (async () => {
    try {
      const { Capacitor } = await import('@capacitor/core')
      if (!Capacitor.isNativePlatform()) return
      const { App: CapApp } = await import('@capacitor/app')
      const handle = await CapApp.addListener('appStateChange', ({ isActive }) => isActive && fn())
      if (disposed) void handle.remove()
      else sub = handle
    } catch {
      /* not native */
    }
  })()
  return () => {
    disposed = true
    document.removeEventListener('visibilitychange', onVisible)
    sub?.remove()
  }
}

// a week of daily nudges, one id per day ahead
const DAILY_DAYS = 7
const dailyIds = () => Array.from({ length: DAILY_DAYS }, (_, i) => numericId(`daily|${i}`))
/** What a tap on the daily nudge carries: App opens the add sheet for it. */
export const DAILY_EXTRA = 'log-today'

/**
 * The daily nudge to log (native app only): at `time` ("21:00") on each of the next seven days, skipping today
 * once something's logged or the time has gone. Run again whenever today's entries, the time or the day change,
 * so a day with an entry never gets nudged. Seven days ahead means a week away from Taily ends in silence.
 */
export async function syncDailyReminder(time: string | null, loggedToday: boolean): Promise<void> {
  try {
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) return
    const { LocalNotifications } = await import('@capacitor/local-notifications')

    const ids = dailyIds()
    const pending = await LocalNotifications.getPending()
    const ours = pending.notifications.filter((n) => ids.includes(n.id))
    if (ours.length > 0) await LocalNotifications.cancel({ notifications: ours.map((n) => ({ id: n.id })) })
    if (!time || !/^\d{2}:\d{2}$/.test(time)) return
    if ((await LocalNotifications.checkPermissions()).display !== 'granted') return

    const [hh, mm] = time.split(':').map(Number)
    const now = new Date()
    const days: Date[] = []
    for (let d = 0; days.length < DAILY_DAYS; d++) {
      const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d, hh, mm)
      if (d === 0 && (loggedToday || at.getTime() <= now.getTime())) continue
      days.push(at)
    }
    // exact only where Android allows it without asking (see syncLoanReminders); a nudge a few minutes late is fine
    const { exact_alarm } = await LocalNotifications.checkExactNotificationSetting().catch(() => ({ exact_alarm: 'denied' }))
    await LocalNotifications.schedule({
      notifications: days.map((at, i) => ({
        id: ids[i],
        // the app's name already heads the notification: the title says what it's about
        title: 'Anything to log today?',
        body: "Nothing's in Taily for today yet. Tap and it's three seconds.",
        schedule: { at, allowWhileIdle: true },
        extra: { taily: DAILY_EXTRA },
        isExactNotification: exact_alarm === 'granted'
      }))
    })
  } catch {
    // notifications unavailable: nothing to nudge with
  }
}

function numericId(key: string): number {
  let h = 7
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0
  return 100000000 + (Math.abs(h) % 1000000000)
}

// The loans a profile has reminders waiting for. A deleted loan is gone from the list of loans, so
// without this its reminder can't be told apart from another profile's, and it fires anyway
const scheduledKey = (dbName: string) => `taily.loanReminders.${dbName}`

function scheduledFor(dbName: string): string[] {
  try {
    const ids = JSON.parse(localStorage.getItem(scheduledKey(dbName)) ?? '[]')
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function rememberScheduled(dbName: string, ids: string[]): void {
  try {
    if (ids.length > 0) localStorage.setItem(scheduledKey(dbName), JSON.stringify(ids))
    else localStorage.removeItem(scheduledKey(dbName))
  } catch {
    /* worst case is the old behaviour: a deleted loan's reminder still fires */
  }
}

/** A profile is being deleted: its loans' reminders go with it. */
export async function forgetLoanReminders(dbName: string): Promise<void> {
  const ids = scheduledFor(dbName)
  rememberScheduled(dbName, [])
  if (ids.length === 0) return
  try {
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) return
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    await LocalNotifications.cancel({ notifications: ids.map((id) => ({ id: numericId(`loan|${id}`) })) })
  } catch {
    // native notifications unavailable
  }
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

    // cancel anything of ours that is no longer wanted: settled, no reminder any more, or deleted
    const dbName = currentDbName()
    const ourIds = new Set([...loans.map((l) => l.id), ...scheduledFor(dbName)].map((id) => numericId(`loan|${id}`)))
    const wantedIds = new Set(wanted.map((l) => numericId(`loan|${l.id}`)))
    const pending = await LocalNotifications.getPending()
    const stale = pending.notifications.filter((n) => ourIds.has(n.id) && !wantedIds.has(n.id))
    if (stale.length > 0) {
      await LocalNotifications.cancel({ notifications: stale.map((n) => ({ id: n.id })) })
    }

    if (wanted.length > 0) {
      // Exact only where Android allows it without asking, as below Android 12. Asking (the plugin's
      // default) sends the person to the system "Alarms & reminders" page before anything is set,
      // and Taily's switch there is greyed out: the manifest drops that permission on purpose.
      const { exact_alarm } = await LocalNotifications.checkExactNotificationSetting().catch(() => ({ exact_alarm: 'denied' }))
      await LocalNotifications.schedule({
        notifications: wanted.map((l) => ({
          id: numericId(`loan|${l.id}`),
          title: 'Taily reminder',
          body:
            l.direction === 'lent'
              ? `${l.person} owes you ${formatMinor(l.amountMinor, l.currency)} — time to collect.`
              : `You owe ${l.person} ${formatMinor(l.amountMinor, l.currency)}.`,
          schedule: { at: new Date(l.remindISO + 'T10:00:00') },
          isExactNotification: exact_alarm === 'granted'
        }))
      })
    }
    rememberScheduled(dbName, wanted.map((l) => l.id))
  } catch {
    // native notifications unavailable — Home alerts still cover it
  }
}
