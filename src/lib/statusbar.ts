// Explicit status-bar control. Capacitor's default edge-to-edge behavior on
// Android varies across OS/WebView versions — on some older devices the app
// doesn't draw under the status bar at all, leaving a plain gap above the
// content instead of true full-screen coverage. Setting this directly at
// boot (and whenever the theme changes) makes it deterministic everywhere.
export async function syncStatusBar(dark: boolean): Promise<void> {
  try {
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) return
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    await StatusBar.setOverlaysWebView({ overlay: true })
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light })
  } catch {
    /* not native, or the plugin isn't present on this platform build */
  }
}
