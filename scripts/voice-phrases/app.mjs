// Says phrases to the running app and reads back what Taily saved: the real + button held down, the voice
// screen, the recognizer's alternatives, the ranking in VoiceOverlay and the database, in a throwaway headless
// browser at a phone's size. The recognizer is scripted: window.SpeechRecognition hears window.__voiceAlts
// (the first one word by word as partial results, then all of them as the final result, the first with a
// confidence and the rest 0, as Android gives them).
//
//   1. serve the Play build:  npx vite --mode play --port 5180
//   2. then run:              node scripts/voice-phrases/app.mjs [http://127.0.0.1:5180] [folder for screenshots]
//
// Prints PASS/FAIL per check; exits 1 on any failure.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, sleep } from '../cdp.mjs'

const url = (process.argv[2] ?? 'http://127.0.0.1:5180').replace(/\/?$/, '/')
const shots = process.argv[3]
if (shots) mkdirSync(shots, { recursive: true })

const SCRIPTED_VOICE = `(() => {
  class ScriptedRecognition {
    constructor() { this.lang = 'en-IN'; this.interimResults = false; this.continuous = false; this.maxAlternatives = 1; this.text = ''; this.ended = false; this.pending = [] }
    later(ms, fn) { this.pending.push(setTimeout(fn, ms)) }
    emit(isFinal) {
      const alts = isFinal ? (window.__voiceAlts ?? [[this.text, 0.9]]).slice(0, this.maxAlternatives) : [[this.text, 0]]
      const result = Object.assign(alts.map(([transcript, confidence]) => ({ transcript, confidence })), { isFinal })
      this.onresult?.({ results: [result] })
    }
    start() {
      const words = (window.__voiceAlts?.[0]?.[0] ?? '').split(' ')
      this.later(120, () => this.onaudiostart?.())
      this.later(380, () => this.onspeechstart?.())
      words.forEach((_, i) => this.later(450 + i * 150, () => { this.text = words.slice(0, i + 1).join(' '); this.emit(false) }))
    }
    stop() { this.later(150, () => this.finish()) }
    abort() { this.ended = true; this.pending.forEach(clearTimeout); setTimeout(() => this.onend?.(), 10) }
    finish() { if (this.ended) return; this.ended = true; this.pending.forEach(clearTimeout); if (this.text) this.emit(true); setTimeout(() => this.onend?.(), 60) }
  }
  window.SpeechRecognition = window.webkitSpeechRecognition = ScriptedRecognition
  // headless stops drawing when nothing moves, and a hold then waits for a frame that never comes
  addEventListener('DOMContentLoaded', () => {
    const d = document.createElement('div')
    d.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.01;pointer-events:none'
    document.documentElement.appendChild(d)
    let n = 0
    const tick = () => { d.style.transform = 'translateX(' + (n++ % 2) + 'px)'; requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
  })
})()`

// Edge relaunches itself on Windows, so cdp.mjs's close() can miss the real browser: a marker finds it
const MARKER = `--taily-voice-app=${process.pid}-${Date.now()}`
function killMarked() {
  if (process.platform !== 'win32') return 0
  const ps = `Get-CimInstance Win32_Process -Filter "name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${MARKER}*' } | ForEach-Object { [regex]::Match($_.CommandLine, 'user-data-dir="?([^" ]+)').Groups[1].Value; Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`
  const out = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], { encoding: 'utf8' }).stdout ?? ''
  const dirs = [...new Set(out.split(/\r?\n/).map((s) => s.trim()).filter((s) => /taily-cdp-/.test(s)))]
  for (const d of dirs) {
    for (let i = 0; i < 24 && existsSync(d); i++) {
      try {
        rmSync(d, { recursive: true, force: true })
      } catch {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250)
      }
    }
  }
  return dirs.length
}

const results = []
const check = (name, ok, extra = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra !== '' ? ' :: ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''}`)
}

const b = await launch({
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', MARKER]
})
const ev = (js) => Promise.race([b.evaluate(js), new Promise((_, rej) => setTimeout(() => rej(new Error('hung evaluating: ' + js.slice(0, 160))), 20000))])
const db = (expr) => ev(`import('/src/db/db.ts').then(async ({ db }) => (${expr}))`)
const shot = async (name) => {
  if (!shots) return
  const { data } = await b.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(shots, name + '.png'), Buffer.from(data, 'base64'))
}
const pointer = (type) =>
  ev(`(() => { const f = document.querySelector('[data-voice-anchor]'); const r = f.getBoundingClientRect(); f.dispatchEvent(new PointerEvent('${type}', { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 })); return true })()`)
const panelText = () => ev(`(document.querySelector('.voice-panel')?.innerText ?? '').replace(/\\n+/g, ' | ')`)

/** Holds +, "says" the alternatives, lets go; gives the saved card's text and what reached the database. */
async function say(alts, shotName) {
  const before = await db(`db.txns.toArray()`)
  const beforeIds = new Set(before.map((t) => t.id))
  await ev(`window.__voiceAlts = ${JSON.stringify(alts)}; true`)
  await pointer('pointerdown')
  const words = alts[0][0].split(' ').length
  await sleep(300 + 450 + words * 150 + 400)
  const live = await panelText()
  await pointer('pointerup')
  await b.waitFor(`!!document.querySelector('.voice-status.saved, .voice-fail-title')`, 8000).catch(() => {})
  await sleep(250)
  const card = await panelText()
  if (shotName) await shot(shotName)
  const after = await db(`db.txns.toArray()`)
  const txn = after.find((t) => !beforeIds.has(t.id)) ?? null
  const entry = txn?.tripEntryId ? await db(`db.tripEntries.get(${JSON.stringify(txn.tripEntryId)})`) : null
  // let the saved card go before the next phrase
  await b.waitFor(`!document.querySelector('.voice-layer')`, 9000).catch(() => {})
  await sleep(300)
  return { live, card, txn, entry }
}

let failed = false
try {
  await b.send('Page.enable')
  await b.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 740, deviceScaleFactor: 2, mobile: true })
  await b.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await b.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {})
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: SCRIPTED_VOICE })
  await b.send('Page.navigate', { url })
  await b.waitFor(`document.querySelector('#root') && document.querySelector('#root').children.length > 0`, 120000)
  // a fresh install that has seen its first-run screens, with no sounds or vibration
  await ev(`(async () => {
    const { db, DEFAULT_SETTINGS } = await import('/src/db/db.ts')
    for (let i = 0; i < 60 && (await db.categories.count()) === 0; i++) await new Promise((r) => setTimeout(r, 100))
    await db.kv.put({ key: 'settings', value: { ...DEFAULT_SETTINGS, initialized: true, currency: 'INR', theme: 'light', sounds: false, haptics: false } })
    localStorage.setItem('taily.voicehint.seen', '1')
    return true
  })()`)
  await b.send('Page.navigate', { url })
  await b.waitFor(`!!document.querySelector('[data-voice-anchor]')`, 60000)
  await sleep(1200)
  const served = await ev(`import('/src/lib/parseSpeech.ts').then((m) => typeof m.pickAlternative === 'function')`)
  check('the dev server serves this tree (pickAlternative exists)', served)

  console.log('--- outside a trip')
  {
    // a price said in pieces: the recognizer's first guess is "to 50", another heard all of it
    const r = await say([['to 50 lunch', 0.83], ['250 lunch', 0], ['two 50 lunch', 0], ['2 50 lunch', 0]], '01-pieces-saved')
    check('"to 50 lunch" beside "250 lunch" saves ₹250 Food', r.txn?.amountMinor === 25000 && r.txn?.categoryId === 'food' && r.txn?.kind === 'out', { card: r.card, txn: r.txn && { amt: r.txn.amountMinor, cat: r.txn.categoryId, note: r.txn.note } })
    check('the saved card says ₹250 and Food', r.card.includes('Saved') && r.card.includes('₹250') && r.card.includes('Food'), r.card)
  }
  {
    const r = await say([['200 shoe polish', 0.8], ['200 show polish', 0], ['200 shoes polish', 0]])
    check('a tag in a less sure alternative doesn\'t win: "shoe polish", not a show', r.txn?.amountMinor === 20000 && r.txn?.categoryId !== 'entertainment' && /shoe polish/i.test(r.txn?.note ?? ''), r.txn && { cat: r.txn.categoryId, note: r.txn.note })
  }
  {
    const r = await say([['groceries 800 from DMart', 0.9]])
    check('"groceries 800 from DMart" is a spend', r.txn?.kind === 'out' && r.txn?.amountMinor === 80000 && r.txn?.categoryId === 'groceries', r.txn && { kind: r.txn.kind, cat: r.txn.categoryId })
  }
  {
    const r = await say([['papa ne 2000 bheje', 0.9]], '02-income-saved')
    check('"papa ne 2000 bheje" is money in', r.txn?.kind === 'in' && r.txn?.amountMinor === 200000, { card: r.card, kind: r.txn?.kind })
    check('the card shows it as received (+₹2,000)', r.card.includes('+₹2,000'), r.card)
  }
  {
    const r = await say([['300 dinner on the 3rd', 0.9]])
    const want = (() => {
      const now = new Date()
      const d = now.getDate() >= 3 ? new Date(now.getFullYear(), now.getMonth(), 3) : new Date(now.getFullYear(), now.getMonth() - 1, 3)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-03`
    })()
    check('"300 dinner on the 3rd" is ₹300 on the 3rd, note "Dinner"', r.txn?.amountMinor === 30000 && r.txn?.dateISO === want && r.txn?.note === 'Dinner', r.txn && { amt: r.txn.amountMinor, date: r.txn.dateISO, note: r.txn.note })
  }
  {
    const r = await say([['120 auto G Pay', 0.9]])
    check('"120 auto G Pay" is paid by UPI, note "Auto"', r.txn?.accountId === 'upi' && r.txn?.note === 'Auto' && r.txn?.categoryId === 'transport', r.txn && { acc: r.txn.accountId, note: r.txn.note })
  }
  {
    const r = await say([['कल 400 का खाना', 0.9]])
    const y = new Date(Date.now() - 86400000)
    const yesterday = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`
    check('Devanagari "कल 400 का खाना": ₹400 Food yesterday, note kept in Devanagari', r.txn?.amountMinor === 40000 && r.txn?.categoryId === 'food' && r.txn?.dateISO === yesterday && r.txn?.note === 'खाना', r.txn && { amt: r.txn.amountMinor, cat: r.txn.categoryId, date: r.txn.dateISO, note: r.txn.note })
  }

  console.log('--- inside a trip')
  const trip = await ev(`import('/src/db/trips.ts').then((t) => t.startTrip({ name: 'Goa trip', myName: 'Jatin', others: ['Aarav', 'Rahul', 'Meera', 'Karan'], budgetMinor: null }))`)
  await sleep(800)
  const meera = trip.people.find((p) => p.name === 'Meera').id
  {
    // "Mira" for Meera, with alternatives that disagree on the amount without one ending in the other
    const r = await say([['Mira paid 1500 for dinner', 0.86], ['Meera paid 1500 for dinner', 0], ['Mira paid 15 for dinner', 0]], '03-trip-saved')
    check('voice preview showed Meera paying, split 5', r.live.includes('Meera paid · split 5'), r.live)
    check('trip spend: ₹1,500 Food paid by Meera, split between all 5', r.entry?.amountMinor === 150000 && r.entry?.paidBy === meera && r.entry?.among?.length === 5 && r.entry?.categoryId === 'food', r.entry && { amt: r.entry.amountMinor, paidBy: r.entry.paidBy === meera ? 'meera' : r.entry.paidBy, among: r.entry.among.length, cat: r.entry.categoryId })
    check('your share (₹300) is what reached your expenses', r.txn?.amountMinor === 30000 && r.txn?.tripEntryId === r.entry?.id, r.txn && { amt: r.txn.amountMinor })
    check('the saved card says Meera paid', r.card.includes('Meera paid'), r.card)
  }
  {
    const r = await say([['Rahul ne cab ka 800 pay kiya', 0.9]])
    const rahul = trip.people.find((p) => p.name === 'Rahul').id
    check('"Rahul ne cab ka 800 pay kiya": ₹800 Transport paid by Rahul', r.entry?.amountMinor === 80000 && r.entry?.paidBy === rahul && r.entry?.categoryId === 'transport', r.entry && { amt: r.entry.amountMinor, cat: r.entry.categoryId })
  }
} catch (e) {
  failed = true
  check('script ran to the end', false, e.message)
  await shot('zz-failure').catch(() => {})
} finally {
  b.close()
  const stopped = killMarked()
  console.log(`edge cleanup: ${stopped ? 'stopped the relaunched browser' : 'nothing left running'}`)
  const bad = results.filter((r) => !r).length
  console.log(`\n${results.length - bad} of ${results.length} passed`)
  process.exit(bad || failed ? 1 : 0)
}
