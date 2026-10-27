// UI sounds. Gated by the Sounds toggle.
//
// Typing clicks like an iPhone keyboard: the numpad, the PIN pad and text
// fields play three recordings (a key, a deletion, a space or return), the
// same files and the same level as Studio's typing sound. They were cut from
// an iPhone keyboard recording (Pixabay 336778), one clean click of each kind
// at -18 dBFS; source: studio-workspace public/sounds/key*.wav. Everything
// else is one synthesized watery "pop" voice.
import keyUrl from '../assets/sounds/key.wav'
import deleteUrl from '../assets/sounds/key-delete.wav'
import returnUrl from '../assets/sounds/key-return.wav'

export interface FxSettings {
  haptics: boolean
  sounds: boolean
}

export function fxSettings(): FxSettings {
  try {
    const raw = localStorage.getItem('tally.fx')
    if (raw) return { haptics: true, sounds: true, ...JSON.parse(raw) }
  } catch {
    /* fall through */
  }
  return { haptics: true, sounds: true }
}

type Kind = 'light' | 'medium' | 'heavy' | 'success' | 'selection'

let ctx: AudioContext | null = null

function ensureCtx(): AudioContext | null {
  try {
    ctx ??= new AudioContext({ latencyHint: 'interactive' })
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

function body(ac: AudioContext, freq: number, dur: number, vol: number, startIn = 0, slideTo = 0.72) {
  const t0 = ac.currentTime + startIn
  const osc = ac.createOscillator()
  osc.frequency.setValueAtTime(freq, t0)
  osc.frequency.exponentialRampToValueAtTime(freq * slideTo, t0 + dur)
  const g = ac.createGain()
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.005)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(g).connect(ac.destination)
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
}

export function playSound(kind: Kind): void {
  const fx = fxSettings()
  if (!fx.sounds) return
  const ac = ensureCtx()
  if (!ac) return
  try {
    if (kind === 'light') body(ac, 820, 0.05, 0.17, 0, 0.36)
    else if (kind === 'selection') body(ac, 660, 0.05, 0.14, 0, 0.38)
    else if (kind === 'medium') body(ac, 500, 0.07, 0.2, 0, 0.34)
    else if (kind === 'heavy') body(ac, 330, 0.09, 0.24, 0, 0.34)
    else {
      // success: two rising droplets
      body(ac, 420, 0.07, 0.16, 0, 1.9)
      body(ac, 620, 0.09, 0.15, 0.08, 1.9)
    }
  } catch {
    /* audio unavailable */
  }
}

/* ---------------------------------------------------------------- typing */

/** What was pressed, as the iPhone's keyboard tells it apart. */
export type KeyKind = 'key' | 'delete' | 'return'

const KEY_FILES: Record<KeyKind, string> = { key: keyUrl, delete: deleteUrl, return: returnUrl }
/** Studio's level for its clicks: under the other sounds, since one comes with every key. */
const KEY_GAIN = 0.55
/** Clicks sounding at once, at most: fast typing or a held backspace never piles up. */
const KEY_VOICES = 6
/** A click waits this long for a suspended audio context to wake, then gives up: late is worse than none. */
const WAKE_MS = 80

const decoded = new Map<KeyKind, AudioBuffer>()
let loading: Promise<void> | null = null
let keyVoices = 0

function loadClicks(ac: AudioContext): Promise<void> {
  loading ??= Promise.all(
    (Object.keys(KEY_FILES) as KeyKind[]).map(async (kind) => {
      const res = await fetch(KEY_FILES[kind])
      decoded.set(kind, await ac.decodeAudioData(await res.arrayBuffer()))
    })
  ).then(
    () => undefined,
    () => {
      // try again on the next key rather than staying silent for the session
      loading = null
    }
  )
  return loading
}

function startClick(ac: AudioContext, buffer: AudioBuffer) {
  const src = ac.createBufferSource()
  src.buffer = buffer
  const gain = ac.createGain()
  gain.gain.value = KEY_GAIN
  src.connect(gain).connect(ac.destination)
  keyVoices++
  src.onended = () => {
    keyVoices--
    src.disconnect()
    gain.disconnect()
  }
  src.start()
}

/** The iPhone keyboard's click for a key under the finger. */
export function playKey(kind: KeyKind): void {
  if (!fxSettings().sounds || keyVoices >= KEY_VOICES) return
  const ac = ensureCtx()
  if (!ac) return
  const buffer = decoded.get(kind)
  if (!buffer) {
    // not decoded yet: fetched now, so the next key clicks
    void loadClicks(ac)
    return
  }
  if (ac.state === 'running') {
    startClick(ac, buffer)
    return
  }
  const pressed = performance.now()
  void ac
    .resume()
    .then(() => {
      if (ac.state === 'running' && performance.now() - pressed < WAKE_MS) startClick(ac, buffer)
    })
    .catch(() => undefined)
}

let armed = false

/**
 * Wakes the audio context and decodes the clicks on the first touch or key,
 * the moment a browser allows sound, so the first digit typed already clicks.
 * Called once at startup.
 */
export function armSounds(): void {
  if (armed || typeof window === 'undefined') return
  armed = true
  const wake = () => {
    const ac = ensureCtx()
    if (!ac) return
    void loadClicks(ac)
    window.removeEventListener('pointerdown', wake, true)
    window.removeEventListener('keydown', wake, true)
  }
  window.addEventListener('pointerdown', wake, { capture: true, passive: true })
  window.addEventListener('keydown', wake, { capture: true, passive: true })
}

/** An iPhone or iPad: its own keyboard already clicks, so text fields stay quiet there. */
function appleTouch(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

/** Where typing is typing: a text box or area, never a password. */
function typedInto(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) return !target.readOnly
  if (target instanceof HTMLInputElement) {
    return !target.readOnly && ['text', 'search', 'email', 'url', 'tel', 'number', ''].includes(target.type)
  }
  return false
}

let typingArmed = false

/**
 * Text fields click too, read from what was typed (beforeinput) rather than
 * the keys, so a phone's keyboard clicks as a desk's does: a letter clicks, a
 * space clicks fuller, a deletion its own way. Enter is heard on the key.
 * Pasting and autocorrect are not typing. Called once at startup.
 */
export function armTyping(): void {
  if (typingArmed || typeof window === 'undefined' || appleTouch()) return
  typingArmed = true
  document.addEventListener(
    'beforeinput',
    (event) => {
      if (!typedInto(event.target)) return
      const { inputType, data } = event as InputEvent
      if (inputType.startsWith('delete')) playKey('delete')
      else if (inputType === 'insertText' || inputType === 'insertCompositionText') playKey(data === ' ' ? 'return' : 'key')
    },
    { capture: true, passive: true }
  )
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Enter' && !event.repeat && !event.isComposing && typedInto(event.target)) playKey('return')
    },
    { capture: true, passive: true }
  )
}
