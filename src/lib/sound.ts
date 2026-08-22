// Synthesized UI sound — one curated watery "pop" voice, no audio files.
// Gated by the Sounds toggle.

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
    ctx ??= new AudioContext()
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
