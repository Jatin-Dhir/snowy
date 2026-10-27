// Speech capture, one session at a time. The Android app uses Taily's own
// Voice plugin (android/app/src/main/java/com/tally/expense/VoicePlugin.java)
// on the phone's recognizer, so there is no server of ours; the web app uses
// the browser's SpeechRecognition where it exists.
//
// A session reports its phase (starting → ready, the microphone is open →
// speech → processing), the microphone level (Android only), the live
// caption, and then exactly one ending: the recognizer's final transcript with
// its ranked alternates, or a reason it couldn't get one.
import type { PluginListenerHandle } from '@capacitor/core'

export type VoicePhase = 'starting' | 'ready' | 'speech' | 'processing'
export type VoiceFailure =
  | 'nothing'
  | 'denied'
  | 'blocked'
  | 'unavailable'
  | 'network'
  | 'busy'
  | 'audio'
  | 'interrupted'
  | 'error'

export interface Alternative {
  text: string
  /** the recognizer's own confidence, 0..1, or -1 when it gave none */
  confidence: number
}

export interface VoiceHandlers {
  phase(phase: VoicePhase): void
  level(level: number): void
  caption(text: string): void
  result(alternatives: Alternative[]): void
  failed(reason: VoiceFailure): void
}

export interface VoiceSession {
  /** Finish listening: what was said so far becomes the answer. */
  stop(): void
  /** End without an answer. Nothing more is reported. */
  cancel(): void
  /** whether this session reports the microphone level */
  readonly levels: boolean
}

export interface VoiceOptions {
  /** the person is holding the button: keep listening through pauses until stop() */
  hold: boolean
  language?: string
}

/** A launch from the widget, the tile or the shortcut, picked up by the app. */
export interface VoiceLaunch {
  source: string
  /** The session that started listening before the app had loaded, or null if none did. */
  attach(on: VoiceHandlers): VoiceSession | null
}

const LANGUAGE = 'en-IN'

/* ------------------------------------------------------------------ native */

interface NativeEvent {
  session: number
  seq?: number
  type: 'state' | 'level' | 'partial' | 'result' | 'failed'
  state?: string
  level?: number
  text?: string
  matches?: string[]
  confidences?: number[]
  reason?: string
}

interface NativeSnapshot {
  session: number
  seq?: number
  source: string
  state?: string
  partial?: string
  result?: { matches: string[]; confidences: number[] }
  error?: string
}

type MicState = 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale'

export interface WidgetAppearance {
  accent: string
  onAccent: string
  accentNight: string
  onAccentNight: string
}

interface VoicePlugin {
  available(): Promise<{ available: boolean }>
  checkPermissions(): Promise<{ microphone: MicState }>
  requestPermissions(): Promise<{ microphone: MicState }>
  start(options: { hold: boolean; language: string }): Promise<{ session: number }>
  stop(options: { session: number }): Promise<void>
  cancel(options: { session: number }): Promise<void>
  takeLaunch(): Promise<{ launched: boolean; source?: string; snapshot?: NativeSnapshot }>
  setPrefs(options: { instant?: boolean; haptics?: boolean; language?: string; appearance?: WidgetAppearance }): Promise<void>
  openSettings(): Promise<void>
  shortcuts(): Promise<{ widget: boolean; tile: boolean }>
  pinWidget(): Promise<{ shown: boolean }>
  addTile(): Promise<{ result: 'added' | 'already' | 'dismissed' | 'unsupported' | 'error' }>
  addListener(event: 'voice', listener: (e: NativeEvent) => void): Promise<PluginListenerHandle>
  addListener(event: 'voiceLaunch', listener: (e: { source: string }) => void): Promise<PluginListenerHandle>
}

let plugin: Promise<VoicePlugin | null> | null = null

function native(): Promise<VoicePlugin | null> {
  plugin ??= (async () => {
    try {
      const { Capacitor, registerPlugin } = await import('@capacitor/core')
      return Capacitor.isNativePlatform() ? registerPlugin<VoicePlugin>('Voice') : null
    } catch {
      return null
    }
  })()
  return plugin
}

// One listener for the plugin's events, for the app's whole life. An event for
// a session nobody has claimed yet (the answer to start() is still on its way,
// or a widget launch the app hasn't picked up) waits here until it's claimed.
const claimed = new Map<number, (e: NativeEvent) => void>()
const waiting = new Map<number, NativeEvent[]>()
let listening: Promise<void> | null = null

function listen(api: VoicePlugin): Promise<void> {
  listening ??= api
    .addListener('voice', (e) => {
      const owner = claimed.get(e.session)
      if (owner) {
        owner(e)
        return
      }
      if (e.type === 'level') return
      const queue = waiting.get(e.session) ?? []
      queue.push(e)
      if (queue.length > 200) queue.shift()
      waiting.set(e.session, queue)
    })
    .then(() => undefined)
  return listening
}

function failure(reason: string | undefined): VoiceFailure {
  const known: VoiceFailure[] = ['nothing', 'denied', 'blocked', 'unavailable', 'network', 'busy', 'audio', 'interrupted']
  return known.includes(reason as VoiceFailure) ? (reason as VoiceFailure) : 'error'
}

function phaseOf(state: string | undefined): VoicePhase | null {
  return state === 'starting' || state === 'ready' || state === 'speech' || state === 'processing' ? state : null
}

function alternatives(matches: string[] = [], confidences: number[] = []): Alternative[] {
  return matches.map((text, i) => ({ text, confidence: confidences[i] ?? -1 }))
}

/** Wires one native session to its handlers; `seq` drops anything the snapshot already covered. */
function bind(api: VoicePlugin, on: VoiceHandlers) {
  let id: number | null = null
  let lastSeq = 0
  let over = false

  const end = () => {
    over = true
    if (id !== null) {
      claimed.delete(id)
      waiting.delete(id)
    }
  }

  const apply = (e: NativeEvent) => {
    if (over) return
    if (e.type === 'level') {
      on.level(e.level ?? 0)
      return
    }
    if (e.seq !== undefined) {
      if (e.seq <= lastSeq) return
      lastSeq = e.seq
    }
    if (e.type === 'state') {
      const phase = phaseOf(e.state)
      if (phase) on.phase(phase)
    } else if (e.type === 'partial') {
      if (e.text) on.caption(e.text)
    } else if (e.type === 'result') {
      end()
      on.result(alternatives(e.matches, e.confidences))
    } else if (e.type === 'failed') {
      end()
      on.failed(failure(e.reason))
    }
  }

  const own = (session: number) => {
    id = session
    claimed.set(session, apply)
    const early = waiting.get(session) ?? []
    waiting.delete(session)
    for (const e of early) apply(e)
  }

  const fromSnapshot = (s: NativeSnapshot) => {
    lastSeq = s.seq ?? 0
    if (s.result) {
      on.result(alternatives(s.result.matches, s.result.confidences))
      end()
      return
    }
    if (s.error) {
      on.failed(failure(s.error))
      end()
      return
    }
    const phase = phaseOf(s.state)
    if (phase) on.phase(phase)
    if (s.partial) on.caption(s.partial)
  }

  return {
    get id() {
      return id
    },
    get over() {
      return over
    },
    own,
    end,
    fromSnapshot
  }
}

function nativeSession(api: VoicePlugin, options: VoiceOptions, on: VoiceHandlers): VoiceSession {
  const link = bind(api, on)
  let stopWanted = false
  let cancelled = false
  void (async () => {
    try {
      await listen(api)
      const { session } = await api.start({ hold: options.hold, language: options.language ?? LANGUAGE })
      if (cancelled) {
        waiting.delete(session)
        void api.cancel({ session })
        return
      }
      link.own(session)
      if (stopWanted && !link.over) void api.stop({ session })
    } catch (err) {
      if (cancelled) return
      const code = (err as { code?: string }).code
      link.end()
      on.failed(code === 'denied' ? 'denied' : code === 'unavailable' ? 'unavailable' : 'error')
    }
  })()
  return {
    levels: true,
    stop() {
      if (link.over) return
      if (link.id === null) stopWanted = true
      else void api.stop({ session: link.id })
    },
    cancel() {
      if (link.over || cancelled) return
      cancelled = true
      const id = link.id
      link.end()
      if (id !== null) void api.cancel({ session: id })
    }
  }
}

/* ------------------------------------------------------------------ web */

type WebRecognition = {
  lang: string
  interimResults: boolean
  continuous: boolean
  maxAlternatives: number
  onaudiostart: (() => void) | null
  onspeechstart: (() => void) | null
  onresult:
    | ((e: { results: ArrayLike<ArrayLike<{ transcript: string; confidence: number }> & { isFinal: boolean }> }) => void)
    | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

function webRecognizer(): (new () => WebRecognition) | null {
  const w = window as unknown as { SpeechRecognition?: new () => WebRecognition; webkitSpeechRecognition?: new () => WebRecognition }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

function webSession(options: VoiceOptions, on: VoiceHandlers): VoiceSession {
  const Ctor = webRecognizer()
  const silent: VoiceSession = { levels: false, stop() {}, cancel() {} }
  if (!Ctor) {
    queueMicrotask(() => on.failed('unavailable'))
    return silent
  }
  const rec = new Ctor()
  rec.lang = options.language ?? LANGUAGE
  rec.interimResults = true
  // keeps listening through pauses; Taily decides when it's over
  rec.continuous = true
  rec.maxAlternatives = 5
  let over = false
  let cancelled = false
  let text = ''
  let alts: Alternative[] | null = null

  const finish = (reason?: VoiceFailure) => {
    if (over || cancelled) return
    over = true
    if (text) on.result(alts ?? [{ text, confidence: -1 }])
    else on.failed(reason ?? 'nothing')
  }

  rec.onaudiostart = () => !over && on.phase('ready')
  rec.onspeechstart = () => !over && on.phase('speech')
  rec.onresult = (e) => {
    if (over) return
    const parts: string[] = []
    for (let i = 0; i < e.results.length; i++) parts.push(e.results[i][0].transcript.trim())
    text = parts.filter(Boolean).join(' ')
    // the ranked alternates only mean something for a sentence the browser heard in one piece
    const only = e.results.length === 1 ? e.results[0] : null
    alts = only?.isFinal
      ? Array.from({ length: only.length }, (_, j) => ({ text: only[j].transcript.trim(), confidence: only[j].confidence ?? -1 })).filter((a) => a.text)
      : null
    if (text) on.caption(text)
  }
  rec.onerror = (e) => {
    const reason: VoiceFailure =
      e.error === 'not-allowed'
        ? 'denied'
        : e.error === 'service-not-allowed' || e.error === 'language-not-supported'
          ? 'unavailable'
          : e.error === 'no-speech'
            ? 'nothing'
            : e.error === 'audio-capture'
              ? 'audio'
              : e.error === 'network'
                ? 'network'
                : e.error === 'aborted'
                  ? 'interrupted'
                  : 'error'
    finish(reason)
  }
  rec.onend = () => finish()
  try {
    rec.start()
  } catch {
    queueMicrotask(() => finish('error'))
  }
  return {
    levels: false,
    stop() {
      if (over) return
      on.phase('processing')
      try {
        rec.stop()
      } catch {
        finish()
      }
    },
    cancel() {
      if (over) return
      cancelled = true
      over = true
      try {
        rec.abort()
      } catch {
        /* already stopped */
      }
    }
  }
}

/* ------------------------------------------------------------------ public */

/** Starts listening now. The returned session can be stopped or cancelled at once. */
export function startVoice(options: VoiceOptions, on: VoiceHandlers): VoiceSession {
  let inner: VoiceSession | null = null
  let stopWanted = false
  let cancelled = false
  void native().then((api) => {
    if (cancelled) return
    inner = api ? nativeSession(api, options, on) : webSession(options, on)
    if (stopWanted) inner.stop()
  })
  return {
    get levels() {
      return inner?.levels ?? false
    },
    stop() {
      if (inner) inner.stop()
      else stopWanted = true
    },
    cancel() {
      cancelled = true
      inner?.cancel()
    }
  }
}

export async function voiceAvailable(): Promise<boolean> {
  const api = await native()
  if (!api) return webRecognizer() !== null
  try {
    return (await api.available()).available
  } catch {
    return false
  }
}

/**
 * Microphone permission, asking for it if `ask` and it hasn't been refused for
 * good. 'blocked' means Android won't ask again: only Settings can allow it.
 * The browser asks for itself when listening starts.
 */
export async function microphone(ask: boolean): Promise<'granted' | 'prompt' | 'denied' | 'blocked'> {
  const api = await native()
  if (!api) return 'granted'
  try {
    const now = (await api.checkPermissions()).microphone
    if (now === 'granted') return 'granted'
    if (!ask) return 'prompt'
    const after = (await api.requestPermissions()).microphone
    if (after === 'granted') return 'granted'
    return after === 'denied' ? 'blocked' : 'denied'
  } catch {
    return 'denied'
  }
}

/** A launch from the widget, the tile or the shortcut, taken once. */
export async function takeVoiceLaunch(): Promise<VoiceLaunch | null> {
  const api = await native()
  if (!api) return null
  try {
    // listening first, so nothing said between the snapshot and the screen is lost
    await listen(api)
    const launch = await api.takeLaunch()
    if (!launch.launched) return null
    const snapshot = launch.snapshot
    return {
      source: launch.source ?? 'shortcut',
      attach(on) {
        if (!snapshot) return null
        const link = bind(api, on)
        link.fromSnapshot(snapshot)
        if (link.over) waiting.delete(snapshot.session)
        else link.own(snapshot.session)
        return {
          levels: true,
          stop() {
            if (!link.over) void api.stop({ session: snapshot.session })
          },
          cancel() {
            if (link.over) return
            link.end()
            void api.cancel({ session: snapshot.session })
          }
        }
      }
    }
  } catch {
    return null
  }
}

/** Called when the widget or tile is used while Taily is already open. */
export async function onVoiceLaunch(listener: () => void): Promise<() => void> {
  const api = await native()
  if (!api) return () => undefined
  try {
    const handle = await api.addListener('voiceLaunch', () => listener())
    return () => void handle.remove()
  } catch {
    return () => undefined
  }
}

/** What a launch from outside the app needs and can't read for itself. */
export async function setVoicePrefs(prefs: Parameters<VoicePlugin['setPrefs']>[0]): Promise<void> {
  const api = await native()
  if (!api) return
  try {
    await api.setPrefs(prefs)
  } catch {
    /* an older native shell without the plugin */
  }
}

export async function openAppSettings(): Promise<void> {
  const api = await native()
  await api?.openSettings().catch(() => undefined)
}

/** Which of the widget and the tile this phone can add from inside the app; null off Android. */
export async function voiceShortcuts(): Promise<{ widget: boolean; tile: boolean } | null> {
  const api = await native()
  if (!api) return null
  try {
    return await api.shortcuts()
  } catch {
    return null
  }
}

export async function pinVoiceWidget(): Promise<boolean> {
  const api = await native()
  if (!api) return false
  try {
    return (await api.pinWidget()).shown
  } catch {
    return false
  }
}

export async function addVoiceTile(): Promise<'added' | 'already' | 'dismissed' | 'unsupported' | 'error'> {
  const api = await native()
  if (!api) return 'unsupported'
  try {
    return (await api.addTile()).result
  } catch {
    return 'error'
  }
}
