// Regenerates the Play Store graphics from the real app, so they never drift from the UI:
//   store/play/graphics/phone-*.jpg                    1080 x 2100 screenshots of a fictional demo month
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
import { seed } from './demo-month.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'store', 'play', 'graphics')
const appUrl = process.argv[2] ?? 'http://localhost:5180'
mkdirSync(outDir, { recursive: true })

const click = (b, selector, text) =>
  b.evaluate(`(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.textContent.trim().startsWith(${JSON.stringify(text)}))
    if (!el) return false
    el.click()
    return true
  })()`)

// behind a bottom sheet the app is dimmed anyway; hide it so no half-clipped text peeks above the sheet
const hideBehindSheet = (b) => b.evaluate(`document.querySelector('.tab-host').style.visibility = 'hidden'`)
const showBehindSheet = (b) => b.evaluate(`document.querySelector('.tab-host').style.visibility = ''`)

async function shot(b, name) {
  await sleep(1400) // let the entrance animations and the hero number settle
  const { data } = await b.send('Page.captureScreenshot', { format: 'jpeg', quality: 93 })
  writeFileSync(join(outDir, name), Buffer.from(data, 'base64'))
  console.log(`  ${name}`)
}

const browser = await launch()
try {
  // 360 x 700 @3 = 1080 x 2100: taller than the 9:16 default so sheets fit, still under Google's 2:1 limit
  const phone = { width: 360, height: 700, deviceScaleFactor: 3, mobile: true }
  await browser.send('Page.enable')
  await browser.send('Emulation.setDeviceMetricsOverride', phone)
  await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true })

  console.log(`seeding a demo month into ${appUrl} ...`)
  await browser.send('Page.navigate', { url: appUrl })
  await browser.waitFor(`document.querySelector('#root') && document.querySelector('#root').children.length > 0`)
  const seeded = await browser.evaluate(`(${seed.toString()})()`)
  console.log(`  ${seeded.txns} entries`)
  await browser.send('Page.navigate', { url: appUrl })
  await browser.waitFor(`!!document.querySelector('nav.tabbar')`)

  const tab = (name) => click(browser, 'nav button.tab', name)

  console.log('capturing ...')
  await tab('Home')
  await shot(browser, 'phone-01-home.jpg')

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
  await shot(browser, 'phone-02-add.jpg')
  await showBehindSheet(browser)
  await browser.evaluate(`document.querySelector('button[aria-label="Close"]').click()`)
  await sleep(700)

  await tab('Activity')
  await shot(browser, 'phone-03-activity.jpg')
  await tab('Budgets')
  await shot(browser, 'phone-04-budgets.jpg')
  await tab('Insights')
  await shot(browser, 'phone-05-insights.jpg')

  await tab('Home')
  await sleep(500)
  await click(browser, 'button.card', 'Lent & borrowed')
  await browser.waitFor(`document.body.innerText.includes('Rahul')`)
  await hideBehindSheet(browser)
  await shot(browser, 'phone-06-loans.jpg')
  await showBehindSheet(browser)
  await browser.evaluate(`document.querySelector('button[aria-label="Close"]').click()`)
  await sleep(700)

  // same screen, other theme and accent: the app has eight colours and two modes
  await browser.evaluate(`(async () => { const { saveSettings } = await import('/src/db/db.ts'); await saveSettings({ theme: 'dark', accent: 'lavender' }) })()`)
  await sleep(600)
  // a headless browser only paints on demand, so a CSS colour transition (the hero number has one) can be
  // caught half-way through the theme change: drop transitions so every colour lands on its final value
  const heroColor = () => browser.evaluate(`getComputedStyle(document.querySelector('.hero-num')).color`)
  console.log(`  hero colour before settling: ${await heroColor()}`)
  await browser.evaluate(`(() => { const s = document.createElement('style'); s.textContent = '*{transition:none!important}'; document.head.appendChild(s); return true })()`)
  await sleep(200)
  console.log(`  hero colour after settling:  ${await heroColor()}`)
  await shot(browser, 'phone-07-home-dark.jpg')

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
