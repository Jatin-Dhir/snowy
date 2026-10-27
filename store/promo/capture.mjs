// Films the real app for the promo video, one exact frame at a time.
//
//   1. serve the Play build:  npx vite --mode play --port 5180
//   2. then run:              node store/promo/capture.mjs [http://localhost:5180] [--only c1-type,c5-insights]
//
// Each clip lands in store/promo/build/clips/<name>/0000.jpg ... at 60 fps (390 x 800 CSS px
// at 3x, the phone's screen below its status bar), with <name>.json beside it: the touches
// (for the finger marks drawn over the screen), the sounds the app started and when, and the
// theme per moment (for the status bar). Time inside the page is virtual (lib/virtual-time.js),
// so animations come out at true speed however slow the capture runs.
//
// Everything happens in a throwaway browser profile filled with the fictional demo month.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch, sleep } from '../../scripts/cdp.mjs'
import { seed } from '../../scripts/demo-month.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const appUrl = args.find((a) => a.startsWith('http')) ?? 'http://localhost:5180'
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null
// --frames N films only the first N frames of each clip (quick checks)
const cap = args.includes('--frames') ? Number(args[args.indexOf('--frames') + 1]) : Infinity
const flags = (process.env.CAPTURE_FLAGS ?? '').split(' ').filter(Boolean)
const outDir = join(here, 'build', 'clips')
const FPS = 60
const FRAME = 1000 / FPS
// the video's "now": Tuesday 27 October 2026, 1:10 pm, lunch time
const EPOCH = new Date(2026, 9, 27, 13, 10, 0).getTime()
const VIEW = { width: 390, height: 800, deviceScaleFactor: 3, mobile: true }

const b = await launch({
  port: 9341,
  args: ['--autoplay-policy=no-user-gesture-required', '--force-color-profile=srgb', '--font-render-hinting=none', ...flags]
})
const ev = (js) => b.evaluate(js)

/* ------------------------------------------------------------------ input */

const at = (p) => [{ x: p.x, y: p.y, radiusX: 9, radiusY: 9, force: 1, id: 0 }]
const touchStart = (p) => b.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(p) })
const touchMove = (p) => b.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(p) })
const touchEnd = () => b.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })

/** The centre of the first element matching `selector` whose text is `text` (or starts with it). */
async function locate(selector, text) {
  const p = await ev(`(() => {
    const els = [...document.querySelectorAll(${JSON.stringify(selector)})]
    const want = ${JSON.stringify(text ?? null)}
    const el = want === null ? els[0] : els.find((e) => e.textContent.trim() === want) ?? els.find((e) => e.textContent.trim().startsWith(want))
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  })()`)
  if (!p) throw new Error(`Nothing on screen matches ${selector} "${text ?? ''}"`)
  return p
}

/** A finger on `target` at `t` ms for `hold` ms. */
function press(t, target, hold = 70) {
  let p = null
  return [
    {
      t,
      run: async (log) => {
        p = await locate(...target)
        await touchStart(p)
        log.touches.push({ t, type: 'down', ...p })
      }
    },
    {
      t: t + hold,
      run: async (log) => {
        await touchEnd()
        log.touches.push({ t: t + hold, type: 'up', ...p })
      }
    }
  ]
}

const settings = (patch) => `import('/src/db/db.ts').then((m) => m.saveSettings(${JSON.stringify(patch)})).then(() => true)`

/* ------------------------------------------------------------------ clips */

/** Where each of `selectors` sits on screen now (CSS px), with its corner radius; null when absent. */
const boxes = (selectors) =>
  ev(`${JSON.stringify(selectors)}.map((s) => {
    const e = document.querySelector(s)
    if (!e) return null
    const r = e.getBoundingClientRect()
    return [r.x, r.y, r.width, r.height, parseFloat(getComputedStyle(e).borderTopLeftRadius) || 0].map((v) => Math.round(v * 10) / 10)
  })`)

/**
 * Films `ms` of the app in virtual time. `actions` run at their frame: at t, the clock
 * reads t, the action happens, the page settles, the frame is taken. `track` records the
 * box of those elements on every frame, so the video can lift them out of the screen.
 */
async function film(name, ms, actions = [], { theme = 'light', track = [] } = {}) {
  if (only && !only.includes(name)) return false
  const dir = join(outDir, name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const queue = actions.flat().sort((a, b) => a.t - b.t)
  const log = { name, fps: FPS, frames: Math.min(cap, Math.round((ms / 1000) * FPS)), view: VIEW, touches: [], themes: [{ t: 0, theme }] }
  if (track.length) log.boxes = Object.fromEntries(track.map((s) => [s, []]))
  await ev('__vt.takeSounds(); __vt.takeVoiceLog(); true')
  const t0 = await ev('__vt.stepMode()')
  const started = Date.now()
  // where the time goes, per frame: moving the clock, letting the page settle, the screenshot
  const spent = { step: 0, settle: 0, shot: 0 }
  const timed = async (k, p) => {
    const s = performance.now()
    const r = await p
    spent[k] += performance.now() - s
    return r
  }
  for (let f = 0, i = 0; f < log.frames; f++) {
    const t = f * FRAME
    if (f > 0) await timed('step', ev(`__vt.step(${FRAME})`))
    while (i < queue.length && queue[i].t <= t + 0.001) await queue[i++].run(log, t)
    await timed('settle', ev('__vt.settle()'))
    if (track.length) (await boxes(track)).forEach((box, k) => log.boxes[track[k]].push(box))
    const { data } = await timed('shot', b.send('Page.captureScreenshot', { format: 'jpeg', quality: 92, optimizeForSpeed: true }))
    writeFileSync(join(dir, `${String(f).padStart(4, '0')}.jpg`), Buffer.from(data, 'base64'))
  }
  const per = Object.entries(spent).map(([k, ms]) => `${k} ${Math.round(ms / log.frames)}ms`).join(', ')
  const rel = (list) => list.map((s) => ({ ...s, t: Math.round((s.t - t0) * 10) / 10 }))
  log.sounds = rel(await ev('__vt.takeSounds()'))
  log.voice = rel(await ev('__vt.takeVoiceLog()'))
  writeFileSync(join(outDir, `${name}.json`), JSON.stringify(log, null, 1))
  await ev('__vt.runMode(); true')
  const secs = ((Date.now() - started) / 1000).toFixed(0)
  console.log(`  ${name}: ${log.frames} frames in ${secs}s (${per} a frame), ${log.sounds.length} sounds, ${log.touches.length} touches`)
  return true
}

const FAB = ['button.fab']
const key = (d) => ['.numpad .key', d]
const tab = (name) => ['nav button.tab', name]

try {
  mkdirSync(outDir, { recursive: true })
  await b.send('Page.enable')
  await b.send('Emulation.setDeviceMetricsOverride', VIEW)
  await b.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  const clock = readFileSync(join(here, 'lib', 'virtual-time.js'), 'utf8').replace('__EPOCH__', String(EPOCH))
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: clock })

  console.log(`seeding the demo month into ${appUrl} ...`)
  await b.send('Page.navigate', { url: appUrl })
  // a fresh profile pulls every module through the dev server: give the first load time
  await b.waitFor(`document.querySelector('#root') && document.querySelector('#root').children.length > 0`, 90000)
  const seeded = await ev(`(${seed.toString()})()`)
  await ev(settings({ sounds: true, haptics: false, theme: 'light', accent: 'blue', accentHue: 210 }))
  await ev(`localStorage.setItem('tally.fx', JSON.stringify({ haptics: false, sounds: true })); true`)
  console.log(`  ${seeded.txns} entries`)
  await b.send('Page.navigate', { url: appUrl })
  await b.waitFor(`!!document.querySelector('nav.tabbar')`, 90000)
  await sleep(2500)
  // the first touch wakes the audio and decodes the clicks; done here so the first key on film clicks
  const blank = { x: 195, y: 120 }
  await touchStart(blank)
  await touchEnd()
  await sleep(800)

  console.log('filming ...')
  // ---- the three-second log: + then 2 5 0, then a tag saves it
  await film('c1-type', 4000, [press(250, FAB, 80), press(750, key('2'), 60), press(1000, key('5'), 60), press(1250, key('0'), 60), press(1750, ['.chip-row .chip', 'Food'], 70)])
  await sleep(6500)

  // ---- hold the + and say it
  await ev(`__vt.setVoice({ words: ['450', 'dinner', 'with', 'Ananya'], firstWordMs: 450, gap: 250 }); true`)
  await film('c2-voice', 4000, [press(250, FAB, 2250)], { track: ['.voice-panel'] })
  await sleep(6500)

  // ---- English, Hindi, both
  for (const [name, words, release] of [
    ['c3-en', ['got', '2000', 'from', 'Rahul'], 1900],
    ['c3-hi', ['dhai', 'sau', 'ka', 'khana'], 1900],
    ['c3-mix', ['uber', '340', 'kal'], 1650]
  ]) {
    await ev(`__vt.setVoice({ words: ${JSON.stringify(words)}, firstWordMs: 350, gap: 250 }); true`)
    if (await film(name, 2600, [press(100, FAB, release - 100)], { track: ['.voice-panel'] })) await sleep(6500)
  }

  // ---- tap-to-talk, as a launch from the widget opens it: from the add sheet's mic
  if (!only || only.includes('c4-widget')) {
    const fab = await locate(...FAB)
    await touchStart(fab)
    await sleep(60)
    await touchEnd()
    await sleep(1500)
    await ev(`__vt.setVoice({ words: ['80', 'chai'], firstWordMs: 500, gap: 250 }); true`)
    await film('c4-widget', 3400, [press(150, ['button[aria-label="Say it instead"]'], 60)], { track: ['.voice-panel'] })
    await sleep(6500)
  }

  // ---- insights, with a slow scroll down the charts
  {
    const scroll = []
    const from = 2000
    const span = 700
    const dist = 420
    let base = 0
    for (let t = from; t <= from + span; t += FRAME) {
      const p = Math.min(1, (t - from) / span)
      const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2
      scroll.push({
        t,
        run: async (log) => {
          if (t === from) {
            base = await ev(`(() => { const s = [...document.querySelectorAll('*')].find((e) => e.scrollHeight > e.clientHeight + 40 && /(auto|scroll)/.test(getComputedStyle(e).overflowY)) ?? document.scrollingElement; window.__scroller = s; return s.scrollTop })()`)
            log.touches.push({ t, type: 'down', x: 230, y: 560 })
          }
          await ev(`window.__scroller.scrollTop = ${base} + ${(e * dist).toFixed(2)}; true`)
          log.touches.push({ t, type: p >= 1 ? 'up' : 'move', x: 230, y: Math.round(560 - e * dist * 0.62) })
        }
      })
    }
    if (await film('c5-insights', 4000, [press(250, tab('Insights'), 70), scroll])) {
      const home = await locate(...tab('Home'))
      await touchStart(home)
      await touchEnd()
      await sleep(1500)
      // the tabs share a scroller: back to the top of Home for the next clip
      await ev(`document.querySelectorAll('*').forEach((e) => { if (e.scrollTop) e.scrollTop = 0 }); window.scrollTo(0, 0); true`)
      await sleep(1000)
    }
  }

  // ---- accents on the beat: the five free colours, then dark mode
  {
    const looks = [
      { accent: 'lavender' },
      { accent: 'pink' },
      { accent: 'green' },
      { accent: 'mono' },
      { accent: 'blue', theme: 'dark' },
      { accent: 'lavender', theme: 'dark' },
      { accent: 'pink', theme: 'dark' },
      { accent: 'green', theme: 'dark' }
    ]
    const actions = looks.map((look, k) => ({
      t: 300 + k * 500,
      run: async (log, t) => {
        await ev(settings(look))
        if (look.theme) log.themes.push({ t, theme: look.theme })
      }
    }))
    if (await film('c6-accents', 4600, actions)) await ev(settings({ theme: 'light', accent: 'blue' }))
  }
  console.log(`done: ${outDir}`)
} finally {
  b.close()
}
process.exit(0)
