// Runs the voice phrase battery (cases.mjs) through Taily's real parser and alternatives ranking, in headless
// Edge through Vite, and scores what each phrase became against what the speaker meant.
//
//   node scripts/voice-phrases/run.mjs                    measure this checkout
//   node scripts/voice-phrases/run.mjs --root <dir>       measure another tree: a `git archive` export is enough,
//                                                          since the parser imports plain TS and nothing from npm
//   --out <dir>          where results.json and summary.txt go (default: a temp folder, printed at the end)
//   --compare <file>     an earlier results.json or baseline: every phrase that passed there and fails now is
//                        listed (default: baseline-2.13.0.json beside this file)
//   --save-baseline <f>  also write this run as a compact baseline file
//
// Groups 1-12 make the headline pass rate (171 phrases in 2.13.0); 13 are probes, right transcripts phrased the
// way people talk. `fresh` phrases were written for 2.13.1 before its fixes and are scored apart, by cause.
// The 18 phrases of the trip end-to-end test are checked the way that test checks them.
// Trees from before 2.13.1 have no readSpeech/pickAlternative in src/lib/parseSpeech.ts: for those, both are
// lifted verbatim out of src/components/VoiceOverlay.tsx, as the first measurement did.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer, transformWithEsbuild } from 'vite'
import { launch } from '../cdp.mjs'
import { cases, GROUPS, TRIP_E2E, TRIP_E2E_PEOPLE } from './cases.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const arg = (name) => {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : undefined
}
const ROOT = resolve(arg('--root') ?? join(HERE, '..', '..'))
const OUT = resolve(arg('--out') ?? mkdtempSync(join(tmpdir(), 'taily-voice-phrases-')))
const COMPARE = arg('--compare') ?? join(HERE, 'baseline-2.13.0.json')
const SAVE_BASELINE = arg('--save-baseline')
mkdirSync(OUT, { recursive: true })

// ---- 1. what the page needs from the tree: the default tags and accounts, and (old trees) the ranking
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
const seed = read('src/db/seed.ts')
const literal = (name) => {
  const m = seed.match(new RegExp(`^export const ${name}[^=]*=\\s*(\\[[\\s\\S]*?\\n\\])`, 'm'))
  if (!m) throw new Error(`Could not find ${name} in src/db/seed.ts`)
  return Function(`return ${m[1]}`)()
}
const CATS = literal('DEFAULT_CATEGORIES')
const ACCS = literal('DEFAULT_ACCOUNTS')
const vo = read('src/components/VoiceOverlay.tsx')
const readSpeechSrc = vo.match(/^function readSpeech\([\s\S]*?\n}\n/m)?.[0]
const rankingSrc = vo.match(/^[ \t]*const ranked = [^\n]*\n[ \t]*const score = [^\n]*\n[ \t]*const best = [^\n]*\n/m)?.[0]
const LEGACY =
  readSpeechSrc && rankingSrc
    ? `// verbatim excerpts of src/components/VoiceOverlay.tsx
import { parseScore, parseSpeech, tripPayer } from '/src/lib/parseSpeech.ts'
${readSpeechSrc}
export { readSpeech }
export function rank(alternatives, on, cats, past, accs) {
${rankingSrc}  return { best: { text: best.a.text, p: best.p }, all: ranked.map((r) => ({ text: r.a.text, confidence: r.a.confidence, score: Math.round(score(r) * 100) / 100, p: r.p })) }
}
`
    : `export function readSpeech() { throw new Error('no readSpeech in this tree') }\nexport const rank = readSpeech\n`

// ---- 2. Vite serves the tree's own src; the page and the legacy module are served from memory, so nothing is
// written into the tree being measured
const PAGE = '/__voice-phrases.html'
const LEGACY_ID = '/__voice-phrases/legacy.ts'
const cacheDir = mkdtempSync(join(tmpdir(), 'taily-voice-phrases-vite-'))
const server = await createServer({
  configFile: false,
  root: ROOT,
  mode: 'play',
  logLevel: 'warn',
  cacheDir,
  appType: 'custom',
  server: { host: '127.0.0.1', port: 0, hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [
    {
      name: 'voice-phrases',
      configureServer(s) {
        s.middlewares.use((req, res, next) => {
          if (req.url?.split('?')[0] !== PAGE) return next()
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          res.end('<!doctype html><meta charset="utf-8"><title>voice phrases</title><body>voice phrases</body>')
        })
      },
      resolveId: (id) => (id === LEGACY_ID ? '\0voice-phrases-legacy' : null),
      async load(id) {
        if (id !== '\0voice-phrases-legacy') return null
        return (await transformWithEsbuild(LEGACY, 'legacy.ts', { loader: 'ts' })).code
      }
    }
  ]
})
await server.listen()
const PORT = server.httpServer.address().port

// Edge relaunches itself on Windows (--edge-skip-compat-layer-relaunch), so cdp.mjs's taskkill can hit a launcher
// that has already exited while the real browser lives on: a marker flag lets this script find and stop its own.
const MARKER = `--taily-voice-phrases=${process.pid}-${Date.now()}`
function killMarked() {
  if (process.platform !== 'win32') return []
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
  return dirs
}

const TRIP_PEOPLE = [{ id: 'me', name: 'You' }, { id: 'aarav', name: 'Aarav' }, { id: 'rahul', name: 'Rahul' }, { id: 'meera', name: 'Meera' }, { id: 'karan', name: 'Karan' }]
let browser
let page
try {
  browser = await launch({ args: ['--disable-extensions', '--disable-sync', '--disable-features=msImplicitSignin', MARKER] })
  await browser.send('Page.enable')
  await browser.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${PAGE}` })
  await browser.waitFor(`location.pathname === ${JSON.stringify(PAGE)} && document.readyState === 'complete'`)
  page = await browser.evaluate(`(async () => {
    const P = await import('/src/lib/parseSpeech.ts')
    const dates = await import('/src/lib/dates.ts')
    const cats = ${JSON.stringify(CATS)}
    const accs = ${JSON.stringify(ACCS)}
    const today = dates.todayISO()
    const trip = { id: 'trip1', name: 'Goa', budgetMinor: null, startISO: today, endedISO: null, createdAt: Date.now(), updatedAt: Date.now(), people: ${JSON.stringify(TRIP_PEOPLE)} }
    let readSpeech
    let rank
    let api
    if (P.readSpeech && P.pickAlternative) {
      api = 'parseSpeech.ts'
      readSpeech = P.readSpeech
      rank = (alts, on) => {
        const r = P.pickAlternative(alts, (text) => P.readSpeech(text, on, cats, [], accs))
        return { best: { text: r.best.text, p: r.best.parsed }, all: r.all.map((x) => ({ text: x.text, confidence: x.confidence, p: x.parsed })) }
      }
    } else {
      api = 'VoiceOverlay.tsx excerpts'
      const L = await import(${JSON.stringify(LEGACY_ID)})
      readSpeech = L.readSpeech
      rank = (alts, on) => L.rank(alts, on, cats, [], accs)
    }
    const res = ${JSON.stringify(cases)}.map((c) => {
      const on = c.g === 11 ? trip : null
      if (c.alts) {
        const r = rank(c.alts.map(([text, confidence]) => ({ text, confidence })), on)
        return { got: r.best.p, picked: r.best.text, all: r.all.map((x) => ({ text: x.text, score: x.score, amt: x.p.amountMinor, tag: x.p.categoryId })) }
      }
      return { got: readSpeech(c.t, on, cats, [], accs) }
    })
    const trips = ${JSON.stringify(TRIP_E2E)}.map(([text, payer, amount, cat, kind]) => {
      const t = P.tripPayer(text, ${JSON.stringify(TRIP_E2E_PEOPLE)})
      const p = P.parseSpeech(t.text, cats, [], accs)
      const ok = t.paidBy === payer && p.amountMinor === amount && p.categoryId === cat && p.kind === kind
      return { text, ok, got: { paidBy: t.paidBy, rest: t.text, amount: p.amountMinor, cat: p.categoryId, kind: p.kind, note: p.note } }
    })
    return { today, api, ua: navigator.userAgent, res, trips }
  })()`)
} finally {
  browser?.close()
  const stopped = killMarked()
  console.log(`edge cleanup: ${stopped.length ? `stopped the relaunched browser, removed ${stopped.join(', ')}` : 'nothing left running'}`)
  await server.close()
  rmSync(cacheDir, { recursive: true, force: true })
}

// ---- 3. score
const ymd = (iso) => iso.split('-').map(Number)
const addDays = (iso, n) => {
  const [y, m, d] = ymd(iso)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}
const weekday = (iso) => {
  const [y, m, d] = ymd(iso)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}
function expectedDates(spec, today) {
  if (spec === undefined) return [undefined]
  if (typeof spec === 'number') return [spec === 0 ? undefined : addDays(today, spec)]
  if ('wd' in spec) {
    let back = (weekday(today) - spec.wd + 7) % 7
    if (back === 0 && spec.last) back = 7
    const near = back === 0 ? undefined : addDays(today, -back)
    // "last Monday" can mean this week's or the one before
    return spec.last ? [near, addDays(today, -back - 7)] : [near]
  }
  const [y, m, d] = ymd(today)
  if ('dom' in spec) {
    const iso = d >= spec.dom ? `${y}-${String(m).padStart(2, '0')}-${String(spec.dom).padStart(2, '0')}` : new Date(Date.UTC(y, m - 2, spec.dom)).toISOString().slice(0, 10)
    return [iso === today ? undefined : iso]
  }
  if ('md' in spec) {
    let iso = `${y}-${String(spec.md[0]).padStart(2, '0')}-${String(spec.md[1]).padStart(2, '0')}`
    if (iso > today) iso = `${y - 1}${iso.slice(4)}`
    return [iso === today ? undefined : iso]
  }
  throw new Error('bad date spec')
}

const rupees = (minor) => (minor == null ? 'none' : `₹${minor / 100}`)
const tagStr = (t) => (Array.isArray(t) ? t.map((x) => x ?? 'none').join('|') : t ?? 'none')
const keyOf = (c) => `${c.g}:${c.alts ? c.alts.map(([t]) => t).join(' | ') : c.t}`
const results = cases.map((c, i) => {
  const { got, picked, all } = page.res[i]
  const exp = {
    amount: c.rupees == null ? null : Math.round(c.rupees * 100),
    kind: c.kind,
    tags: Array.isArray(c.tag) ? c.tag : [c.tag],
    dates: expectedDates(c.date, page.today),
    acc: c.acc,
    payer: c.payer
  }
  const diffs = []
  if ((got.amountMinor ?? null) !== exp.amount) diffs.push(['amount', rupees(got.amountMinor), rupees(exp.amount)])
  if (got.kind !== exp.kind) diffs.push(['kind', got.kind, exp.kind])
  if (!exp.tags.includes(got.categoryId ?? null)) diffs.push(['tag', got.categoryId ?? 'none', tagStr(c.tag)])
  if (!exp.dates.includes(got.dateISO)) diffs.push(['date', got.dateISO ?? 'today', exp.dates.map((x) => x ?? 'today').join('|')])
  if ((got.accountId ?? undefined) !== exp.acc) diffs.push(['account', got.accountId ?? 'none', exp.acc ?? 'none'])
  if ((got.paidBy ?? undefined) !== exp.payer) diffs.push(['payer', got.paidBy ?? 'you', exp.payer ?? 'you'])
  if (c.note !== undefined && got.note !== c.note) diffs.push(['note', JSON.stringify(got.note), JSON.stringify(c.note)])
  return { key: keyOf(c), ...c, got, picked, all, diffs, pass: diffs.length === 0 }
})
const trips = page.trips

let before = null
if (existsSync(COMPARE)) {
  const b = JSON.parse(readFileSync(COMPARE, 'utf8'))
  before = new Map((b.results ?? []).map((r) => [r.key ?? keyOf(r), r]))
  for (const t of b.trips ?? []) before.set(`trip-e2e:${t.text}`, t)
}

const lines = []
const pct = (p, n) => (n ? `${Math.round((100 * p) / n)}%` : '-')
const cell = (p, n) => `${String(p).padStart(3)}/${String(n).padEnd(3)} ${pct(p, n).padStart(4)}`
const was = (rs) => (before ? rs.filter((r) => before.get(r.key)?.pass).length : null)
lines.push(`tree=${ROOT}  ranking from ${page.api}  today=${page.today}`)
lines.push(`tags=${CATS.map((c) => c.id).join(',')}  accounts=${ACCS.map((a) => a.id).join(',')}`)
lines.push(before ? `"before" = ${COMPARE}` : 'no earlier run to compare with')
lines.push('')
lines.push(`${'group'.padEnd(32)} ${before ? 'before          ' : ''}now`)
const scored = (rs) => rs.filter((r) => !r.amb)
let [pAll, nAll, bAll] = [0, 0, 0]
for (const g of Object.keys(GROUPS).map(Number)) {
  const rs = scored(results.filter((r) => r.g === g && !r.fresh))
  const p = rs.filter((r) => r.pass).length
  if (g !== 13) {
    pAll += p
    nAll += rs.length
    bAll += was(rs) ?? 0
  }
  lines.push(`G${String(g).padEnd(2)} ${GROUPS[g].padEnd(28)} ${before ? cell(was(rs), rs.length) + '    ' : ''}${cell(p, rs.length)}`)
}
lines.push(`${'Overall G1-12'.padEnd(32)} ${before ? cell(bAll, nAll) + '    ' : ''}${cell(pAll, nAll)}`)
lines.push('')
const CAUSES = {
  1: 'amounts said in pieces',
  2: 'spending or income',
  3: 'shop and tag words',
  4: 'Hindi numbers (Latin)',
  5: 'accounts',
  6: 'dates',
  7: 'numbers that aren\'t prices',
  8: 'tag names as plain words',
  9: 'alternatives ranking',
  10: 'trip payer',
  11: 'K and CR',
  12: 'Devanagari',
  13: 'leftover note fragments'
}
const fresh = results.filter((r) => r.fresh)
if (fresh.length) {
  lines.push(`fresh phrasings, by cause`)
  let [fp, fb] = [0, 0]
  for (const n of Object.keys(CAUSES).map(Number)) {
    const rs = scored(fresh.filter((r) => r.fresh === n))
    if (!rs.length) continue
    const p = rs.filter((r) => r.pass).length
    fp += p
    fb += was(rs) ?? 0
    lines.push(`F${String(n).padEnd(2)} ${CAUSES[n].padEnd(28)} ${before ? cell(was(rs), rs.length) + '    ' : ''}${cell(p, rs.length)}`)
  }
  lines.push(`${'Fresh overall'.padEnd(32)} ${before ? cell(fb, scored(fresh).length) + '    ' : ''}${cell(fp, scored(fresh).length)}`)
  lines.push('')
}
const tripsOk = trips.filter((t) => t.ok).length
const tripsBefore = before ? trips.filter((t) => before.get(`trip-e2e:${t.text}`)?.ok).length : null
lines.push(`${'trip-e2e.mjs parser phrases'.padEnd(32)} ${before ? cell(tripsBefore, trips.length) + '    ' : ''}${cell(tripsOk, trips.length)}`)
for (const t of trips.filter((t) => !t.ok)) lines.push(`FAIL  trip-e2e "${t.text}" :: ${JSON.stringify(t.got)}`)
lines.push('')

if (before) {
  const worse = results.filter((r) => !r.pass && before.get(r.key)?.pass)
  const tripWorse = trips.filter((t) => !t.ok && before.get(`trip-e2e:${t.text}`)?.ok)
  lines.push(`got worse: ${worse.length + tripWorse.length}`)
  for (const r of worse) lines.push(`WORSE G${r.g}${r.fresh ? ` F${r.fresh}` : ''} "${r.t}" :: ${r.diffs.map(([f, g, e]) => `${f} ${g} (want ${e})`).join('; ')}  | note="${r.got.note}"`)
  for (const t of tripWorse) lines.push(`WORSE trip-e2e "${t.text}" :: ${JSON.stringify(t.got)}`)
  lines.push('')
}

const label = (r) => (r.amb ? 'AMBIG' : r.held ? 'HELD ' : 'FAIL ')
for (const r of results.filter((r) => !r.pass || r.amb).sort((a, b) => Number(!!a.held) - Number(!!b.held))) {
  lines.push(`${label(r)} G${r.g}${r.fresh ? ` F${r.fresh}` : ''} "${r.t}"${r.picked ? ` [picked "${r.picked}"]` : ''} :: ${r.diffs.map(([f, g, e]) => `${f} ${g} (want ${e})`).join('; ') || 'ok'}  | note="${r.got.note}"${r.held ? `  (${r.held})` : ''}`)
  if (r.all) lines.push(`        alts: ${r.all.map((x) => `"${x.text}"=${x.score ?? rupees(x.amt)}${x.tag ? ' ' + x.tag : ''}`).join('  ')}`)
}
// a lone letter or a number with nothing it counts, left in a saved note, is a fragment of something misread
const fragments = results.filter((r) => r.got.amountMinor && /(^|\s)([A-Za-z]|\d+)$|(^|\s)[A-Za-z](\s|$)(?![A-Z]\b)/.test(r.got.note ?? ''))
if (fragments.length) {
  lines.push('')
  lines.push('notes that may hold a fragment:')
  for (const r of fragments) lines.push(`  "${r.t}" -> "${r.got.note}"`)
}

writeFileSync(join(OUT, 'results.json'), JSON.stringify({ tree: ROOT, api: page.api, today: page.today, ua: page.ua, results, trips }, null, 2))
writeFileSync(join(OUT, 'summary.txt'), lines.join('\n') + '\n')
if (SAVE_BASELINE) {
  const compact = {
    tree: ROOT,
    today: page.today,
    results: results.map((r) => ({ key: r.key, g: r.g, fresh: r.fresh, t: r.t, pass: r.pass, diffs: r.diffs, note: r.got.note })),
    trips: trips.map((t) => ({ text: t.text, ok: t.ok, got: t.got }))
  }
  writeFileSync(resolve(SAVE_BASELINE), JSON.stringify(compact, null, 1) + '\n')
}
console.log(lines.join('\n'))
console.log(`\nresults: ${join(OUT, 'results.json')}\nsummary: ${join(OUT, 'summary.txt')}`)
process.exit(0)
