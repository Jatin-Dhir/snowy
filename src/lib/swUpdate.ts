import { registerSW } from 'virtual:pwa-register'

/**
 * The web app's updates. A new version used to take over and reload the page the moment it arrived, and a half-typed
 * entry went with it. Now a new version waits until Taily is out of sight (another tab or app in front, the phone
 * locked) with no sheet or voice screen open and nothing being typed or set up, and only then reloads, so nobody
 * watches the page flash or loses what they were doing. If that moment never comes, the next launch opens the new
 * version anyway: a waiting version takes over once every window on the old one has closed.
 */
export function watchForUpdates(): void {
  let waiting = false
  const update = registerSW({
    immediate: true,
    onNeedRefresh() {
      waiting = true
      applyWhenIdle()
    }
  })

  function busy(): boolean {
    // any sheet (the add sheet, an edit, Settings), the voice screen, or the welcome steps
    if (document.querySelector('.sheet, .voice-layer, .onb-step')) return true
    const field = document.activeElement
    return field instanceof HTMLElement && (field.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(field.tagName))
  }

  function applyWhenIdle() {
    if (!waiting || document.visibilityState !== 'hidden' || busy()) return
    waiting = false
    // the new version takes over, and the page reloads into it: the old page's files are gone from the server, so
    // it mustn't go on running under the new version (the plugin reloads too, but not for a version the browser
    // found by itself)
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true })
    void update(true)
  }

  document.addEventListener('visibilitychange', applyWhenIdle)
}
