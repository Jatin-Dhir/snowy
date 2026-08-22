// Synthesized UI sounds — three selectable packs, no audio files.
// 'click' = soft physical taps (filtered noise), 'pop' = watery pitch-drops,
// 'chime' = gentle musical plucks. Gated by the Sounds toggle.

export interface FxSettings {
  haptics: boolean
  sounds: boolean
  soundPack: 'click' | 'pop' | 'chime'
}

export function fxSettings(): FxSettings {
  try {
    const raw = localStorage.getItem('tally.fx')
    if (raw) return { haptics: true, sounds: true, soundPack: 'click', ...JSON.parse(raw) }
  } catch {
    /* fall through */
  }
  return { haptics: true, sounds: true, soundPack: 'click' }
}

type Kind = 'light' | 'medium' | 'heavy' | 'success' | 'selection'

let ctx: AudioContext | null = null
let noiseBuf: AudioBuffer | null = null

function ensureCtx(): AudioContext | null {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

function noiseBuffer(ac: AudioContext): AudioBuffer {
  if (!noiseBuf) {
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.1, ac.sampleRate)
    const data = noiseBuf.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  }
  return noiseBuf
}

/** A soft physical tap: a short burst of noise through a band-pass filter. */
function tap(ac: AudioContext, freq: number, dur: number, vol: number, startIn = 0) {
  const t0 = ac.currentTime + startIn
  const src = ac.createBufferSource()
  src.buffer = noiseBuffer(ac)
  const bp = ac.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = freq
  bp.Q.value = 5
  const g = ac.createGain()
  g.gain.setValueAtTime(vol, t0)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  src.connect(bp).connect(g).connect(ac.destination)
  src.start(t0)
  src.stop(t0 + dur + 0.02)
}

/** A watery pop: a sine sliding quickly between two pitches. */
function drop(ac: AudioContext, f1: number, f2: number, dur: number, vol: number, startIn = 0) {
  const t0 = ac.currentTime + startIn
  const osc = ac.createOscillator()
  osc.frequency.setValueAtTime(f1, t0)
  osc.frequency.exponentialRampToValueAtTime(f2, t0 + dur)
  const g = ac.createGain()
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.006)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(g).connect(ac.destination)
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
}

/** A gentle pluck: sine with a long exponential decay and a hint of octave. */
function pluck(ac: AudioContext, freq: number, dur: number, vol: number, startIn = 0) {
  const t0 = ac.currentTime + startIn
  for (const [mult, v] of [
    [1, vol],
    [2, vol * 0.25]
  ] as const) {
    const osc = ac.createOscillator()
    osc.frequency.value = freq * mult
    const g = ac.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(v, t0 + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(g).connect(ac.destination)
    osc.start(t0)
    osc.stop(t0 + dur + 0.02)
  }
}

export function playSound(kind: Kind): void {
  const fx = fxSettings()
  if (!fx.sounds) return
  const ac = ensureCtx()
  if (!ac) return
  try {
    if (fx.soundPack === 'click') {
      if (kind === 'light') tap(ac, 2100, 0.035, 0.1)
      else if (kind === 'selection') tap(ac, 1500, 0.035, 0.08)
      else if (kind === 'medium') tap(ac, 950, 0.05, 0.13)
      else if (kind === 'heavy') tap(ac, 520, 0.065, 0.16)
      else {
        tap(ac, 1400, 0.04, 0.09)
        pluck(ac, 1046.5, 0.14, 0.05, 0.03)
      }
    } else if (fx.soundPack === 'pop') {
      if (kind === 'light') drop(ac, 900, 320, 0.05, 0.09)
      else if (kind === 'selection') drop(ac, 700, 280, 0.05, 0.08)
      else if (kind === 'medium') drop(ac, 520, 170, 0.07, 0.11)
      else if (kind === 'heavy') drop(ac, 320, 110, 0.09, 0.13)
      else {
        drop(ac, 380, 780, 0.07, 0.09)
        drop(ac, 560, 1150, 0.09, 0.07, 0.07)
      }
    } else {
      if (kind === 'light') pluck(ac, 1318.5, 0.13, 0.045)
      else if (kind === 'selection') pluck(ac, 1046.5, 0.12, 0.04)
      else if (kind === 'medium') pluck(ac, 784, 0.16, 0.055)
      else if (kind === 'heavy') pluck(ac, 523.3, 0.2, 0.065)
      else {
        pluck(ac, 1046.5, 0.16, 0.05)
        pluck(ac, 1318.5, 0.16, 0.045, 0.07)
        pluck(ac, 1568, 0.22, 0.04, 0.14)
      }
    }
  } catch {
    /* audio unavailable */
  }
}
