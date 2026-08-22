// One-shot speech capture. Native Android uses the on-device recognizer via
// @capacitor-community/speech-recognition (no server of ours — recognition
// happens on the phone); the web build falls back to webkitSpeechRecognition
// where it exists.

export type VoiceOutcome =
  | { ok: true; text: string }
  | { ok: false; reason: 'unavailable' | 'denied' | 'nothing' | 'error' }

let stopper: (() => void) | null = null

export function stopListening(): void {
  stopper?.()
  stopper = null
}

export async function listenOnce(onPartial: (text: string) => void): Promise<VoiceOutcome> {
  let native = false
  try {
    const { Capacitor } = await import('@capacitor/core')
    native = Capacitor.isNativePlatform()
  } catch {
    /* web */
  }

  if (native) {
    try {
      const { SpeechRecognition } = await import('@capacitor-community/speech-recognition')
      const { available } = await SpeechRecognition.available()
      if (!available) return { ok: false, reason: 'unavailable' }
      const perm = await SpeechRecognition.requestPermissions()
      if (perm.speechRecognition !== 'granted') return { ok: false, reason: 'denied' }

      let last = ''
      const sub = await SpeechRecognition.addListener('partialResults', (data: { matches?: string[] }) => {
        const t = data.matches?.[0]
        if (t) {
          last = t
          onPartial(t)
        }
      })
      stopper = () => {
        void SpeechRecognition.stop().catch(() => undefined)
      }
      try {
        const res = await SpeechRecognition.start({
          language: 'en-IN',
          maxResults: 3,
          partialResults: true,
          popup: false
        })
        const text = res?.matches?.[0] ?? last
        return text ? { ok: true, text } : { ok: false, reason: 'nothing' }
      } finally {
        stopper = null
        void sub.remove()
      }
    } catch {
      return { ok: false, reason: 'error' }
    }
  }

  // web fallback (Chrome only — lets the flow be exercised in the browser)
  type WebRecognition = new () => {
    lang: string
    interimResults: boolean
    maxAlternatives: number
    onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }> }) => void) | null
    onerror: ((e: { error: string }) => void) | null
    onend: (() => void) | null
    start(): void
    stop(): void
    abort(): void
  }
  const Ctor = (window as unknown as { webkitSpeechRecognition?: WebRecognition }).webkitSpeechRecognition
  if (!Ctor) return { ok: false, reason: 'unavailable' }
  return new Promise<VoiceOutcome>((resolve) => {
    const rec = new Ctor()
    rec.lang = 'en-IN'
    rec.interimResults = true
    rec.maxAlternatives = 1
    let final = ''
    rec.onresult = (e) => {
      const parts: string[] = []
      for (let i = 0; i < e.results.length; i++) parts.push(e.results[i][0].transcript)
      const text = parts.join(' ').trim()
      if (text) {
        final = text
        onPartial(text)
      }
    }
    rec.onerror = (e) => {
      stopper = null
      resolve({ ok: false, reason: e.error === 'not-allowed' ? 'denied' : e.error === 'no-speech' ? 'nothing' : 'error' })
    }
    rec.onend = () => {
      stopper = null
      resolve(final ? { ok: true, text: final } : { ok: false, reason: 'nothing' })
    }
    stopper = () => rec.stop()
    rec.start()
  })
}
