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

      // with partialResults:true the plugin's own docs say start() "responds
      // directly without result" — it resolves the instant listening begins,
      // before any speech happens. The real transcript only ever arrives via
      // the partialResults event, and the mic keeps listening until stop() is
      // called or the recognizer times out on its own (listeningState event).
      let last = ''
      const partialSub = await SpeechRecognition.addListener('partialResults', (data: { matches?: string[] }) => {
        const t = data.matches?.[0]
        if (t) {
          last = t
          onPartial(t)
        }
      })

      // assign the cancel hook synchronously — a tap on Cancel can land before
      // the listeningState subscription round-trips to native, and a stale
      // (or missing) stopper would leave the mic listening in the background
      stopper = () => {
        void SpeechRecognition.stop().catch(() => undefined)
      }

      const outcome = await new Promise<VoiceOutcome>((resolve) => {
        let settled = false
        let timeoutId: number
        const finish = (o: VoiceOutcome) => {
          if (settled) return
          settled = true
          window.clearTimeout(timeoutId)
          resolve(o)
        }
        void SpeechRecognition.addListener('listeningState', (data: { status: string }) => {
          if (data.status === 'stopped') finish(last ? { ok: true, text: last } : { ok: false, reason: 'nothing' })
        })
        // safety net: some devices/OEMs don't reliably emit listeningState —
        // force a stop so the recognizer doesn't linger if we're giving up on it
        timeoutId = window.setTimeout(() => {
          void SpeechRecognition.stop().catch(() => undefined)
          finish(last ? { ok: true, text: last } : { ok: false, reason: 'nothing' })
        }, 12000)
        void SpeechRecognition.start({ language: 'en-IN', maxResults: 3, partialResults: true, popup: false }).catch(() =>
          finish({ ok: false, reason: 'error' })
        )
      })

      stopper = null
      void partialSub.remove()
      void SpeechRecognition.removeAllListeners()
      return outcome
    } catch {
      stopper = null
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
