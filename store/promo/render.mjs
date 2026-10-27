// Draws the film (film/index.html) frame by frame.
//
//   node store/promo/render.mjs 9x16                      every frame, 2x supersampled, into build/frames-9x16/
//   node store/promo/render.mjs 16x9 --from 10 --to 14    part of it
//   node store/promo/render.mjs 9x16 --stills 1.2,6.9,30.5   single frames at 1x into build/stills/, to look at first
//
// Frames are drawn at twice the film's size (3840 px on the long side) so text and the
// downscaled app footage are filtered once, when Blender shrinks them with a box filter.
// Also writes build/film-events.json: every sound the soundtrack lays over the music.
import { createServer } from 'node:http'
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch } from '../../scripts/cdp.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..', '..')
const args = process.argv.slice(2)
const aspect = args.find((a) => /^\d+x\d+$/.test(a)) ?? '9x16'
const opt = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback)
const stills = opt('stills', null)?.split(',').map(Number)
const scale = Number(opt('scale', stills ? 1 : 2))
const from = Number(opt('from', 0))
const until = opt('to', null)

// ---- a static server for the repo: the film page, the app's fonts, the filmed clips
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2'
}
const server = createServer((req, res) => {
  const path = normalize(join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)))
  if (!path.startsWith(root) || !existsSync(path) || statSync(path).isDirectory()) {
    res.writeHead(404).end()
    return
  }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream', 'cache-control': 'max-age=3600' })
  res.end(readFileSync(path))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port

const [W, H] = aspect === '16x9' ? [1920, 1080] : [1080, 1920]
// one port per kind of run, so both aspects can render side by side
const b = await launch({
  port: 9351 + (aspect === '16x9' ? 1 : 0) + (stills ? 2 : 0),
  args: ['--force-color-profile=srgb', '--font-render-hinting=none', '--hide-scrollbars']
})
try {
  await b.send('Page.enable')
  await b.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: scale, mobile: false })
  await b.send('Page.navigate', { url: `http://127.0.0.1:${port}/store/promo/film/index.html?aspect=${aspect}` })
  await b.waitFor('window.FILM_READY === true', 60000)
  const film = await b.evaluate('window.FILM')
  writeFileSync(join(here, 'build', 'film-events.json'), JSON.stringify(film, null, 1))

  const shot = async (t, format, quality) => {
    await b.evaluate(`render(${t})`)
    const { data } = await b.send('Page.captureScreenshot', { format, quality, optimizeForSpeed: format === 'jpeg' })
    return Buffer.from(data, 'base64')
  }

  if (stills) {
    const dir = join(here, 'build', 'stills')
    mkdirSync(dir, { recursive: true })
    for (const t of stills) {
      const file = join(dir, `${aspect}-${t.toFixed(2)}.png`)
      writeFileSync(file, await shot(t, 'png'))
      console.log(`  ${file}`)
    }
  } else {
    const dir = join(here, 'build', `frames-${aspect}`)
    mkdirSync(dir, { recursive: true })
    const total = Math.round(film.duration * film.fps)
    const first = Math.round(from * film.fps)
    const last = until === null ? total : Math.min(total, Math.round(Number(until) * film.fps))
    const started = Date.now()
    for (let f = first; f < last; f++) {
      writeFileSync(join(dir, `${String(f).padStart(4, '0')}.jpg`), await shot(f / film.fps, 'jpeg', 95))
      if ((f - first) % 120 === 119) {
        const per = (Date.now() - started) / (f - first + 1)
        console.log(`  ${aspect}: frame ${f + 1}/${last}, ${Math.round(per)} ms a frame, ~${Math.round(((last - f) * per) / 60000)} min left`)
      }
    }
    console.log(`done: ${last - first} frames in ${Math.round((Date.now() - started) / 1000)}s -> ${dir}`)
  }
} finally {
  b.close()
  server.close()
}
process.exit(0)
