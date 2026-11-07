// Android's back button, one press at a time: it closes whatever opened last (a sheet,
// the sheet inside it, the voice screen), and with nothing open it leaves Taily the way
// Android's own apps do: to the background, still warm.
//
// One listener for the whole app. Capacitor calls every backButton listener at once,
// and as soon as there is one its own handling stops; with none, that handling only
// stepped back in the web view's history, which Taily never has, so Back did nothing.
import { DISTRIBUTION } from './distribution'

const stack: { close: () => void; keep: boolean }[] = []

/**
 * What Back does while something is open; call the returned function when it closes.
 * The entry leaves the stack the moment Back uses it, so two quick presses close two
 * things even before the first has finished closing. `keep` stays until removed (the
 * lock screen: Back never reaches what's behind it).
 */
export function onBack(close: () => void, keep = false): () => void {
  const entry = { close, keep }
  stack.push(entry)
  return () => {
    const i = stack.lastIndexOf(entry)
    if (i >= 0) stack.splice(i, 1)
  }
}

/** Taily to the background, as Back does at the root of any Android app. */
export async function leaveApp(): Promise<void> {
  try {
    const { App } = await import('@capacitor/app')
    await App.minimizeApp()
  } catch {
    /* not native */
  }
}

/**
 * Once, at startup. Escape is Back for a keyboard: the same stack, one layer a press. With
 * nothing open it does nothing, and the lock screen isn't something it can leave.
 */
export function listenForEscape(): void {
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.repeat || e.isComposing) return
    const top = stack[stack.length - 1]
    if (!top || top.keep) return
    stack.pop()
    top.close()
  })
}

let listening = false

/** Once, at startup. Android only: the web build has no back button to take over. */
export async function listenForBack(): Promise<void> {
  if (listening || DISTRIBUTION === 'web') return
  listening = true
  try {
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) return
    const { App } = await import('@capacitor/app')
    await App.addListener('backButton', ({ canGoBack }) => {
      const top = stack[stack.length - 1]
      if (top) {
        if (!top.keep) stack.pop()
        top.close()
      } else if (canGoBack) window.history.back()
      else void leaveApp()
    })
  } catch {
    /* not native */
  }
}
