// Says phrases to the running app and reads back what Taily saved: the real + button held down, the voice
// screen, the recognizer's alternatives, the ranking in VoiceOverlay and the database, in a throwaway headless
// browser at a phone's size. The recognizer is scripted: window.SpeechRecognition hears window.__voiceAlts
// (the first one word by word as partial results, then all of them as the final result, the first with a
// confidence and the rest 0, as Android gives them), and notes the language it was asked for in __voiceLang.
//
// Covers: readings Taily is sure of (saved at once, with Undo), readings it isn't (the check state: swap in
// another amount heard, Save, Edit into the add sheet), the voice language from Settings reaching the
// recognizer, and spends on a trip both ways.
//
//   1. serve the Play build:  npx vite --mode play --port 5191 --strictPort --host 127.0.0.1
//   2. then run:              node scripts/voice-phrases/app.mjs [http://127.0.0.1:5191] [folder for screenshots]
//
// Prints PASS/FAIL per check; exits 1 on any failure.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, sleep } from '../cdp.mjs'

const url = (process.argv[2] ?? 'http://127.0.0.1:5191').replace(/\/?$/, '/')
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
      window.__voiceLang = this.lang
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
const settings = (patch) => db(`db.kv.get('settings').then((row) => db.kv.put({ key: 'settings', value: { ...row.value, ...${JSON.stringify(patch)} } }))`)
const shot = async (name) => {
  if (!shots) return
  const { data } = await b.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(shots, name + '.png'), Buffer.from(data, 'base64'))
}
const pointer = (type) =>
  ev(`(() => { const f = document.querySelector('[data-voice-anchor]'); const r = f.getBoundingClientRect(); f.dispatchEvent(new PointerEvent('${type}', { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 })); return true })()`)
const panelText = () => ev(`(document.querySelector('.voice-panel')?.innerText ?? '').replace(/\\n+/g, ' | ')`)
/** Clicks the first button under `scope` whose text is `text`; false if there's none. */
const press = (scope, text) =>
  ev(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(scope + ' button')})].find((x) => x.innerText.trim() === ${JSON.stringify(text)}); el?.click(); return !!el })()`)
const txnIds = async () => new Set((await db(`db.txns.toArray()`)).map((t) => t.id))
/** What reached the database since `before`: the new transaction, its trip entry, and how many there were. */
async function added(before) {
  const fresh = (await db(`db.txns.toArray()`)).filter((t) => !before.has(t.id))
  const txn = fresh[0] ?? null
  const entry = txn?.tripEntryId ? await db(`db.tripEntries.get(${JSON.stringify(txn.tripEntryId)})`) : null
  return { txn, entry, count: fresh.length }
}
/** Waits for the voice screen to go (the saved card leaves by itself after 4.5 s). */
async function settle() {
  await b.waitFor(`!document.querySelector('.voice-layer')`, 9000).catch(() => {})
  await sleep(300)
}

/** Holds +, "says" the alternatives, lets go; gives what the panel showed while listening and how it ended. */
async function speak(alts, shotName) {
  const before = await txnIds()
  await ev(`window.__voiceAlts = ${JSON.stringify(alts)}; window.__voiceLang = null; true`)
  await pointer('pointerdown')
  const words = alts[0][0].split(' ').length
  await sleep(300 + 450 + words * 150 + 400)
  const live = await panelText()
  await pointer('pointerup')
  await b.waitFor(`!!document.querySelector('.voice-status.saved, .voice-fail-title, .voice-dot.check')`, 8000).catch(() => {})
  await sleep(350)
  const state = await ev(
    `document.querySelector('.voice-status.saved') ? 'saved' : document.querySelector('.voice-dot.check') ? 'check' : document.querySelector('.voice-fail-title') ? 'failed' : 'none'`
  )
  const card = await panelText()
  if (shotName) await shot(shotName)
  return { live, state, card, before, lang: await ev('window.__voiceLang') }
}

/** A reading Taily should be sure of: says it, reads what was saved, lets the card go. */
async function say(alts, shotName) {
  const r = await speak(alts, shotName)
  const got = await added(r.before)
  await settle()
  return { ...r, ...got }
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
  const served = await ev(`import('/src/lib/parseSpeech.ts').then((m) => typeof m.pickAlternative === 'function' && typeof m.LOW_CONFIDENCE === 'number')`)
  check('the dev server serves this tree (pickAlternative with LOW_CONFIDENCE)', served)

  console.log('--- sure: saved at once')
  {
    const r = await say([['Swiggy 340', 0.95], ['swiggy 340', 0], ['Swiggy 3:40', 0]], '01-sure-saved')
    check('readings that agree, scored 0.95: saved at once as ₹340 Food', r.state === 'saved' && r.txn?.amountMinor === 34000 && r.txn?.categoryId === 'food', { state: r.state, txn: r.txn && { amt: r.txn.amountMinor, cat: r.txn.categoryId } })
    check('the recognizer was asked for English (India) by default', r.lang === 'en-IN', r.lang)
  }
  {
    const r = await say([['250 lunch', -1]])
    check('one reading with no score (-1) is not low by itself: saved', r.state === 'saved' && r.txn?.amountMinor === 25000, { state: r.state, amt: r.txn?.amountMinor })
  }
  {
    const r = await say([['200 shoe polish', 0.95], ['200 show polish', 0], ['200 shoes polish', 0]])
    check('a tag in a less sure alternative doesn\'t win: "shoe polish", not a show', r.state === 'saved' && r.txn?.amountMinor === 20000 && r.txn?.categoryId !== 'entertainment' && /shoe polish/i.test(r.txn?.note ?? ''), r.txn && { cat: r.txn.categoryId, note: r.txn.note })
  }
  {
    const r = await say([['groceries 800 from DMart', 0.95]])
    check('"groceries 800 from DMart" is a spend', r.txn?.kind === 'out' && r.txn?.amountMinor === 80000 && r.txn?.categoryId === 'groceries', r.txn && { kind: r.txn.kind, cat: r.txn.categoryId })
  }
  {
    const r = await say([['papa ne 2000 bheje', 0.95]], '02-income-saved')
    check('"papa ne 2000 bheje" is money in', r.txn?.kind === 'in' && r.txn?.amountMinor === 200000, { card: r.card, kind: r.txn?.kind })
    check('the card shows it as received (+₹2,000)', r.card.includes('+₹2,000'), r.card)
  }
  {
    const r = await say([['300 dinner on the 3rd', 0.95]])
    const want = (() => {
      const now = new Date()
      const d = now.getDate() >= 3 ? new Date(now.getFullYear(), now.getMonth(), 3) : new Date(now.getFullYear(), now.getMonth() - 1, 3)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-03`
    })()
    check('"300 dinner on the 3rd" is ₹300 on the 3rd, note "Dinner"', r.txn?.amountMinor === 30000 && r.txn?.dateISO === want && r.txn?.note === 'Dinner', r.txn && { amt: r.txn.amountMinor, date: r.txn.dateISO, note: r.txn.note })
  }
  {
    const r = await say([['120 auto G Pay', 0.95]])
    check('"120 auto G Pay" is paid by UPI, note "Auto"', r.txn?.accountId === 'upi' && r.txn?.note === 'Auto' && r.txn?.categoryId === 'transport', r.txn && { acc: r.txn.accountId, note: r.txn.note })
  }
  {
    const r = await say([['कल 400 का खाना', 0.95]])
    const y = new Date(Date.now() - 86400000)
    const yesterday = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`
    check('Devanagari "कल 400 का खाना": ₹400 Food yesterday, note kept in Devanagari', r.txn?.amountMinor === 40000 && r.txn?.categoryId === 'food' && r.txn?.dateISO === yesterday && r.txn?.note === 'खाना', r.txn && { amt: r.txn.amountMinor, cat: r.txn.categoryId, date: r.txn.dateISO, note: r.txn.note })
  }

  console.log('--- not sure: the check state')
  {
    // what Google's recognizer really wrote for "Jio recharge two ninety nine" in the hearing check
    const r = await speak([['jio recharge 399', 0.95], ['jio recharge 299', 0]], '03-check-light')
    const nothing = await added(r.before)
    check('readings that disagree on the amount: the check state, nothing saved yet', r.state === 'check' && nothing.count === 0, { state: r.state, saved: nothing.count, card: r.card })
    check('it shows ₹399 big, the Bills tag and note, and ₹299 to swap in', /Check the amount/.test(r.card) && (await ev(`document.querySelector('.voice-big')?.innerText.replace(/\\s+/g, '')`)) === '₹399' && /Bills/.test(r.card) && /Jio recharge/.test(r.card) && (await ev(`[...document.querySelectorAll('.voice-alt')].map((x) => x.innerText.trim()).join(',')`)) === '₹299', r.card)
    const layout = await ev(`(() => {
      const panel = document.querySelector('.voice-panel').getBoundingClientRect()
      const boxes = [...document.querySelectorAll('.voice-panel .voice-actions .btn, .voice-panel .voice-alt')].map((x) => x.getBoundingClientRect())
      return { inside: boxes.every((r) => r.left >= panel.left - 0.5 && r.right <= panel.right + 0.5 && r.top >= 0 && r.bottom <= innerHeight), minH: Math.min(...boxes.map((r) => r.height)), panelTop: panel.top, panelBottom: panel.bottom, vw: innerWidth }
    })()`)
    check('Save, Edit and the chip sit inside the panel, on screen, at least 40px tall', layout.inside && layout.minH >= 40 && layout.panelTop >= 0, layout)
    check('focus moved into the panel', await ev(`document.querySelector('.voice-panel').contains(document.activeElement)`))
    await press('.voice-alts', '₹299')
    await sleep(300)
    check('one tap on ₹299 swaps it in: ₹299 big, ₹399 now the chip', (await ev(`document.querySelector('.voice-big')?.innerText.replace(/\\s+/g, '')`)) === '₹299' && (await ev(`[...document.querySelectorAll('.voice-alt')].map((x) => x.innerText.trim()).join(',')`)) === '₹399')
    check('the live region says the new amount', /Check the amount: ₹299/.test(await ev(`document.querySelector('.voice-panel [role=status]').innerText`)))
    await shot('04-check-swapped-light')
    const tapped = await press('.voice-actions', 'Save')
    await b.waitFor(`!!document.querySelector('.voice-status.saved')`, 6000).catch(() => {})
    // a second tap that lands as the card turns must not save it twice
    await press('.voice-actions', 'Save')
    await sleep(400)
    const got = await added(r.before)
    check('Save saves the swapped amount once: ₹299 Bills, note "Jio recharge"', tapped && got.count === 1 && got.txn?.amountMinor === 29900 && got.txn?.categoryId === 'bills' && got.txn?.note === 'Jio recharge', { count: got.count, txn: got.txn && { amt: got.txn.amountMinor, cat: got.txn.categoryId, note: got.txn.note } })
    check('then the saved card, with Undo', /Saved/.test(await panelText()) && /Undo/.test(await panelText()))
    await settle()
  }
  {
    // agree on the amount, but the recognizer scored its first reading low
    const r = await speak([['450 tea', 0.6]], '05-check-low-light')
    const nothing = await added(r.before)
    check('a reading scored 0.6 (low): the check state, no chips, nothing saved', r.state === 'check' && nothing.count === 0 && (await ev(`document.querySelectorAll('.voice-alt').length`)) === 0, { state: r.state, saved: nothing.count })
    await press('.voice-actions', 'Edit')
    await b.waitFor(`!!document.querySelector('.amount-num') && !document.querySelector('.voice-layer')`, 6000).catch(() => {})
    await sleep(500)
    const sheet = await ev(`(() => ({
      amount: document.querySelector('.amount-num')?.innerText.trim(),
      note: document.querySelector('input.field')?.value ?? null,
      firstTag: document.querySelector('.chip')?.innerText.trim(),
      save: [...document.querySelectorAll('.btn')].map((x) => x.innerText.trim()).find((t) => t.startsWith('Save'))
    }))()`)
    check('Edit opens the add sheet with ₹450, the note "Tea" and Food first', sheet.amount === '450' && sheet.note === 'Tea' && sheet.firstTag === 'Food' && sheet.save === 'Save ₹450', sheet)
    await shot('06-edit-sheet-light')
    check('nothing was saved by Edit itself', (await added(r.before)).count === 0)
    await press('', 'Save ₹450')
    await sleep(700)
    const got = await added(r.before)
    check('saving from the sheet gives ₹450 Food, note "Tea"', got.count === 1 && got.txn?.amountMinor === 45000 && got.txn?.categoryId === 'food' && got.txn?.note === 'Tea', got.txn && { amt: got.txn.amountMinor, cat: got.txn.categoryId, note: got.txn.note })
    // the sheet's toast stays a while; saying the next one dismisses it, as on the phone
    await sleep(900)
  }
  {
    // the 2.13.1 case: "to 50" beside "250"; still 250 shown, but now Taily asks
    const r = await speak([['to 50 lunch', 0.83], ['250 lunch', 0], ['two 50 lunch', 0], ['2 50 lunch', 0]])
    check('"to 50 lunch" beside "250 lunch": the check state with ₹250 big and ₹50 to swap in', r.state === 'check' && (await ev(`document.querySelector('.voice-big')?.innerText.replace(/\\s+/g, '')`)) === '₹250' && (await ev(`[...document.querySelectorAll('.voice-alt')].map((x) => x.innerText.trim()).join(',')`)) === '₹50', r.card)
    await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`)
    await settle()
    check('Escape (Android\'s back) leaves without saving', (await added(r.before)).count === 0 && !(await ev(`!!document.querySelector('.voice-layer')`)))
  }

  console.log('--- the voice language')
  {
    // through Settings, as a person would
    await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /settings/i.test(x.getAttribute('aria-label') ?? '')); b?.click(); return !!b })()`)
    await b.waitFor(`[...document.querySelectorAll('.label')].some((x) => x.innerText.trim() === 'Voice language')`, 6000).catch(() => {})
    const row = await ev(`(() => { const g = document.querySelector('[aria-labelledby=voice-language]'); return g ? [...g.querySelectorAll('button')].map((x) => x.innerText.trim() + (x.getAttribute('aria-pressed') === 'true' ? '*' : '')) : null })()`)
    check('Settings has a Voice language row: English (India) picked, Hindi, English (US), English (UK)', JSON.stringify(row) === JSON.stringify(['English (India)*', 'Hindi', 'English (US)', 'English (UK)']), row)
    await ev(`document.querySelector('[aria-labelledby=voice-language]').scrollIntoView({ block: 'center' }); true`)
    await sleep(300)
    await shot('07-settings-voice-language')
    await press('[aria-labelledby=voice-language]', 'Hindi')
    await sleep(600)
    const stored = await db(`db.kv.get('settings').then((r) => r.value.voiceLanguage)`)
    check('picking Hindi stores hi-IN', stored === 'hi-IN', stored)
    await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`)
    await sleep(700)
    const r = await say([['पेट्रोल 500', 0.95]])
    check('the recognizer was asked for hi-IN', r.lang === 'hi-IN', r.lang)
    check('what hi-IN writes, "पेट्रोल 500", saves as ₹500 Transport', r.txn?.amountMinor === 50000 && r.txn?.categoryId === 'transport', r.txn && { amt: r.txn.amountMinor, cat: r.txn.categoryId })
    await settings({ voiceLanguage: 'en-GB' })
    await sleep(500)
    const r2 = await say([['coffee 150', 0.95]])
    check('and English (UK) reaches it as en-GB', r2.lang === 'en-GB', r2.lang)
    await settings({ voiceLanguage: 'en-IN' })
    await sleep(400)
  }

  console.log('--- inside a trip')
  const trip = await ev(`import('/src/db/trips.ts').then((t) => t.startTrip({ name: 'Goa trip', myName: 'Jatin', others: ['Aarav', 'Rahul', 'Meera', 'Karan'], budgetMinor: null }))`)
  await sleep(800)
  const meera = trip.people.find((p) => p.name === 'Meera').id
  {
    // "Mira" for Meera, with alternatives that disagree on the amount without one ending in the other
    const r = await speak([['Mira paid 1500 for dinner', 0.86], ['Meera paid 1500 for dinner', 0], ['Mira paid 15 for dinner', 0]], '08-trip-check-light')
    check('voice preview showed Meera paying, split 5', r.live.includes('Meera paid · split 5'), r.live)
    check('on a trip, readings that disagree: the check state, with the split chip', r.state === 'check' && r.card.includes('Meera paid · split 5') && (await added(r.before)).count === 0, r.card)
    await press('.voice-actions', 'Save')
    await b.waitFor(`!!document.querySelector('.voice-status.saved')`, 6000).catch(() => {})
    await sleep(300)
    const got = await added(r.before)
    check('Save puts it in the trip: ₹1,500 Food paid by Meera, split between all 5', got.entry?.amountMinor === 150000 && got.entry?.paidBy === meera && got.entry?.among?.length === 5 && got.entry?.categoryId === 'food', got.entry && { amt: got.entry.amountMinor, paidBy: got.entry.paidBy === meera ? 'meera' : got.entry.paidBy, among: got.entry.among.length, cat: got.entry.categoryId })
    check('your share (₹300) is what reached your expenses', got.txn?.amountMinor === 30000 && got.txn?.tripEntryId === got.entry?.id, got.txn && { amt: got.txn.amountMinor })
    check('the saved card says Meera paid', (await panelText()).includes('Meera paid'), await panelText())
    await settle()
  }
  {
    const r = await say([['Rahul ne cab ka 800 pay kiya', 0.95]])
    const rahul = trip.people.find((p) => p.name === 'Rahul').id
    check('sure on a trip, "Rahul ne cab ka 800 pay kiya": saved at once, ₹800 Transport paid by Rahul', r.state === 'saved' && r.entry?.amountMinor === 80000 && r.entry?.paidBy === rahul && r.entry?.categoryId === 'transport', r.entry && { state: r.state, amt: r.entry.amountMinor, cat: r.entry.categoryId })
  }

  console.log('--- dark')
  {
    await settings({ theme: 'dark' })
    await sleep(600)
    const r = await speak([['jio recharge 399', 0.95], ['jio recharge 299', 0]], '09-check-dark')
    const dark = await ev(`document.documentElement.dataset.theme`)
    check('the check state in dark', r.state === 'check' && dark === 'dark', { state: r.state, dark })
    await press('.voice-alts', '₹299')
    await sleep(300)
    await shot('10-check-swapped-dark')
    await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`)
    await settle()
    const r2 = await speak([['450 tea', 0.6]], '11-check-low-dark')
    check('the low-score check state in dark', r2.state === 'check')
    await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`)
    await settle()
    await settings({ theme: 'light' })
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
