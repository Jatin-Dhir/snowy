import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { fxSettings, playSound } from '../lib/sound'

interface ToastState {
  message: string
  undo?: () => void
  leaving?: boolean
}

interface UiContextValue {
  toast: ToastState | null
  showToast: (message: string, undo?: () => void) => void
  dismissToast: () => void
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

export function UiProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null)
  const timers = useRef<number[]>([])

  const clearTimers = () => {
    for (const t of timers.current) window.clearTimeout(t)
    timers.current = []
  }

  const dismissToast = useCallback(() => {
    clearTimers()
    setToast((t) => (t ? { ...t, leaving: true } : null))
    timers.current.push(window.setTimeout(() => setToast(null), 240))
  }, [])

  const showToast = useCallback((message: string, undo?: () => void) => {
    clearTimers()
    setToast({ message, undo, leaving: false })
    timers.current.push(window.setTimeout(() => setToast((t) => (t ? { ...t, leaving: true } : null)), 2500))
    timers.current.push(window.setTimeout(() => setToast(null), 2760))
  }, [])

  return <UiContext.Provider value={{ toast, showToast, dismissToast }}>{children}</UiContext.Provider>
}

export function useUi(): UiContextValue {
  const ctx = useContext(UiContext)
  if (!ctx) throw new Error('useUi outside UiProvider')
  return ctx
}
