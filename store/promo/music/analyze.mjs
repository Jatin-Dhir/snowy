// Measures a music bed for editing to: tempo, beat phase, how steady the beat is,
// loudness over time (intro / breakdown / ending) and peaks. Reads 16-bit stereo WAV.
import { readFileSync } from 'node:fs'

function readWav(path) {
  const b = readFileSync(path)
  let p = 12
  let fmt = null
  let data = null
  while (p < b.length) {
    const id = b.toString('ascii', p, p + 4)
    const size = b.readUInt32LE(p + 4)
    if (id === 'fmt ') fmt = { channels: b.readUInt16LE(p + 10), rate: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) }
    if (id === 'data') data = b.subarray(p + 8, p + 8 + size)
    p += 8 + size + (size % 2)
  }
  const n = data.length / 2 / fmt.channels
  const mono = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    for (let c = 0; c < fmt.channels; c++) s += data.readInt16LE((i * fmt.channels + c) * 2) / 32768
    mono[i] = s / fmt.channels
  }
  return { rate: fmt.rate, mono }
}

function analyze(path) {
  const { rate, mono } = readWav(path)
  const hop = 480 // 10 ms
  const frames = Math.floor(mono.length / hop)
  // energy per 10 ms, and a crude onset curve from rises in high-passed energy
  const env = new Float32Array(frames)
  const hi = new Float32Array(frames)
  let prev = 0
  for (let f = 0; f < frames; f++) {
    let e = 0
    let h = 0
    for (let i = f * hop; i < (f + 1) * hop; i++) {
      const x = mono[i]
      e += x * x
      const d = x - prev
      prev = x
      h += d * d
    }
    env[f] = Math.sqrt(e / hop)
    hi[f] = Math.sqrt(h / hop)
  }
  const onset = new Float32Array(frames)
  for (let f = 1; f < frames; f++) onset[f] = Math.max(0, Math.log1p(hi[f] * 50) - Math.log1p(hi[f - 1] * 50))

  // tempo: autocorrelation of the onset curve over 70-180 BPM
  const tempoOf = (from, to) => {
    let best = { bpm: 0, score: -1 }
    for (let bpm = 70; bpm <= 180; bpm += 0.25) {
      const lag = 6000 / bpm // in 10 ms frames
      let s = 0
      for (let f = from; f < to - lag - 1; f++) {
        const l = Math.floor(lag)
        const frac = lag - l
        s += onset[f] * (onset[f + l] * (1 - frac) + onset[f + l + 1] * frac)
      }
      if (s > best.score) best = { bpm, score: s }
    }
    return best.bpm
  }
  const whole = tempoOf(0, frames)
  const first = tempoOf(0, Math.floor(frames / 2))
  const second = tempoOf(Math.floor(frames / 2), frames)

  // beat phase: which offset in [0, period) collects the most onset energy
  const period = 6000 / whole
  let phase = { offset: 0, score: -1 }
  for (let o = 0; o < period; o += 0.5) {
    let s = 0
    for (let t = o; t < frames; t += period) s += onset[Math.round(t)] ?? 0
    if (s > phase.score) phase = { offset: o, score: s }
  }

  // loudness per second (dBFS RMS) and peak
  const perSecond = []
  for (let s = 0; s < Math.ceil(frames / 100); s++) {
    let e = 0
    let c = 0
    for (let f = s * 100; f < Math.min(frames, (s + 1) * 100); f++) {
      e += env[f] * env[f]
      c++
    }
    perSecond.push(Math.round(20 * Math.log10(Math.sqrt(e / c) + 1e-9)))
  }
  let peak = 0
  for (const x of mono) peak = Math.max(peak, Math.abs(x))
  // how the track ends: the last 600 ms in 100 ms steps
  const tail = []
  for (let k = 6; k >= 1; k--) {
    let e = 0
    for (let f = frames - k * 10; f < frames - (k - 1) * 10; f++) e += env[f] * env[f]
    tail.push(Math.round(20 * Math.log10(Math.sqrt(e / 10) + 1e-9)))
  }
  return {
    seconds: +(mono.length / rate).toFixed(2),
    bpm: whole,
    bpmHalves: [first, second],
    firstBeatSec: +(phase.offset / 100).toFixed(3),
    peakDb: +(20 * Math.log10(peak)).toFixed(1),
    loudnessBySecond: perSecond.join(' '),
    lastSixTenths: tail.join(' ')
  }
}

for (const f of process.argv.slice(2)) console.log(f, JSON.stringify(analyze(f), null, 1))
