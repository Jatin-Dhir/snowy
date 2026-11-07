// Regenerates the Play Store graphics from the real app, so they never drift from the UI:
//   store/play/graphics/src/screens/*.jpg              the real screens, 1080 x 2100, of a fictional demo month
//   store/play/graphics/phone-*.jpg                    the 8 screenshots to upload, 1080 x 1920 (Play takes 9:16 only),
//                                                      each screen in a phone under its headline (src/screenshots.html)
//   store/play/graphics/feature-graphic-1024x500.jpg   rendered from store/play/graphics/src/feature-graphic.html
//
//   1. serve the Play build:  npx vite --mode play --port 5180
//   2. then run:              node scripts/play-graphics.mjs [http://localhost:5180]
//
// Everything happens in a throwaway browser profile; the demo data is invented and goes nowhere.
import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { launch, sleep } from './cdp.mjs'
import { seed, seedTrip } from './demo-month.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'store', 'play', 'graphics')
const screensDir = join(outDir, 'src', 'screens')
const appUrl = process.argv[2] ?? 'http://localhost:5180'
mkdirSync(screensDir, { recursive: true })

// The demo month only reads as a month near its end: made on the 2nd it would be crammed into two days, with a red
// safe-to-spend and every budget ahead of pace. So the app's clock always says this, whichever day the graphics are made.
const DEMO_NOW = new Date(2026, 9, 31, 6, 40).getTime()
const DEMO_CLOCK = `(() => {
  const Real = Date
  const shift = ${DEMO_NOW} - Real.now()
  window.Date = class extends Real {
    constructor(...args) {
      if (args.length) super(...args)
      else super(Real.now() + shift)
    }
    static now() {
      return Real.now() + shift
    }
  }
})()`

// what each uploaded screenshot is called, in the order Play shows them (src/screenshots.html has the words)
const SHOTS = ['add', 'voice', 'home', 'insights', 'budgets', 'trip', 'dark', 'pro']

// Voice in a browser goes through SpeechRecognition: this one "hears" window.__voiceWords a word at a
// time, the way a real recognizer sends partial results (the same script the highlight film uses).
const SCRIPTED_VOICE = `(() => {
  class ScriptedRecognition {
    constructor() {
      this.lang = 'en-IN'
      this.interimResults = false
      this.continuous = false
      this.maxAlternatives = 1
      this.text = ''
      this.ended = false
      this.pending = []
    }
    later(ms, fn) {
      this.pending.push(setTimeout(fn, ms))
    }
    emit(isFinal) {
      const alt = { transcript: this.text, confidence: isFinal ? 0.92 : 0 }
      this.onresult?.({ results: [Object.assign([alt], { isFinal })] })
    }
    start() {
      const words = window.__voiceWords ?? []
      this.later(120, () => this.onaudiostart?.())
      this.later(380, () => this.onspeechstart?.())
      words.forEach((_, i) =>
        this.later(450 + i * 250, () => {
          this.text = words.slice(0, i + 1).join(' ')
          this.emit(false)
        })
      )
    }
    stop() {
      this.later(150, () => this.finish())
    }
    abort() {
      this.ended = true
      this.pending.forEach(clearTimeout)
      setTimeout(() => this.onend?.(), 10)
    }
    finish() {
      if (this.ended) return
      this.ended = true
      this.pending.forEach(clearTimeout)
      if (this.text) this.emit(true)
      setTimeout(() => this.onend?.(), 60)
    }
  }
  window.SpeechRecognition = window.webkitSpeechRecognition = ScriptedRecognition
})()`

const click = (b, selector, text) =>
  b.evaluate(`(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.textContent.trim().startsWith(${JSON.stringify(text)}))
    if (!el) return false
    el.click()
    return true
  })()`)

const centre = (b, selector) =>
  b.evaluate(`(() => {
    const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  })()`)
const touch = (b, type, p) =>
  b.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y, radiusX: 9, radiusY: 9, force: 1, id: 0 }] : [] })

// behind a bottom sheet the app is dimmed anyway; hide it so no half-clipped text peeks above the sheet
const hideBehindSheet = (b) => b.evaluate(`document.querySelector('.tab-host').style.visibility = 'hidden'`)
const showBehindSheet = (b) => b.evaluate(`document.querySelector('.tab-host').style.visibility = ''`)

async function shot(b, name) {
  await sleep(1400) // let the entrance animations and the hero number settle
  const { data } = await b.send('Page.captureScreenshot', { format: 'jpeg', quality: 93 })
  writeFileSync(join(screensDir, name), Buffer.from(data, 'base64'))
  console.log(`  src/screens/${name}`)
}

// file access: the screenshot page reads each screen's top and bottom rows to colour the status bar to match
const browser = await launch({ args: ['--allow-file-access-from-files'] })
try {
  // 360 x 700 @3 = 1080 x 2100: taller than 9:16 so sheets fit; the phone in the screenshots is this shape
  const phone = { width: 360, height: 700, deviceScaleFactor: 3, mobile: true }
  await browser.send('Page.enable')
  await browser.send('Emulation.setDeviceMetricsOverride', phone)
  await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true })
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: DEMO_CLOCK })
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: SCRIPTED_VOICE })

  console.log(`seeding a demo month into ${appUrl} ...`)
  await browser.send('Page.navigate', { url: appUrl })
  await browser.waitFor(`document.querySelector('#root') && document.querySelector('#root').children.length > 0`, 90000)
  const seeded = await browser.evaluate(`(${seed.toString()})()`)
  console.log(`  ${seeded.txns} entries`)
  await browser.send('Page.navigate', { url: appUrl })
  await browser.waitFor(`!!document.querySelector('nav.tabbar')`, 90000)
  await sleep(1500) // the + is drawn before the app has its settings; a tap that early does nothing

  const tab = (name) => click(browser, 'nav button.tab', name)

  console.log('capturing ...')
  // the signature moment: amount, note, and the tag it already knows
  await click(browser, 'button.fab', '')
  await browser.waitFor(`!!document.querySelector('.amount-display')`)
  await sleep(600)
  for (const k of ['3', '4', '9']) {
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: `Digit${k}`, text: k })
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: `Digit${k}` })
  }
  await click(browser, '.pill', 'Note')
  await browser.waitFor(`!!document.querySelector('input[placeholder^="Note"]')`)
  await browser.evaluate(`document.querySelector('input[placeholder^="Note"]').focus()`)
  await browser.send('Input.insertText', { text: 'Swiggy dinner' })
  await hideBehindSheet(browser)
  await shot(browser, '01-add.jpg')
  await showBehindSheet(browser)
  await browser.evaluate(`document.querySelector('button[aria-label="Close"]').click()`)
  await sleep(700)

  await tab('Home')
  // closing a sheet hands focus back to the + that opened it; a scripted click counts as a keyboard, so it
  // would wear a focus ring that a finger never sees
  await browser.evaluate(`document.activeElement?.blur?.(); true`)
  await shot(browser, '03-home.jpg')

  // hold the + and say it, in Hindi: the panel shows what Taily understood while the finger is still down
  await browser.evaluate(`window.__voiceWords = ['dhai', 'sau', 'ka', 'khana']; true`)
  const fab = await centre(browser, 'button.fab')
  await touch(browser, 'touchStart', fab)
  await sleep(800)
  await shot(browser, '02-voice.jpg')
  // slide off the button and let go: cancelled, so nothing is saved
  await touch(browser, 'touchMove', { x: fab.x, y: fab.y - 240 })
  await sleep(120)
  await touch(browser, 'touchEnd')
  await sleep(1200)
  // a fresh load, so the + doesn't keep the pressed look into the later shots
  await browser.send('Page.navigate', { url: appUrl })
  await browser.waitFor(`!!document.querySelector('nav.tabbar')`, 90000)

  await tab('Insights')
  await shot(browser, '04-insights.jpg')
  await tab('Budgets')
  await shot(browser, '05-budgets.jpg')

  // Taily Pro. A browser has no Google Play to ask, so the sheet says Pro isn't on offer and greys out
  // Unlock: show it the way it reads on a phone with Play (button live, no price in the picture), and
  // leave the review-code button out of the advert
  await browser.evaluate(`import('/src/lib/pro.ts').then((m) => { m.openProSheet(); return true })`)
  await browser.waitFor(`[...document.querySelectorAll('[role=dialog]')].some((d) => d.getAttribute('aria-label') === 'Taily Pro')`)
  await sleep(600)
  await browser.evaluate(`(() => {
    const d = [...document.querySelectorAll('[role=dialog]')].find((x) => x.getAttribute('aria-label') === 'Taily Pro')
    const unlock = [...d.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('Unlock Pro'))
    unlock.disabled = false
    const note = [...d.querySelectorAll('.caption')].find((c) => c.textContent.startsWith("Google Play isn't offering"))
    if (note) note.style.display = 'none'
    const code = [...d.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Redeem a code')
    if (code) code.style.display = 'none'
    return true
  })()`)
  await hideBehindSheet(browser)
  await shot(browser, '08-pro.jpg')
  await showBehindSheet(browser)
  await browser.evaluate(`import('/src/lib/pro.ts').then((m) => { m.closeProSheet(); return true })`)
  await sleep(700)

  // the other theme and an accent, on the one screen no other frame shows: every entry, by day
  await tab('Home')
  await sleep(500)
  await browser.evaluate(`(async () => { const { saveSettings } = await import('/src/db/db.ts'); await saveSettings({ theme: 'dark', accent: 'lavender' }) })()`)
  await sleep(600)
  // a headless browser only paints on demand, so a CSS colour transition (the hero number has one) can be
  // caught half-way through the theme change: drop transitions so every colour lands on its final value
  const heroColor = () => browser.evaluate(`getComputedStyle(document.querySelector('.hero-num')).color`)
  console.log(`  hero colour before settling: ${await heroColor()}`)
  await browser.evaluate(`(() => { const s = document.createElement('style'); s.textContent = '*{transition:none!important}'; document.head.appendChild(s); return true })()`)
  await sleep(200)
  console.log(`  hero colour after settling:  ${await heroColor()}`)
  await tab('Activity')
  await shot(browser, '07-dark.jpg')

  // a trip in full swing, last: while a trip is on it shows up on every other screen. Who pays whom is the point
  await browser.evaluate(`(async () => { const { saveSettings } = await import('/src/db/db.ts'); await saveSettings({ theme: 'light', accent: 'blue' }) })()`)
  await browser.evaluate(`(${seedTrip.toString()})()`)
  await tab('Home')
  await sleep(600)
  await click(browser, 'button.card', 'Goa trip')
  await browser.waitFor(`document.body.innerText.includes('Who pays whom'.toUpperCase())`)
  await hideBehindSheet(browser)
  await shot(browser, '06-trip.jpg')

  // ---- the screenshots to upload: each screen in the phone, under its headline
  console.log('composing the screenshots ...')
  await browser.send('Emulation.setTouchEmulationEnabled', { enabled: false })
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1080, height: 1920, deviceScaleFactor: 1, mobile: false })
  const page = pathToFileURL(join(outDir, 'src', 'screenshots.html')).href
  for (const [i, name] of SHOTS.entries()) {
    await browser.send('Page.navigate', { url: `${page}?n=${i + 1}` })
    await browser.waitFor(`document.body && document.body.dataset.ready === '1'`)
    await sleep(300)
    const file = `phone-${String(i + 1).padStart(2, '0')}-${name}.jpg`
    const { data } = await browser.send('Page.captureScreenshot', { format: 'jpeg', quality: 92 })
    writeFileSync(join(outDir, file), Buffer.from(data, 'base64'))
    console.log(`  ${file}`)
  }

  // ---- feature graphic
  console.log('rendering the feature graphic ...')
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 500, deviceScaleFactor: 1, mobile: false })
  await browser.send('Page.navigate', { url: pathToFileURL(join(outDir, 'src', 'feature-graphic.html')).href })
  await browser.waitFor(`document.readyState === 'complete'`)
  await browser.evaluate(`document.fonts.ready.then(() => true)`)
  await sleep(500)
  const { data } = await browser.send('Page.captureScreenshot', { format: 'jpeg', quality: 95 })
  writeFileSync(join(outDir, 'feature-graphic-1024x500.jpg'), Buffer.from(data, 'base64'))
  console.log('  feature-graphic-1024x500.jpg')

  copyFileSync(join(root, 'public', 'icons', 'icon-512.png'), join(outDir, 'icon-512.png'))
  console.log('  icon-512.png (copied)')
  console.log(`done: ${outDir}`)
} finally {
  browser.close()
}
