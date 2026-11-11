// What Taily does with each utterance the recognizer heard in the hearing check: saves it without asking
// (pickAlternative's `sure`), shows the check state, or finds no amount; and whether the amount saved or shown big
// is the one the phrase meant. Runs the tree's parser in Node through Vite, no browser.
//
//   node scripts/voice-phrases/hearing/judge.mjs [heard.json] [--root <tree>]
//
// heard.json is this folder's record (sets en_IN, en_IN_other_voice, hi_IN) or one listen.mjs output. A tree
// from before 2.13.2 has no `sure`: it saved whatever it picked, which is how that's scored.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { PHRASES } from './phrases.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const rootAt = args.indexOf('--root')
const ROOT = resolve(rootAt >= 0 ? args[rootAt + 1] : join(HERE, '..', '..', '..'))
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--root') ?? join(HERE, 'heard.json')
const raw = JSON.parse(readFileSync(file, 'utf8'))
const sets = raw.en_IN ? Object.entries(raw).filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v)) : [[file, raw]]

const cacheDir = mkdtempSync(join(tmpdir(), 'taily-judge-vite-'))
const server = await createServer({
  configFile: false,
  root: ROOT,
  cacheDir,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] }
})
try {
  const P = await server.ssrLoadModule('/src/lib/parseSpeech.ts')
  const seed = await server.ssrLoadModule('/src/db/seed.ts')
  const cats = seed.DEFAULT_CATEGORIES
  const accs = seed.DEFAULT_ACCOUNTS
  const trip = {
    id: 't', name: 'Goa', budgetMinor: null, startISO: '2026-01-01', endedISO: null, createdAt: 0, updatedAt: 0,
    people: [{ id: 'me', name: 'You' }, { id: 'aarav', name: 'Aarav' }, { id: 'rahul', name: 'Rahul' }, { id: 'meera', name: 'Meera' }, { id: 'karan', name: 'Karan' }]
  }
  const t = { heard: 0, saved: 0, savedWrong: 0, checked: 0, checkedRightBig: 0, checkedRightChip: 0, checkedNotHeard: 0, noAmount: 0 }
  const rupees = (m) => (m == null ? '-' : `₹${m / 100}`)
  for (const [name, set] of sets) {
    console.log(`--- ${name}`)
    PHRASES.forEach(([g, spoken, want, , , x = {}], i) => {
      const id = 'p' + String(i + 1).padStart(2, '0')
      const results = set[id]?.alternatives ?? set[id]?.results ?? []
      if (!results.length || !results[0].length) return
      // one final result per phrase; if one came in pieces, its pieces' top readings in a row
      const alts = (results.length === 1 ? results[0] : [[results.map((r) => r[0][0]).join(' '), 0]]).map(([text, confidence]) => ({ text, confidence }))
      const r = P.pickAlternative(alts, (text) => P.readSpeech(text, g === 'trip' ? trip : null, cats, [], accs))
      const meant = Math.round(want * 100)
      const got = r.best.parsed.amountMinor
      const others = (r.others ?? []).map((o) => o.parsed.amountMinor)
      t.heard++
      let verdict
      if (!got) {
        t.noAmount++
        verdict = 'no amount'
      } else if (r.sure ?? true) {
        t.saved++
        if (got !== meant) t.savedWrong++
        verdict = got === meant ? 'saved' : 'SAVED WRONG'
      } else {
        t.checked++
        if (got === meant) t.checkedRightBig++
        else if (others.includes(meant)) t.checkedRightChip++
        else t.checkedNotHeard++
        verdict = got === meant ? 'check, right big' : others.includes(meant) ? 'check, right in a chip' : 'check, not heard'
      }
      void x
      console.log(`${id} ${verdict.padEnd(22)} "${spoken}" -> ${rupees(got)}${others.length ? ' | chips ' + others.map(rupees).join(' ') : ''}  [${alts.map((a) => a.text).join(' / ')}]`)
    })
  }
  console.log(`\n${t.heard} heard: ${t.saved} saved without asking (${t.savedWrong} with the wrong amount), ${t.checked} checked (${t.checkedRightBig} right amount big, ${t.checkedRightChip} in a chip, ${t.checkedNotHeard} not heard at all), ${t.noAmount} with no amount`)
} finally {
  await server.close()
  rmSync(cacheDir, { recursive: true, force: true })
}
