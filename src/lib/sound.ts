// Tiny synthesized UI sounds — no audio files, just a lazy AudioContext.
// Gated by the user's Sounds toggle (mirrored to localStorage by App).

export function fxSettings(): { haptics: boolean; sounds: boolean } {
  try {
    const raw = localStorage.getItem('tally.fx')
    if (raw) return { haptics: true, sounds: true, ...JSON.parse(raw) }
  } catch {
    /* fall through */
  }
  return { haptics: true, sounds: true }
}

let ctx: AudioContext | null = null

function tone(freq: number, startIn: number, dur: number, vol: number, type: OscillatorType = 'sine') {
  if (!ctx) return
  const t0 = ctx.currentTime + startIn
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  gain.gain.setValueAtTime(0.0001, t0)
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.008)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(gain).connect(ctx.destination)
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
}

export function playSound(kind: 'light' | 'medium' | 'heavy' | 'success' | 'selection'): void {
  if (!fxSettings().sounds) return
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    switch (kind) {
      case 'light':
        tone(1250, 0, 0.045, 0.045, 'triangle')
        break
      case 'selection':
        tone(950, 0, 0.04, 0.04, 'triangle')
        break
      case 'medium':
        tone(640, 0, 0.06, 0.06, 'sine')
        break
      case 'heavy':
        tone(340, 0, 0.09, 0.08, 'sine')
        break
      case 'success':
        tone(880, 0, 0.08, 0.06, 'sine')
        tone(1318.5, 0.07, 0.14, 0.05, 'sine')
        break
    }
  } catch {
    /* audio unavailable */
  }
}
