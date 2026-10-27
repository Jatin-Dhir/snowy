// Checks a finished film the way a viewer gets it: reads the MP4's own boxes (codec, size, frame
// rate, duration of every track) and pulls real frames out of the file with the browser's decoder.
//
//   node store/promo/verify.mjs out/taily-highlight-9x16.mp4 [1.2,9.9,30.5]   -> frames in build/verify/
import { createServer } from 'node:http'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch } from '../../scripts/cdp.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const file = resolve(process.argv[2])
const times = (process.argv[3] ?? '').split(',').filter(Boolean).map(Number)
const buf = readFileSync(file)

/** The boxes inside [start, end), as { type, start, end, body } */
function boxes(start, end) {
  const out = []
  for (let p = start; p + 8 <= end; ) {
    let size = buf.readUInt32BE(p)
    const type = buf.toString('ascii', p + 4, p + 8)
    let head = 8
    if (size === 1) {
      size = Number(buf.readBigUInt64BE(p + 8))
      head = 16
    } else if (size === 0) size = end - p
    out.push({ type, start: p, end: p + size, body: p + head })
    p += size
  }
  return out
}
const find = (list, type) => list.find((b) => b.type === type)
const inside = (box) => boxes(box.body, box.end)

const moov = find(boxes(0, buf.length), 'moov')
const mvhd = find(inside(moov), 'mvhd')
const v = buf[mvhd.body]
const movieScale = buf.readUInt32BE(mvhd.body + (v ? 20 : 12))
const movieDur = v ? Number(buf.readBigUInt64BE(mvhd.body + 24)) : buf.readUInt32BE(mvhd.body + 16)
console.log(`${basename(file)}: ${(buf.length / 1e6).toFixed(1)} MB, ${(movieDur / movieScale).toFixed(3)} s`)
for (const trak of inside(moov).filter((b) => b.type === 'trak')) {
  const tkhd = find(inside(trak), 'tkhd')
  const tv = buf[tkhd.body]
  const wOff = tkhd.body + (tv ? 88 : 76)
  const width = buf.readUInt32BE(wOff) / 65536
  const height = buf.readUInt32BE(wOff + 4) / 65536
  const mdia = find(inside(trak), 'mdia')
  const mdhd = find(inside(mdia), 'mdhd')
  const mv = buf[mdhd.body]
  const scale = buf.readUInt32BE(mdhd.body + (mv ? 20 : 12))
  const dur = mv ? Number(buf.readBigUInt64BE(mdhd.body + 24)) : buf.readUInt32BE(mdhd.body + 16)
  const hdlr = find(inside(mdia), 'hdlr')
  const kind = buf.toString('ascii', hdlr.body + 8, hdlr.body + 12)
  const stbl = find(inside(find(inside(mdia), 'minf')), 'stbl')
  const stsd = find(inside(stbl), 'stsd')
  const codec = buf.toString('ascii', stsd.body + 12, stsd.body + 16)
  const stts = find(inside(stbl), 'stts')
  let samples = 0
  for (let i = 0, n = buf.readUInt32BE(stts.body + 4); i < n; i++) samples += buf.readUInt32BE(stts.body + 8 + i * 8)
  const line = kind === 'vide' ? `${width}x${height}, ${samples} frames, ${(samples / (dur / scale)).toFixed(2)} fps` : `${samples} audio packets, ${scale} Hz`
  console.log(`  ${kind} ${codec}: ${line}, ${(dur / scale).toFixed(3)} s`)
}

if (times.length) {
  const out = join(here, 'build', 'verify')
  mkdirSync(out, { recursive: true })
  // served, with byte ranges, so the page and the video share an origin and the browser can seek
  const server = createServer((req, res) => {
    if (req.url !== '/film.mp4') {
      res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><body></body>')
      return
    }
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '')
    if (!range) {
      res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': buf.length, 'accept-ranges': 'bytes' }).end(buf)
      return
    }
    const a = Number(range[1])
    const z = range[2] ? Number(range[2]) : buf.length - 1
    res.writeHead(206, { 'content-type': 'video/mp4', 'content-range': `bytes ${a}-${z}/${buf.length}`, 'content-length': z - a + 1, 'accept-ranges': 'bytes' })
    res.end(buf.subarray(a, z + 1))
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const b = await launch({ port: 9361, args: ['--autoplay-policy=no-user-gesture-required', '--force-color-profile=srgb'] })
  try {
    await b.send('Page.enable')
    await b.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` })
    await b.waitFor(`document.readyState === 'complete'`)
    await b.evaluate(`(async () => {
      const v = document.createElement('video')
      v.muted = true
      v.preload = 'auto'
      v.src = '/film.mp4'
      document.body.appendChild(v)
      await new Promise((r, j) => { v.onloadeddata = r; v.onerror = () => j(new Error('cannot decode')) })
      window.__v = v
      return true
    })()`)
    for (const t of times) {
      const data = await b.evaluate(`(async () => {
        const v = window.__v
        v.currentTime = ${t}
        await new Promise((r) => (v.onseeked = r))
        const c = document.createElement('canvas')
        c.width = v.videoWidth
        c.height = v.videoHeight
        c.getContext('2d').drawImage(v, 0, 0)
        return c.toDataURL('image/png')
      })()`)
      const name = join(out, `${basename(file, '.mp4')}-${t.toFixed(2)}.png`)
      writeFileSync(name, Buffer.from(data.split(',')[1], 'base64'))
      console.log(`  frame at ${t}s -> ${name}`)
    }
  } finally {
    b.close()
    server.close()
  }
}
process.exit(0)
