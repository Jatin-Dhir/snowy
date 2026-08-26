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

/**
 * onPartial fires for the live caption as speech comes in (always the
 * recognizer's own top guess, for responsiveness). pickBest, if given,
 * chooses the final answer from ALL of the recognizer's ranked alternates
 * (both backends are asked for 3) instead of blindly trusting the first —
 * e.g. the caller can prefer whichever alternate actually parses into a
 * valid transaction.
 */
export async function listenOnce(
  onPartial: (text: string) => void,
  pickBest?: (candidates: string[]) => string
): Promise<VoiceOutcome> {
  const choose = (candidates: string[]) => (candidates.length === 0 ? '' : pickBest ? pickBest(candidates) : candidates[0])

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
      // maxResults:3 asks for 3 ranked alternates — keep all of them, not
      // just the top guess, so a mis-heard word has two more chances.
      let lastMatches: string[] = []
      const partialSub = await SpeechRecognition.addListener('partialResults', (data: { matches?: string[] }) => {
        if (data.matches && data.matches.length > 0) {
          lastMatches = data.matches
          onPartial(data.matches[0])
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
        const done = () => {
          const text = choose(lastMatches)
          finish(text ? { ok: true, text } : { ok: false, reason: 'nothing' })
        }
        void SpeechRecognition.addListener('listeningState', (data: { status: string }) => {
          if (data.status === 'stopped') done()
        })
        // safety net: some devices/OEMs don't reliably emit listeningState —
        // force a stop so the recognizer doesn't linger if we're giving up on it
        timeoutId = window.setTimeout(() => {
          void SpeechRecognition.stop().catch(() => undefined)
          done()
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
    rec.maxAlternatives = 3
    let lastMatches: string[] = []
    rec.onresult = (e) => {
      const last = e.results[e.results.length - 1]
      const alts: string[] = []
      for (let j = 0; j < last.length; j++) alts.push(last[j].transcript.trim())
      if (alts[0]) {
        lastMatches = alts.filter(Boolean)
        onPartial(alts[0])
      }
    }
    rec.onerror = (e) => {
      stopper = null
      resolve({ ok: false, reason: e.error === 'not-allowed' ? 'denied' : e.error === 'no-speech' ? 'nothing' : 'error' })
    }
    rec.onend = () => {
      stopper = null
      const text = choose(lastMatches)
      resolve(text ? { ok: true, text } : { ok: false, reason: 'nothing' })
    }
    stopper = () => rec.stop()
    rec.start()
  })
}
