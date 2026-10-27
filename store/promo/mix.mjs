// The soundtrack: the music, plus every sound the film lists (build/film-events.json, written by
// render.mjs) at its moment. The clicks are the app's own recordings (src/assets/sounds); the pops
// and the saved droplets are the app's own synth recipes (src/lib/sound.ts), made here sample for
// sample; the whooshes are filtered noise. Mastered to -14 LUFS with peaks held under -1 dBFS.
//
//   node store/promo/mix.mjs [music.wav]     -> store/promo/build/mix.wav
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..', '..')
const SR = 48000
const film = JSON.parse(readFileSync(join(here, 'build', 'film-events.json'), 'utf8'))
const musicPath = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? join(here, 'music', 'v1.wav')

/* ------------------------------------------------------------------ wav io */

function readWav(path) {
  const buf = readFileSync(path)
  let pos = 12
  let fmt = null
  let data = null
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4)
    const size = buf.readUInt32LE(pos + 4)
    if (id === 'fmt ') {
      fmt = {
        format: buf.readUInt16LE(pos + 8),
        channels: buf.readUInt16LE(pos + 10),
        rate: buf.readUInt32LE(pos + 12),
        bits: buf.readUInt16LE(pos + 22)
      }
      if (fmt.format === 0xfffe) fmt.format = buf.readUInt16LE(pos + 32)
    } else if (id === 'data') data = buf.subarray(pos + 8, pos + 8 + size)
    pos += 8 + size + (size % 2)
  }
  if (!fmt || !data) throw new Error(`${path}: not a wav file`)
  const step = fmt.bits / 8
  const frames = Math.floor(data.length / (step * fmt.channels))
  const ch = Array.from({ length: fmt.channels }, () => new Float32Array(frames))
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < fmt.channels; c++) {
      const o = (i * fmt.channels + c) * step
      ch[c][i] =
        fmt.format === 3
          ? fmt.bits === 64
            ? data.readDoubleLE(o)
            : data.readFloatLE(o)
          : fmt.bits === 16
            ? data.readInt16LE(o) / 32768
            : fmt.bits === 24
              ? data.readIntLE(o, 3) / 8388608
              : data.readInt32LE(o) / 2147483648
    }
  }
  // stereo at 48 kHz, whatever came in
  const stereo = ch.length === 1 ? [ch[0], ch[0]] : ch.slice(0, 2)
  return fmt.rate === SR ? stereo : stereo.map((c) => resample(c, fmt.rate, SR))
}

/** Cubic (Catmull-Rom) resampling: plenty for clicks and a music bed. */
function resample(x, from, to) {
  const n = Math.floor((x.length * to) / from)
  const y = new Float32Array(n)
  const at = (i) => x[Math.min(x.length - 1, Math.max(0, i))]
  for (let i = 0; i < n; i++) {
    const p = (i * from) / to
    const j = Math.floor(p)
    const f = p - j
    const p0 = at(j - 1)
    const p1 = at(j)
    const p2 = at(j + 1)
    const p3 = at(j + 2)
    y[i] = p1 + 0.5 * f * (p2 - p0 + f * (2 * p0 - 5 * p1 + 4 * p2 - p3 + f * (3 * (p1 - p2) + p3 - p0)))
  }
  return y
}

function writeWav(path, [l, r]) {
  const n = l.length
  const out = Buffer.alloc(44 + n * 4)
  out.write('RIFF', 0)
  out.writeUInt32LE(36 + n * 4, 4)
  out.write('WAVEfmt ', 8)
  out.writeUInt32LE(16, 16)
  out.writeUInt16LE(1, 20)
  out.writeUInt16LE(2, 22)
  out.writeUInt32LE(SR, 24)
  out.writeUInt32LE(SR * 4, 28)
  out.writeUInt16LE(4, 32)
  out.writeUInt16LE(16, 34)
  out.write('data', 36)
  out.writeUInt32LE(n * 4, 40)
  let seed = 12345
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
  for (let i = 0; i < n; i++) {
    for (const [c, ch] of [l, r].entries()) {
      // TPDF dither down to 16 bits
      const v = Math.round(ch[i] * 32767 + (rnd() - rnd()))
      out.writeInt16LE(Math.max(-32768, Math.min(32767, v)), 44 + i * 4 + c * 2)
    }
  }
  writeFileSync(path, out)
}

/* ------------------------------------------------------------------ sounds */

const db = (d) => Math.pow(10, d / 20)
const N = Math.ceil(film.duration * SR)
const mix = [new Float32Array(N), new Float32Array(N)]
const sfx = [new Float32Array(N), new Float32Array(N)]

function add(target, [l, r], t, gain = 1, pan = 0) {
  const start = Math.round(t * SR)
  const gl = gain * Math.min(1, 1 - pan)
  const gr = gain * Math.min(1, 1 + pan)
  for (let i = 0; i < l.length; i++) {
    const j = start + i
    if (j < 0 || j >= N) continue
    target[0][j] += l[i] * gl
    target[1][j] += r[i] * gr
  }
}

// the app's typing clicks, at the app's own level (KEY_GAIN 0.55) lifted to sit in a mix
const CLICKS = {
  key: readWav(join(root, 'src', 'assets', 'sounds', 'key.wav')),
  delete: readWav(join(root, 'src', 'assets', 'sounds', 'key-delete.wav')),
  return: readWav(join(root, 'src', 'assets', 'sounds', 'key-return.wav'))
}
const CLICK_GAIN = 0.55 * db(18)

/** The app's synthesized voice (sound.ts body()): a sine gliding to freq*slide, 5 ms rise, exponential fall. */
function pop(freq, dur, vol, slide) {
  const n = Math.round((dur + 0.02) * SR)
  const y = new Float32Array(n)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const s = i / SR
    const f = freq * Math.pow(slide, Math.min(1, s / dur))
    phase += (2 * Math.PI * f) / SR
    const g = s < 0.005 ? 0.0001 * Math.pow(vol / 0.0001, s / 0.005) : s < dur ? vol * Math.pow(0.0001 / vol, (s - 0.005) / (dur - 0.005)) : 0
    y[i] = Math.sin(phase) * g
  }
  return [y, y]
}
const POP_GAIN = db(9)
const RECIPES = {
  820: [0.05, 0.17, 0.36],
  660: [0.05, 0.14, 0.38],
  500: [0.07, 0.2, 0.34],
  330: [0.09, 0.24, 0.34],
  420: [0.07, 0.16, 1.9],
  620: [0.09, 0.15, 1.9]
}
const NAMED = { light: 820, selection: 660, medium: 500, heavy: 330 }

/** Air moving past: noise through a band that sweeps up and back, swelling to `peak` at `crest`. */
function whoosh(dur, lo, hi, crest = 0.62) {
  const n = Math.round(dur * SR)
  const out = [new Float32Array(n), new Float32Array(n)]
  for (let c = 0; c < 2; c++) {
    let seed = 777 + c * 991
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1
    let z1 = 0
    let z2 = 0
    let peak = 0
    for (let i = 0; i < n; i++) {
      const p = i / n
      const sweep = p < crest ? p / crest : 1 - ((p - crest) / (1 - crest)) * 0.5
      const fc = lo * Math.pow(hi / lo, sweep) * (c ? 1.04 : 0.96)
      // a state-variable band-pass, wide
      const f = 2 * Math.sin((Math.PI * fc) / SR)
      const q = 1.1
      const x = rnd()
      const hp = x - z2 - q * z1
      z1 += f * hp
      z2 += f * z1
      const env = p < crest ? Math.pow(Math.sin((p / crest) * Math.PI * 0.5), 2) : Math.pow(Math.cos(((p - crest) / (1 - crest)) * Math.PI * 0.5), 1.6)
      out[c][i] = z1 * env
      peak = Math.max(peak, Math.abs(out[c][i]))
    }
    for (let i = 0; i < n; i++) out[c][i] /= peak || 1
  }
  return out
}
const WHOOSH = whoosh(0.5, 260, 3600)
const SWISH = whoosh(0.24, 1400, 7000, 0.5)

let placed = 0
for (const e of film.events) {
  const g = db(e.db ?? 0)
  if (e.kind === 'key' || e.kind === 'delete' || e.kind === 'return') add(sfx, CLICKS[e.kind], e.t, CLICK_GAIN * g)
  else if (e.kind === 'buffer') {
    // a click the app played: which one, by its length
    const kind = Object.entries(CLICKS).sort((a, b) => Math.abs(a[1][0].length / SR - e.dur) - Math.abs(b[1][0].length / SR - e.dur))[0][0]
    add(sfx, CLICKS[kind], e.t, CLICK_GAIN * g)
  } else if (e.kind === 'osc' || NAMED[e.kind]) {
    const freq = e.kind === 'osc' ? e.freq : NAMED[e.kind]
    const r = RECIPES[freq]
    if (!r) continue
    add(sfx, pop(freq, ...r), e.t, POP_GAIN * g)
  } else if (e.kind === 'success') {
    add(sfx, pop(420, ...RECIPES[420]), e.t, POP_GAIN * g)
    add(sfx, pop(620, ...RECIPES[620]), e.t + 0.08, POP_GAIN * g)
  } else if (e.kind === 'whoosh') add(sfx, WHOOSH, e.t, db(-4) * g)
  else if (e.kind === 'swish') add(sfx, SWISH, e.t, db(-5) * g)
  else continue
  placed++
}

/* ------------------------------------------------------------------ loudness */

/** Integrated loudness, ITU-R BS.1770-4 (K-weighted, gated), for 48 kHz stereo. */
function lufs([l, r]) {
  const kw = (x) => {
    const y = new Float64Array(x.length)
    const stages = [
      [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585],
      [1, -2, 1, -1.99004745483398, 0.99007225036621]
    ]
    let src = x
    for (const [b0, b1, b2, a1, a2] of stages) {
      let x1 = 0
      let x2 = 0
      let y1 = 0
      let y2 = 0
      const out = new Float64Array(src.length)
      for (let i = 0; i < src.length; i++) {
        const v = b0 * src[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2 = x1
        x1 = src[i]
        y2 = y1
        y1 = v
        out[i] = v
      }
      src = out
    }
    y.set(src)
    return y
  }
  const kl = kw(l)
  const kr = kw(r)
  const block = Math.round(0.4 * SR)
  const hop = Math.round(0.1 * SR)
  const z = []
  for (let s = 0; s + block <= kl.length; s += hop) {
    let a = 0
    for (let i = s; i < s + block; i++) a += kl[i] * kl[i] + kr[i] * kr[i]
    z.push(a / block)
  }
  const L = (ms) => -0.691 + 10 * Math.log10(ms)
  const abs = z.filter((ms) => L(ms) > -70)
  const rel = L(abs.reduce((s, x) => s + x, 0) / abs.length) - 10
  const kept = abs.filter((ms) => L(ms) > rel)
  return L(kept.reduce((s, x) => s + x, 0) / kept.length)
}

const peakDb = ([l, r]) => 20 * Math.log10(Math.max(...[l, r].map((c) => c.reduce((m, v) => Math.max(m, Math.abs(v)), 0))))

/** Look-ahead peak limiter: gain rides down ahead of a peak, recovers over `release` seconds. */
function limit([l, r], ceiling, release = 0.08, look = 0.0015) {
  const n = l.length
  const ahead = Math.round(look * SR)
  const need = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const p = Math.max(Math.abs(l[i]), Math.abs(r[i]))
    need[i] = p > ceiling ? ceiling / p : 1
  }
  // the lowest gain needed anywhere in the next `ahead` samples
  const target = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let m = 1
    for (let j = i; j < Math.min(n, i + ahead); j++) m = Math.min(m, need[j])
    target[i] = m
  }
  const rel = Math.exp(-1 / (release * SR))
  const att = Math.exp(-1 / (look * SR * 0.5))
  let g = 1
  for (let i = 0; i < n; i++) {
    g = target[i] < g ? target[i] + (g - target[i]) * att : target[i] + (g - target[i]) * rel
    l[i] *= g
    r[i] *= g
  }
  // anything the smoothing let through, clipped hard (rare, single samples)
  for (const c of [l, r]) for (let i = 0; i < n; i++) c[i] = Math.max(-ceiling, Math.min(ceiling, c[i]))
}

/* ------------------------------------------------------------------ master */

const music = readWav(musicPath)
const musicLufs = lufs(music.map((c) => c.subarray(0, Math.min(c.length, N))))
// the music sits at -15 LUFS before the sounds go on
add(mix, music, 0, db(-15 - musicLufs))
const bed = mix.map((c) => c.slice())
for (let c = 0; c < 2; c++) for (let i = 0; i < N; i++) mix[c][i] += sfx[c][i]
const before = lufs(mix)
const makeup = db(-14 - before)
for (const c of mix) for (let i = 0; i < N; i++) c[i] *= makeup
if (process.argv.includes('--stems')) {
  // the music and the sounds apart, at their level in the mix, to measure how each sound sits
  writeWav(join(here, 'build', 'stem-music.wav'), bed.map((c) => c.map((v) => v * makeup)))
  writeWav(join(here, 'build', 'stem-sfx.wav'), sfx.map((c) => c.map((v) => v * makeup)))
}
limit(mix, db(-1.2))
// short fades at both ends, so the file starts and stops clean
const fade = (from, to, up) => {
  for (const c of mix) for (let i = Math.round(from * SR); i < Math.min(N, Math.round(to * SR)); i++) c[i] *= up ? (i - from * SR) / ((to - from) * SR) : 1 - (i - from * SR) / ((to - from) * SR)
}
fade(0, 0.004, true)
fade(film.duration - 0.25, film.duration, false)
const out = join(here, 'build', 'mix.wav')
writeWav(out, mix)
console.log(
  `music ${musicLufs.toFixed(1)} LUFS in, ${placed} sounds placed, mix ${lufs(mix).toFixed(1)} LUFS, peak ${peakDb(mix).toFixed(2)} dBFS, ${film.duration}s -> ${out}`
)
