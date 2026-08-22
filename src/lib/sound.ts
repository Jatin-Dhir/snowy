// One clean, Apple-like tap sound set — short, dull, quiet. No packs.
// A tap = a tiny burst of band-passed noise plus a low sine "body".

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

/** The signature "tock": filtered noise snap + a low warm thump underneath. */
function tock(ac: AudioContext, snapHz: number, bodyHz: number, dur: number, vol: number, startIn = 0) {
  const t0 = ac.currentTime + startIn
  const src = ac.createBufferSource()
  src.buffer = noiseBuffer(ac)
  const bp = ac.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = snapHz
  bp.Q.value = 3.5
  const lp = ac.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = snapHz * 1.6
  const g = ac.createGain()
  g.gain.setValueAtTime(vol, t0)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  src.connect(bp).connect(lp).connect(g).connect(ac.destination)
  src.start(t0)
  src.stop(t0 + dur + 0.02)

  const osc = ac.createOscillator()
  osc.frequency.setValueAtTime(bodyHz, t0)
  osc.frequency.exponentialRampToValueAtTime(bodyHz * 0.72, t0 + dur * 1.4)
  const og = ac.createGain()
  og.gain.setValueAtTime(0.0001, t0)
  og.gain.exponentialRampToValueAtTime(vol * 0.55, t0 + 0.005)
  og.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * 1.4)
  osc.connect(og).connect(ac.destination)
  osc.start(t0)
  osc.stop(t0 + dur * 1.4 + 0.02)
}

export function playSound(kind: Kind): void {
  if (!fxSettings().sounds) return
  const ac = ensureCtx()
  if (!ac) return
  try {
    if (kind === 'light') tock(ac, 1450, 260, 0.038, 0.16)
    else if (kind === 'selection') tock(ac, 1100, 220, 0.034, 0.13)
    else if (kind === 'medium') tock(ac, 820, 180, 0.05, 0.2)
    else if (kind === 'heavy') tock(ac, 540, 135, 0.07, 0.24)
    else {
      tock(ac, 880, 210, 0.045, 0.15)
      tock(ac, 1240, 320, 0.06, 0.14, 0.09)
    }
  } catch {
    /* audio unavailable */
  }
}
