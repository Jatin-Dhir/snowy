import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { fxSettings, playKey, playSound, type KeyKind } from '../lib/sound'

interface ToastState {
  message: string
  undo?: () => void
  leaving?: boolean
}

interface UiContextValue {
  toast: ToastState | null
  showToast: (message: string, undo?: () => void) => void
  /** Clears the toast, and any message waiting for it, before a sheet or the voice screen opens. `showNext` is for
   * the toast's own taps: the person closed it, so a message that waited for it shows now. */
  dismissToast: (showNext?: boolean) => void
}

const UiContext = createContext<UiContextValue | null>(null)

export type HapticKind = 'light' | 'medium' | 'heavy' | 'success' | 'selection'

type HapticsModule = typeof import('@capacitor/haptics')
let hapticsReady: Promise<HapticsModule | null> | null = null

function getHaptics(): Promise<HapticsModule | null> {
  if (!hapticsReady) {
    hapticsReady = (async () => {
      try {
        const { Capacitor } = await import('@capacitor/core')
        if (!Capacitor.isNativePlatform()) return null
        return await import('@capacitor/haptics')
      } catch {
        return null
      }
    })()
  }
  return hapticsReady
}

/** Real haptic engine in the app (vibration fallback on the web) + a click sound. */
export function haptic(kind: HapticKind = 'light'): void {
  playSound(kind)
  vibrate(kind)
}

/** A key on Taily's own keypads: the iPhone keyboard's click and the lightest tick. */
export function keyFeedback(kind: KeyKind): void {
  playKey(kind)
  vibrate('light')
}

/** The vibration alone: for moments the microphone could hear a sound. */
export function vibrate(kind: HapticKind = 'light'): void {
  if (!fxSettings().haptics) return
  void getHaptics().then((mod) => {
    if (mod) {
      // Raw timed vibrations: crisp, reliable on every Android, tuned per kind.
      const { Haptics } = mod
      if (kind === 'success') {
        void Haptics.vibrate({ duration: 12 })
        window.setTimeout(() => void Haptics.vibrate({ duration: 14 }), 90)
      } else if (kind === 'heavy') void Haptics.vibrate({ duration: 28 })
      else if (kind === 'medium') void Haptics.vibrate({ duration: 16 })
      else void Haptics.vibrate({ duration: 9 })
      return
    }
    try {
      const pattern =
        kind === 'success' ? [12, 60, 14] : kind === 'heavy' ? 28 : kind === 'medium' ? 16 : 9
      navigator.vibrate?.(pattern as number | number[])
    } catch {
      /* not supported */
    }
  })
}

/** A toast stays up and tappable while it leaves, so a double tap reaches its Undo twice. */
function once(run: () => void): () => void {
  let ran = false
  return () => {
    if (ran) return
    ran = true
    run()
  }
}

export function UiProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null)
  const timers = useRef<number[]>([])
  // An Undo on screen gives way only to a newer Undo. A plain message that comes meanwhile waits here (the newest
  // one, as a newer message replaces an older one) and shows once the Undo has gone, so the Undo isn't lost early
  const undoUp = useRef(false)
  const waiting = useRef<string | null>(null)

  const clearTimers = () => {
    for (const t of timers.current) window.clearTimeout(t)
    timers.current = []
  }

  // the toast slides away; once it's gone, a message that waited for it shows
  const leave = (ms: number) => {
    clearTimers()
    undoUp.current = false
    setToast((t) => (t ? { ...t, leaving: true } : null))
    timers.current.push(
      window.setTimeout(() => {
        const next = waiting.current
        waiting.current = null
        if (next === null) setToast(null)
        else put(next)
      }, ms)
    )
  }

  const put = (message: string, undo?: () => void) => {
    clearTimers()
    undoUp.current = !!undo
    setToast({ message, undo: undo && once(undo), leaving: false })
    // a deleted thing stays one tap from coming back long enough to read, think, and reach for it
    timers.current.push(window.setTimeout(() => leave(260), undo ? 6000 : 3000))
  }

  const dismissToast = useCallback((showNext = false) => {
    if (!showNext) waiting.current = null
    leave(240)
  }, [])

  const showToast = useCallback((message: string, undo?: () => void) => {
    if (!undo && undoUp.current) {
      waiting.current = message
      return
    }
    if (!undo) waiting.current = null
    put(message, undo)
  }, [])

  return <UiContext.Provider value={{ toast, showToast, dismissToast }}>{children}</UiContext.Provider>
}

export function useUi(): UiContextValue {
  const ctx = useContext(UiContext)
  if (!ctx) throw new Error('useUi outside UiProvider')
  return ctx
}
