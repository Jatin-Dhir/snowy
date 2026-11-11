// Measures text contrast the way it renders, so a colour change is checked rather than guessed:
//   part 1: every text token on every surface it can sit on, in light and dark, for each accent preset
//           and for all 360 hues of the custom slider (through the app's own applyCustomAccent)
//   part 2: every visible piece of text on every screen and sheet, against what is painted behind it
//   part 3: the two pages outside the app, trip.html and privacy.html
//
//   1. serve the Play build:  npx vite --mode play --port 5180
//   2. then run:              node scripts/contrast.mjs [http://localhost:5180] [light:blue dark:mono ...]
//
// Text under 24 px (18.66 px bold) needs 4.5:1, larger text 3:1. Text inside a disabled control is measured
// but exempt (WCAG 1.4.3). Icon-only buttons need 3:1 and are listed on their own. Exits 1 on any text failure, and on
// any control the walk can't find, since what that control opens then goes unmeasured.
// A gradient surface counts as its worst stop, since text can sit anywhere on it.
// CONTRAST_JSON=<file> also writes every measurement there.
// Everything happens in a throwaway browser profile; the demo data is invented and goes nowhere.
import { writeFileSync } from 'node:fs'
import { launch, sleep } from './cdp.mjs'
import { seed, seedTrip } from './demo-month.mjs'

const args = process.argv.slice(2)
const appUrl = args.find((a) => a.startsWith('http')) ?? 'http://localhost:5180'
const only = args.filter((a) => a.includes(':') && !a.startsWith('http'))
const THEMES = ['light', 'dark']
const PRESETS = ['blue', 'lavender', 'pink', 'green', 'mono', 'cream', 'strawberry', 'matcha', 'blueberry']
// the custom hues that sit nearest the bar: yellow reads lightest, blue-violet darkest
const CUSTOM_HUES = [60, 245]

// which text token sits on which surface. --raised-bg is a gradient in dark; each stop is measured.
const GROUNDS = ['--bg', '--raised-bg', '--sheet-bg', '--sunken', '--btn-bg']
const TOKEN_PAIRS = [
  ['--ink', [...GROUNDS, '--pos-soft']],
  ['--muted', GROUNDS],
  ['--faint', GROUNDS],
  ['--accent-text', [...GROUNDS, '--pos-soft']],
  ['--pos-text', [...GROUNDS, '--pos-soft']],
  ['--amber-text', GROUNDS],
  ['--red', GROUNDS],
  ['--on-accent', ['--accent']],
  ['--bg', ['--ink']],
  ['--pos-on-ink', ['--ink']]
]
// not text: 3:1 is the bar for these, and they are reported, not failed
const MARK_PAIRS = [
  ['--pos', GROUNDS, 'bars and marks'],
  ['--amber', GROUNDS, 'bars and marks'],
  ['--focus', [...GROUNDS, '--pos-soft'], 'focus ring']
]
const NAMED = ['--ink', '--muted', '--faint', '--faint-future', '--accent', '--accent-text', '--on-accent', '--pos', '--pos-text', '--pos-soft', '--pos-on-ink', '--amber', '--amber-text', '--red', '--bg', '--sheet-bg', '--sunken', '--btn-bg', '--raised-bg']

// ---- runs inside the page
function installLib() {
  const parse = (text) => {
    let m = text.match(/^rgba?\(([^)]+)\)/)
    if (m) {
      const p = m[1].split(/[\s,/]+/).map(Number)
      return [p[0], p[1], p[2], p[3] ?? 1]
    }
    m = text.match(/^color\(srgb ([^)]+)\)/)
    if (m) {
      const p = m[1].split(/[\s/]+/).map(Number)
      return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] ?? 1]
    }
    return null
  }
  const over = (top, under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1)
  const round = (c) => c.slice(0, 3).map(Math.round).concat(c[3] ?? 1)
  const linear = (v) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4)
  const lum = (c) => 0.2126 * linear(c[0]) + 0.7152 * linear(c[1]) + 0.0722 * linear(c[2])
  const ratio = (a, b) => {
    const [x, y] = [lum(round(a)), lum(round(b))]
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
  }
  const hex = (c) => `#${round(c).slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('')}`
  const stopsOf = (image) => (image.match(/rgba?\([^)]*\)|color\([^)]*\)/g) ?? []).map(parse)

  const probe = document.createElement('i')
  probe.style.display = 'none'
  document.documentElement.appendChild(probe)

  /** A token's colours as painted: one, or every stop of a gradient. */
  function tokenColors(name) {
    probe.style.background = `var(${name})`
    probe.style.color = `var(${name})`
    const s = getComputedStyle(probe)
    const stops = stopsOf(s.backgroundImage)
    if (stops.length) return stops
    const bg = parse(s.backgroundColor)
    return bg && bg[3] > 0 ? [bg] : [parse(s.color)]
  }

  /** The lowest ratio of each pair right now. */
  function measurePairs(pairs) {
    return pairs.flatMap(([fg, surfaces]) =>
      surfaces.flatMap((bg) => {
        const fore = tokenColors(fg)[0]
        return tokenColors(bg).map((back) => ({ fg, bg, fgHex: hex(fore), bgHex: hex(back), ratio: ratio(fore, over(back, [255, 255, 255, 1])) }))
      })
    )
  }

  function tokenNames(names) {
    const map = {}
    for (const n of names) {
      for (const c of tokenColors(n)) (map[hex(c)] ??= []).push(n)
    }
    return map
  }

  /** What is painted under a point, top first, starting at the element that holds the text. */
  function backdrops(stack) {
    const layers = []
    for (const el of stack) {
      const s = getComputedStyle(el)
      const stops = stopsOf(s.backgroundImage)
      if (stops.length) {
        layers.push(stops)
        if (stops.every((c) => c[3] === 1)) break
      }
      const bg = parse(s.backgroundColor)
      if (bg && bg[3] > 0) {
        layers.push([bg])
        if (bg[3] === 1) break
      }
    }
    // past the fold the point is outside <body>'s box, but its background still paints the whole canvas
    const canvas = parse(getComputedStyle(document.body).backgroundColor)
    let backs = [canvas?.[3] === 1 ? canvas : [255, 255, 255, 1]]
    for (const layer of layers.reverse()) backs = backs.flatMap((under) => layer.map((c) => over(c, under)))
    return backs
  }

  const signature = (el) => {
    const path = []
    for (let n = el, i = 0; n && i < 4; n = n.parentElement, i++) path.push(`${n.tagName}.${n.getAttribute('class') ?? ''}`)
    let bg = ''
    for (let n = el; n; n = n.parentElement) {
      const s = getComputedStyle(n)
      if (s.backgroundImage !== 'none' || parse(s.backgroundColor)?.[3] > 0) {
        bg = s.backgroundImage + s.backgroundColor
        break
      }
    }
    return path.join('<') + bg
  }

  const describe = (el) => {
    const named = (n) => `${n.tagName.toLowerCase()}${n.getAttribute('class') ? `.${n.getAttribute('class').trim().split(/\s+/).join('.')}` : ''}`
    if (el.getAttribute('class') || el.tagName === 'text') return named(el)
    const p = el.parentElement?.closest('[class]')
    return `${named(el)} in ${p ? named(p) : 'page'}`
  }

  /** Measures one colour at one spot. Returns null when something opaque covers the spot. */
  function spot(el, rect, color) {
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    const stack = document.elementsFromPoint(x, y)
    const at = stack.findIndex((n) => n === el || el.contains(n) || n.contains(el))
    if (at < 0) return null
    for (const above of stack.slice(0, at)) {
      const s = getComputedStyle(above)
      if (parse(s.backgroundColor)?.[3] === 1 || s.backgroundImage !== 'none') return null
    }
    let alpha = color[3]
    for (let n = el; n; n = n.parentElement) alpha *= Number(getComputedStyle(n).opacity)
    if (alpha < 0.05) return null
    let worst = null
    for (const back of backdrops(stack.slice(at))) {
      const fore = over([color[0], color[1], color[2], alpha], back)
      const r = ratio(fore, back)
      if (!worst || r < worst.ratio) worst = { ratio: r, fg: hex(fore), bg: hex(back), rawFg: hex(color) }
    }
    return worst
  }

  /** Every visible text in the top layer (the open sheet, the page if none) and any toast. */
  function auditText(names) {
    const out = []
    const seen = new Set()
    const sheets = [...document.querySelectorAll('.sheet:not(.sheet-out)')]
    const voice = document.querySelector('.voice-panel')
    const scopes = [voice ?? sheets[sheets.length - 1] ?? document.body]
    const toast = document.querySelector('.toast:not(.toast-out), .voice-hint')
    if (toast && scopes[0] !== document.body) scopes.push(toast)

    const push = (el, rect, color, text, kind) => {
      const s = getComputedStyle(el)
      const px = parseFloat(s.fontSize)
      const bold = Number(s.fontWeight) >= 700
      const m = spot(el, rect, color)
      if (!m) return
      out.push({
        where: describe(el),
        kind,
        text: text.trim().slice(0, 28),
        px,
        weight: Number(s.fontWeight),
        need: px >= 24 || (px >= 18.66 && bold) ? 3 : 4.5,
        ratio: m.ratio,
        fg: m.fg,
        bg: m.bg,
        fgToken: names[m.rawFg]?.join('|') ?? names[m.fg]?.join('|') ?? '',
        bgToken: names[m.bg]?.join('|') ?? '',
        exempt: !!el.closest(':disabled, [aria-disabled="true"]'),
        hidden: !!el.closest('[aria-hidden="true"]')
      })
    }

    for (const scope of scopes) {
      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const el = node.parentElement
        if (!node.textContent.trim() || !el || el.closest('.sr-only, script, style, option, noscript')) continue
        const s = getComputedStyle(el)
        if (s.visibility === 'hidden') continue
        const colorText = el.namespaceURI === 'http://www.w3.org/2000/svg' ? s.fill : s.color
        const key = signature(el) + colorText
        if (seen.has(key)) continue
        const range = document.createRange()
        range.selectNodeContents(node)
        if (!range.getClientRects().length) continue
        seen.add(key)
        el.scrollIntoView({ block: 'center', inline: 'center' })
        const rect = range.getClientRects()[0]
        if (!rect.width || !rect.height) continue
        push(el, rect, parse(colorText), node.textContent, 'text')
      }
      for (const field of scope.querySelectorAll('input, select, textarea')) {
        if (field.type === 'file' || field.hidden || !field.getClientRects().length) continue
        field.scrollIntoView({ block: 'center' })
        const rect = field.getBoundingClientRect()
        const hasValue = field.value !== '' && field.value !== undefined
        if (hasValue) push(field, rect, parse(getComputedStyle(field).color), String(field.value), 'value')
        if (field.placeholder && !hasValue) push(field, rect, parse(getComputedStyle(field, '::placeholder').color), field.placeholder, 'placeholder')
      }
    }
    return out
  }

  /** Buttons whose whole label is an icon: the icon is the only way to know what they do. */
  function auditIconButtons(names) {
    const out = []
    const sheets = [...document.querySelectorAll('.sheet:not(.sheet-out)')]
    const scope = document.querySelector('.voice-panel') ?? sheets[sheets.length - 1] ?? document.body
    for (const b of scope.querySelectorAll('button')) {
      const icon = b.querySelector('svg')
      if (!icon || b.textContent.trim() || !b.getClientRects().length || b.matches(':disabled')) continue
      b.scrollIntoView({ block: 'center', inline: 'center' })
      const color = parse(getComputedStyle(icon).color)
      const m = spot(icon, icon.getBoundingClientRect(), color)
      if (m) out.push({ where: describe(b), kind: 'icon', text: b.getAttribute('aria-label') ?? '', need: 3, ratio: m.ratio, fg: m.fg, bg: m.bg, fgToken: names[m.rawFg]?.join('|') ?? '', bgToken: names[m.bg]?.join('|') ?? '' })
    }
    return out
  }

  window.__contrast = { measurePairs, tokenNames, auditText, auditIconButtons }
  const still = document.createElement('style')
  still.textContent = '*,*::before,*::after{transition:none!important;animation:none!important;scroll-behavior:auto!important}'
  document.head.appendChild(still)
  return true
}

// ---- a scripted recognizer, so the voice panel opens without a microphone
const SCRIPTED_VOICE = `(() => {
  class ScriptedRecognition {
    start() {
      setTimeout(() => this.onaudiostart?.(), 30)
      setTimeout(() => this.onspeechstart?.(), 60)
      setTimeout(() => this.onresult?.({ results: [Object.assign([{ transcript: 'got 250 from rahul', confidence: 0 }], { isFinal: false })] }), 90)
    }
    stop() {}
    abort() { setTimeout(() => this.onend?.(), 10) }
  }
  window.SpeechRecognition = window.webkitSpeechRecognition = ScriptedRecognition
})()`

// a headless tab counts as a background one: without these its timers run late and the walk gets ahead of the app
const browser = await launch({ args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] })
const evaluate = browser.evaluate
/** Presses the first visible `selector` whose words start with `text`, or with any of a list of them: anywhere, or in
 *  the top sheet only. False when there's none. */
const press = (selector, text, topSheet) =>
  evaluate(`(() => {
    const sheets = [...document.querySelectorAll('.sheet:not(.sheet-out)')]
    const scope = ${topSheet} ? sheets[sheets.length - 1] : document
    if (!scope) return false
    const texts = [].concat(${JSON.stringify(text)})
    const el = [...scope.querySelectorAll(${JSON.stringify(selector)})].filter((e) => e.getClientRects().length).find((e) => texts.some((t) => e.textContent.trim().startsWith(t)))
    if (!el) return false
    el.click()
    return true
  })()`)
// A control the walk can't find means the UI has moved: what it would have opened goes unmeasured, and the states after
// it may be measured in the wrong place. Each miss is listed and fails the run, so the run can't pass on less than it says.
const missed = []
const miss = (what) => {
  missed.push({ what, after: lastState, combo: current })
  console.log(`    (could not find: ${what}, after ${lastState})`)
}
const pressOrMiss = async (selector, text, topSheet) => {
  if (await press(selector, text, topSheet)) return true
  miss(`${selector}${text.length ? ` "${[].concat(text).join('" or "')}"` : ''}${topSheet ? ' in the top sheet' : ''}`)
  return false
}
const click = (selector, text = '') => pressOrMiss(selector, text, false)
const inTop = (selector, text = '') => pressOrMiss(selector, text, true)
const closeTop = async () => {
  const found = await evaluate(`(() => { const all = [...document.querySelectorAll('.scrim:not(.scrim-out)')]; all[all.length - 1]?.click(); return all.length > 0 })()`)
  if (!found) miss('a sheet to close')
  // a sheet on its way out still covers what's behind it
  await browser.waitFor(`!document.querySelector('.sheet-out')`, 5000)
}
const open = async (name, record, action) => {
  const before = missed.length
  const did = await action()
  if (did === false) {
    // a press has said what it couldn't find already; an action that looks for itself hasn't
    if (missed.length === before) miss(`what opens ${name}`)
    console.log(`    (could not open: ${name})`)
    return
  }
  await sleep(220)
  await record(name)
}
const settings = (patch) =>
  evaluate(`(async () => { const { saveSettings } = await import('/src/db/db.ts'); await saveSettings(${JSON.stringify(patch)}); return true })()`)
const prepare = () => evaluate(`(${installLib.toString()})()`)
const navigate = async (url, ready = `!!document.querySelector('nav.tabbar')`) => {
  await browser.send('Page.navigate', { url })
  await browser.waitFor(ready, 90000)
  await prepare()
}

const combos = () => {
  const list = []
  for (const theme of THEMES) {
    for (const accent of PRESETS) list.push({ theme, accent, id: `${theme}:${accent}` })
    for (const hue of CUSTOM_HUES) list.push({ theme, accent: 'custom', hue, id: `${theme}:custom${hue}` })
  }
  return only.length ? list.filter((c) => only.includes(c.id)) : list
}
const applyCombo = async (c) => {
  await settings({ theme: c.theme, accent: c.accent, ...(c.hue !== undefined ? { accentHue: c.hue } : {}) })
  await sleep(200)
}

const failures = []
const allMeasured = []
const iconRows = []
let current = ''
let lastState = ''
const record = async (state) => {
  lastState = state
  const names = await evaluate(`__contrast.tokenNames(${JSON.stringify(NAMED)})`)
  const rows = await evaluate(`__contrast.auditText(${JSON.stringify(names)})`)
  const icons = await evaluate(`__contrast.auditIconButtons(${JSON.stringify(names)})`)
  for (const r of rows) {
    r.state = state
    r.combo = current
    allMeasured.push(r)
    if (!r.exempt && r.ratio < r.need) failures.push(r)
  }
  for (const r of icons) {
    r.state = state
    r.combo = current
    iconRows.push(r)
  }
}

async function walkWelcome() {
  // the first step moves on by itself after a beat, so Back is only there once it has
  for (let i = 0; i < 2; i++) {
    await press('button[aria-label="Back"]', '', false)
    await sleep(120)
  }
  await record('Welcome')
  await browser.waitFor(`[...document.querySelectorAll('button.btn')].some((b) => b.textContent.startsWith('Continue'))`)
  await record('Welcome, currency')
  await click('button.btn', 'Continue')
  await sleep(150)
  await record('Welcome, budget')
}

async function walkApp() {
  const tab = (name) => click('nav button.tab', name)

  await tab('Home')
  await sleep(300)
  await record('Home')
  await open('Home, row selected', record, async () => {
    const pressed = await evaluate(`(() => { const row = document.querySelector('.screen button.txn-row'); if (!row) return false; row.scrollIntoView({ block: 'center' }); row.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 })); return true })()`)
    await browser.waitFor(`!!document.querySelector('button[aria-label="Delete selected"]')`, 5000)
    await evaluate(`(() => { document.querySelector('.screen button.txn-row')?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 })); return true })()`)
    return pressed
  })
  // a toast on its own: raised while a tall sheet is open it sits behind the sheet
  await open('Toast', record, () => click('button[aria-label="Delete selected"]'))
  await click('.toast-undo')
  await sleep(250)

  await open('Balance', record, () => click('button.card', 'Balance'))
  await closeTop()
  await open('Day detail', record, () => click('button.weekbar-col:not(:disabled)'))
  await closeTop()

  await open('Lent & borrowed', record, () => click('button.card', 'Lent'))
  await open('Loan detail', record, () => inTop('button.txn-row'))
  await closeTop()
  await open('Loan, new', record, () => inTop('button.btn'))
  await inTop('button[aria-label="Back"]')
  await sleep(200)
  await closeTop()

  await open('Trip', record, () => click('button.card', 'Goa trip'))
  await open('Trip, toast', record, () => inTop('button.pill', 'Paid'))
  await click('.toast-undo')
  await sleep(250)
  await open('Trip, money handed over', record, () => inTop('button.caption', 'Someone handed'))
  await closeTop()
  await open('Trip, edit', record, () => inTop('button[aria-label="Edit trip"]'))
  await inTop('button[aria-label="Back"]')
  await sleep(200)
  await open('Trips list', record, () => inTop('button[aria-label="All trips"]'))
  await open('New trip', record, () => inTop('button.btn', 'Start a trip'))
  await closeTop()

  await open('Add', record, () => click('button.fab'))
  await open('Add, received', record, () => inTop('.seg button', 'Received'))
  await open('Add, typed', record, async () => {
    for (const k of ['3', '4', '9']) {
      await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: `Digit${k}`, text: k })
      await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: `Digit${k}` })
    }
    return true
  })
  await inTop('.seg button', 'Spent')
  await open('Add, note', record, () => inTop('button.pill', 'Note'))
  await open('Add, account', record, () =>
    evaluate(`(() => {
      const sheets = [...document.querySelectorAll('.sheet:not(.sheet-out)')]
      const pill = [...sheets[sheets.length - 1].querySelectorAll('button.pill:not(.trip-line)')][1]
      pill?.click()
      return !!pill
    })()`)
  )
  await closeTop()
  // every tag: the "More" chip after the suggestions, or the "All tags" link in their heading, whichever this build has
  await open('Add, all tags', record, () => inTop('button', ['All tags', 'More']))
  await open('Add, edit tags', record, () => inTop('button[aria-label="Edit tags"]'))
  await closeTop()
  await closeTop()
  await open('Add, trip split', record, () => inTop('button.pill.trip-line'))
  await closeTop()
  await open('Voice', record, async () => {
    const did = await inTop('button[aria-label="Say it instead"]')
    await sleep(500)
    return did
  })
  // the Add sheet closed as the voice screen opened, so Cancel leaves nothing open
  await click('.voice-panel button.btn.ghost', 'Cancel')
  await sleep(350)

  await open('Settings', record, () => click('button[aria-label="Settings"]'))
  for (const row of ['Profiles', 'Accounts', 'Currency', 'App lock']) {
    await open(`Settings, ${row}`, record, () => inTop('button.action-row', row))
    await closeTop()
  }
  await open('Taily Pro', record, () => inTop('button.action-row', 'Encrypted backup'))
  await closeTop()
  await closeTop()

  await tab('Activity')
  await sleep(300)
  await record('Activity')
  await evaluate(`(() => {
    const input = document.querySelector('.searchbar input')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'zzzzz')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await sleep(200)
  await record('Activity, nothing found')
  await click('button[aria-label="Clear search"]')
  await sleep(200)

  await tab('Budgets')
  await sleep(300)
  await record('Budgets')
  await open('Budget dialog', record, () => click('.screen button.card'))
  await closeTop()
  await open('Goal dialog', record, () => click('.screen button.btn.ghost', 'Start saving'))
  await closeTop()

  await tab('Insights')
  await sleep(300)
  await open('Insights', record, () => click('.screen button[aria-expanded]'))
  await open('Monthly report', record, () => click('button.action-row', 'Monthly report'))
  await closeTop()
  await tab('Home')
  await sleep(200)
}

/** What a Play build keeps behind Pro: Google Play's cached answer unlocks it on a fresh load. */
async function walkPro() {
  for (const theme of THEMES) {
    current = `${theme}:pro`
    await settings({ theme, accent: 'blue' })
    await evaluate(`localStorage.setItem('taily.pro', '1'); true`)
    await navigate(appUrl)
    await sleep(600)
    await open('Settings, Pro owned', record, () => click('button[aria-label="Settings"]'))
    await open('Encrypted backup', record, () => inTop('button.action-row', 'Encrypted backup'))
    await closeTop()
    await closeTop()
    await click('nav button.tab', 'Budgets')
    await sleep(300)
    await open('Monthly payment, new', record, () => click('.screen button.btn.ghost', 'Add a monthly'))
    await closeTop()
    await open('Monthly payment', record, () => click('.screen button.txn-row', 'Old gym'))
    await closeTop()
  }
  await evaluate(`localStorage.removeItem('taily.pro'); true`)
}

/** The lock screen comes up on a fresh load only. */
async function walkLock() {
  const pin = await evaluate(`import('/src/lib/pin.ts').then((m) => m.hashPin('1234'))`)
  for (const theme of THEMES) {
    current = `${theme}:lock`
    await settings({ theme, accent: 'blue', pinHash: pin })
    await navigate(appUrl, `!!document.querySelector('button.key')`)
    await sleep(200)
    await record('Lock screen')
    await settings({ pinHash: null })
  }
  await navigate(appUrl)
}

function table(rows, columns) {
  const widths = columns.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c]).length)))
  const line = (cells) => cells.map((v, i) => String(v).padEnd(widths[i])).join('  ')
  return [line(columns), ...rows.map((r) => line(columns.map((c) => r[c])))].join('\n')
}
const fixed = (n) => n.toFixed(2)

try {
  await browser.send('Page.enable')
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 700, deviceScaleFactor: 1, mobile: true })
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: SCRIPTED_VOICE })

  console.log(`loading ${appUrl} ...`)
  await browser.send('Page.navigate', { url: appUrl })
  await browser.waitFor(`document.querySelector('#root') && document.querySelector('#root').children.length > 0`, 90000)
  await prepare()
  await sleep(600)

  // ---- part 1: token pairs
  console.log('\n== part 1: token pairs ==')
  const pairFails = []
  const pairRows = new Map()
  const note = (combo, rows, need, label) => {
    for (const r of rows) {
      const key = `${combo}|${r.fg}|${r.bg}`
      const prev = pairRows.get(key)
      if (!prev || r.ratio < prev.ratio) pairRows.set(key, { combo, fg: r.fg, bg: r.bg, fgHex: r.fgHex, bgHex: r.bgHex, ratio: r.ratio, need, label })
    }
  }
  const setRoot = (theme, accent) =>
    evaluate(`(() => { const d = document.documentElement.dataset; d.theme = ${JSON.stringify(theme)}; d.accent = ${JSON.stringify(accent)}; return true })()`)
  const presetHues = await evaluate(`import('/src/lib/theme.ts').then((m) => m.PRESET_HUES)`)
  for (const theme of THEMES) {
    for (const accent of [...PRESETS, 'fallback']) {
      await setRoot(theme, accent)
      if (accent in presetHues) await evaluate(`import('/src/lib/theme.ts').then((m) => { m.applyCustomAccent(${presetHues[accent]}, ${theme === 'dark'}); return true })`)
      else await evaluate(`import('/src/lib/theme.ts').then((m) => { m.clearCustomAccent(); return true })`)
      const combo = `${theme}:${accent}`
      note(combo, await evaluate(`__contrast.measurePairs(${JSON.stringify(TOKEN_PAIRS)})`), 4.5, 'text')
      for (const [fg, surfaces, label] of MARK_PAIRS) note(combo, await evaluate(`__contrast.measurePairs(${JSON.stringify([[fg, surfaces]])})`), 3, label)
    }
    // the whole slider, through the app's own function
    await setRoot(theme, 'custom')
    const sweep = await evaluate(`import('/src/lib/theme.ts').then((m) => {
      const worst = new Map()
      const add = (rows, need, label, hue) => {
        for (const r of rows) {
          const key = r.fg + '|' + r.bg
          const prev = worst.get(key)
          if (!prev || r.ratio < prev.ratio) worst.set(key, { ...r, need, label, hue })
        }
      }
      for (let hue = 0; hue < 360; hue++) {
        m.applyCustomAccent(hue, ${theme === 'dark'})
        add(__contrast.measurePairs(${JSON.stringify(TOKEN_PAIRS)}), 4.5, 'text', hue)
        for (const [fg, surfaces, label] of ${JSON.stringify(MARK_PAIRS)}) add(__contrast.measurePairs([[fg, surfaces]]), 3, label, hue)
      }
      m.clearCustomAccent()
      return [...worst.values()]
    })`)
    for (const r of sweep) pairRows.set(`${theme}:slider|${r.fg}|${r.bg}`, { combo: `${theme}:slider (worst hue ${r.hue})`, fg: r.fg, bg: r.bg, fgHex: r.fgHex, bgHex: r.bgHex, ratio: r.ratio, need: r.need, label: r.label })
  }
  const pairs = [...pairRows.values()]
  for (const r of pairs) if (r.label === 'text' && r.ratio < r.need) pairFails.push(r)
  const show = (r) => ({ ...r, ratio: fixed(r.ratio) })
  console.log(`${pairs.filter((r) => r.label === 'text').length} text pairs measured, ${pairFails.length} under 4.5:1`)
  if (pairFails.length) console.log(table(pairFails.sort((a, b) => a.ratio - b.ratio).map(show), ['combo', 'fg', 'bg', 'fgHex', 'bgHex', 'ratio']))
  const lowest = (fg, bg) => pairs.filter((r) => r.fg === fg && (!bg || r.bg === bg)).sort((a, b) => a.ratio - b.ratio)[0]
  const marks = pairs.filter((r) => r.label !== 'text' && r.ratio < 3).sort((a, b) => a.ratio - b.ratio)
  console.log(`\nnot text, 3:1 is the bar: ${marks.length} pairs under it`)
  if (marks.length) console.log(table(marks.slice(0, 40).map(show), ['combo', 'label', 'fg', 'bg', 'fgHex', 'bgHex', 'ratio']))
  console.log('\nlowest pair per text token:')
  console.log(table(TOKEN_PAIRS.map(([fg]) => lowest(fg)).filter(Boolean).map(show), ['fg', 'bg', 'combo', 'fgHex', 'bgHex', 'ratio']))

  // ---- part 2: every screen
  console.log('\n== part 2: rendered text ==')
  await browser.send('Page.navigate', { url: appUrl })
  await browser.waitFor(`document.querySelector('#root') && document.querySelector('#root').children.length > 0`, 90000)
  await prepare()
  await sleep(300)
  for (const c of combos()) {
    current = c.id
    await applyCombo(c)
    await walkWelcome()
  }

  console.log('seeding a demo month ...')
  await evaluate(`(${seed.toString()})()`)
  await browser.send('Page.navigate', { url: appUrl })
  await browser.waitFor(`!!document.querySelector('nav.tabbar')`, 90000)
  await prepare()
  await sleep(1500)
  await evaluate(`(${seedTrip.toString()})()`)
  // the states the demo month doesn't reach on its own: over budget, overdue, paused, archived, in the red
  await evaluate(`(async () => {
    const [{ db }, rules, loans] = await Promise.all([import('/src/db/db.ts'), import('/src/db/recurring.ts'), import('/src/db/loans.ts')])
    await db.budgets.put({ id: 'entertainment', amountMinor: 20000 })
    await db.budgets.put({ id: 'transport', amountMinor: 280000 })
    const paused = await rules.addRule({ name: 'Old gym', amountMinor: 120000, categoryId: 'health', dayOfMonth: 9 })
    await rules.togglePauseRule(paused.id)
    await db.categories.update('rent', { archived: 1 })
    await db.accounts.update('cash', { archived: 1 })
    const iso = new Date(Date.now() - 864e5).toISOString().slice(0, 10)
    await loans.addLoan({ direction: 'lent', person: 'Sam', amountMinor: 50000, currency: 'INR', note: 'Late', remindISO: iso })
    return true
  })()`)
  await sleep(300)
  for (const c of combos()) {
    current = c.id
    console.log(`  ${c.id}`)
    await applyCombo(c)
    await walkApp()
  }
  await walkPro()
  await walkLock()

  // ---- part 3: the pages outside the app
  console.log('\n== part 3: trip.html and privacy.html ==')
  const hash = await evaluate(`(async () => {
    const [{ tripsOverview }, { db }, { tripLink, tripPayload }] = await Promise.all([import('/src/db/trips.ts'), import('/src/db/db.ts'), import('/src/lib/tripLink.ts')])
    const [o] = await tripsOverview()
    return tripLink(tripPayload(o.trip, o.summary, o.entries, await db.categories.toArray(), 'INR')).split('#')[1]
  })()`)
  for (const scheme of ['light', 'dark']) {
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] })
    current = `page:${scheme}`
    await browser.send('Page.navigate', { url: `${appUrl}/trip.html#${hash}` })
    await browser.waitFor(`document.readyState === 'complete' && document.querySelectorAll('main .card').length > 0`, 30000)
    await prepare()
    await sleep(200)
    await record('trip.html')
    await browser.send('Page.navigate', { url: `${appUrl}/privacy.html` })
    await browser.waitFor(`document.readyState === 'complete'`, 30000)
    await prepare()
    await sleep(200)
    await record('privacy.html')
  }

  // ---- what came out
  const groups = new Map()
  for (const r of failures) {
    const key = `${r.where}|${r.fgToken}|${r.bgToken}`
    const g = groups.get(key) ?? { where: r.where, fg: r.fgToken || r.fg, bg: r.bgToken || r.bg, ratio: r.ratio, need: r.need, px: r.px, sample: r.text, state: r.state, combos: new Set(), hidden: r.hidden }
    g.combos.add(r.combo)
    if (r.ratio < g.ratio) Object.assign(g, { ratio: r.ratio, sample: r.text, state: r.state })
    groups.set(key, g)
  }
  const rows = [...groups.values()].sort((a, b) => a.ratio - b.ratio).map((g) => ({ ...g, ratio: fixed(g.ratio), combos: g.combos.size, sample: g.sample + (g.hidden ? ' (aria-hidden)' : '') }))
  console.log(`\n${allMeasured.length} text spots measured, ${allMeasured.filter((r) => r.exempt).length} in disabled controls (exempt), ${failures.length} failing, ${rows.length} distinct`)
  if (rows.length) console.log(table(rows, ['ratio', 'need', 'px', 'where', 'fg', 'bg', 'combos', 'state', 'sample']))

  const iconGroups = new Map()
  for (const r of iconRows.filter((x) => x.ratio < 3)) {
    const key = `${r.where}|${r.text}|${r.fgToken}`
    const g = iconGroups.get(key) ?? { ...r, combos: new Set() }
    g.combos.add(r.combo)
    if (r.ratio < g.ratio) g.ratio = r.ratio
    iconGroups.set(key, g)
  }
  const iconTable = [...iconGroups.values()].sort((a, b) => a.ratio - b.ratio).map((g) => ({ ...g, ratio: fixed(g.ratio), combos: g.combos.size }))
  console.log(`\nicon-only buttons under 3:1: ${iconTable.length}`)
  if (iconTable.length) console.log(table(iconTable, ['ratio', 'where', 'text', 'fgToken', 'bgToken', 'combos', 'state']))

  if (missed.length) {
    const lost = new Map()
    for (const m of missed) {
      const key = `${m.what}|${m.after}`
      const g = lost.get(key) ?? { what: m.what, after: m.after, combos: new Set() }
      g.combos.add(m.combo)
      lost.set(key, g)
    }
    console.log(`\ncontrols the walk could not find: ${lost.size}. What they open went unmeasured; the walk needs updating to the UI`)
    console.log(table([...lost.values()].map((g) => ({ ...g, combos: g.combos.size })), ['what', 'after', 'combos']))
  }

  if (process.env.CONTRAST_JSON) {
    writeFileSync(process.env.CONTRAST_JSON, JSON.stringify({ pairs, measured: allMeasured, icons: iconRows, missed }))
  }
  const bad = pairFails.length + failures.length + missed.length
  console.log(bad ? `\nFAILED: ${pairFails.length} token pairs, ${failures.length} rendered spots, ${missed.length} controls not found` : '\nPASSED: all text meets its bar')
  process.exitCode = bad ? 1 : 0
} finally {
  browser.close()
}
