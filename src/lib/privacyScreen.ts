// While app lock is on, Android keeps Taily out of the recent-apps preview,
// screenshots and screen recordings (FLAG_SECURE, set by the small native
// PrivacyScreen plugin in android/app/src/main/java/com/tally/expense/).
// The web app has no equivalent, so this is a no-op there.

type PrivacyScreenPlugin = { set(options: { enabled: boolean }): Promise<void> }
let plugin: PrivacyScreenPlugin | null = null

export async function syncPrivacyScreen(enabled: boolean): Promise<void> {
  try {
    const { Capacitor, registerPlugin } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) return
    plugin ??= registerPlugin<PrivacyScreenPlugin>('PrivacyScreen')
    await plugin.set({ enabled })
  } catch {
    /* a native shell without the plugin: nothing to toggle */
  }
}
