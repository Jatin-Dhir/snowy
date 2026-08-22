// Synthesized UI sounds — four curated packs, no audio files.
// 'tap' soft thock (default) · 'click' crisp mechanical · 'pop' watery ·
// 'wood' warm marimba knock. Gated by the Sounds toggle.

export interface FxSettings {
  haptics: boolean
  sounds: boolean
  soundPack: 'tap' | 'click' | 'pop' | 'wood'
}

export function fxSettings(): FxSettings {
  try {
    const raw = localStorage.getItem('tally.fx')
    if (raw) return { haptics: true, sounds: true, soundPack: 'tap', ...JSON.parse(raw) }
  } catch {
    /* fall through */
  }
  return { haptics: true, sounds: true, soundPack: 'tap' }
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
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.08, ac.sampleRate)
    const data = noiseBuf.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  }
  return noiseBuf
}

function snap(ac: AudioContext, freq: number, q: number, dur: number, vol: number, startIn = 0) {
  const t0 = ac.currentTime + startIn
  const src = ac.createBufferSource()
  src.buffer = noiseBuffer(ac)
  const bp = ac.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = freq
  bp.Q.value = q
  const g = ac.createGain()
  g.gain.setValueAtTime(vol, t0)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  src.connect(bp).connect(g).connect(ac.destination)
  src.start(t0)
  src.stop(t0 + dur + 0.02)
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

function marimba(ac: AudioContext, freq: number, dur: number, vol: number, startIn = 0) {
  const t0 = ac.currentTime + startIn
  for (const [mult, v] of [
    [1, vol],
    [2.76, vol * 0.3],
    [5.4, vol * 0.1]
  ] as const) {
    const osc = ac.createOscillator()
    osc.frequency.value = freq * mult
    const g = ac.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(v, t0 + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur / Math.sqrt(mult))
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
    const pack = fx.soundPack
    if (pack === 'click') {
      if (kind === 'light') snap(ac, 2600, 8, 0.022, 0.2)
      else if (kind === 'selection') snap(ac, 2100, 8, 0.02, 0.16)
      else if (kind === 'medium') snap(ac, 1500, 6, 0.03, 0.24)
      else if (kind === 'heavy') snap(ac, 900, 5, 0.045, 0.28)
      else {
        snap(ac, 2000, 7, 0.025, 0.18)
        snap(ac, 2800, 7, 0.03, 0.16, 0.09)
      }
    } else if (pack === 'pop') {
      if (kind === 'light') body(ac, 820, 0.05, 0.17, 0, 0.36)
      else if (kind === 'selection') body(ac, 660, 0.05, 0.14, 0, 0.38)
      else if (kind === 'medium') body(ac, 500, 0.07, 0.2, 0, 0.34)
      else if (kind === 'heavy') body(ac, 330, 0.09, 0.24, 0, 0.34)
      else {
        body(ac, 420, 0.07, 0.16, 0, 1.9)
        body(ac, 620, 0.09, 0.15, 0.08, 1.9)
      }
    } else if (pack === 'wood') {
      if (kind === 'light') marimba(ac, 740, 0.12, 0.14)
      else if (kind === 'selection') marimba(ac, 620, 0.11, 0.12)
      else if (kind === 'medium') marimba(ac, 490, 0.15, 0.17)
      else if (kind === 'heavy') marimba(ac, 370, 0.19, 0.2)
      else {
        marimba(ac, 590, 0.14, 0.14)
        marimba(ac, 780, 0.18, 0.13, 0.09)
      }
    } else {
      // 'tap' — the soft default thock
      if (kind === 'light') {
        snap(ac, 1450, 3.5, 0.038, 0.16)
        body(ac, 260, 0.05, 0.09)
      } else if (kind === 'selection') {
        snap(ac, 1100, 3.5, 0.034, 0.13)
        body(ac, 220, 0.05, 0.07)
      } else if (kind === 'medium') {
        snap(ac, 820, 3.5, 0.05, 0.2)
        body(ac, 180, 0.07, 0.11)
      } else if (kind === 'heavy') {
        snap(ac, 540, 3.5, 0.07, 0.24)
        body(ac, 135, 0.1, 0.13)
      } else {
        snap(ac, 880, 3.5, 0.045, 0.15)
        snap(ac, 1240, 3.5, 0.06, 0.14, 0.09)
        body(ac, 300, 0.08, 0.08, 0.09)
      }
    }
  } catch {
    /* audio unavailable */
  }
}
