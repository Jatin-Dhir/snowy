// The hearing check: plays WAV files (tts.ps1) to Google's recognizer through Chrome's Web Speech API and writes
// down every alternative it gives, with its confidence.
//
//   node scripts/voice-phrases/hearing/listen.mjs <lang> <out.json> <file.wav> [more.wav ...]
//   CHROME=<chrome.exe>   Google Chrome or Chrome for Testing; default: the newest one in puppeteer's cache.
//                         Not Edge: its speech recognition is Microsoft's service, not Google's.
//   PARALLEL=3            browsers at once
//
// How the audio gets in: Chrome's own capture for SpeechRecognition.start() hears the fake device's beep, not
// the --use-file-for-fake-audio-capture file (it heard "Radha Radha" for every phrase). getUserMedia does get
// the file, and start(track) takes its track, so the recognizer hears the WAV. Each WAV needs its own browser.
// Every browser gets a fresh --user-data-dir in the temp folder and is stopped by that path at the end.
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

const [lang, outFile, ...wavs] = process.argv.slice(2)
if (!lang || !outFile || !wavs.length) {
  console.error('usage: node listen.mjs <lang> <out.json> <file.wav> [more.wav ...]')
  process.exit(2)
}
const PARALLEL = Number(process.env.PARALLEL ?? 3)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME
  const cache = join(homedir(), '.cache', 'puppeteer', 'chrome')
  const builds = existsSync(cache) ? readdirSync(cache).sort().reverse() : []
  for (const b of builds) {
    for (const exe of [join(cache, b, 'chrome-win64', 'chrome.exe'), join(cache, b, 'chrome-linux64', 'chrome')]) if (existsSync(exe)) return exe
  }
  for (const exe of ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome']) if (existsSync(exe)) return exe
  throw new Error('No Google Chrome or Chrome for Testing found: set CHROME. (Edge would hear with Microsoft\'s service, not Google\'s.)')
}
const CHROME = findChrome()

const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end('<!doctype html><meta charset="utf-8"><title>listen</title><body>listen</body>')
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const PAGE = `http://127.0.0.1:${server.address().port}/`

const profiles = []
/** Stops every chrome.exe whose command line holds one of this run's profile paths. */
function sweep() {
  if (process.platform !== 'win32' || !profiles.length) return 0
  const ps = `$dirs = $env:HEAR_DIRS -split ';'; $n = 0; Get-CimInstance Win32_Process -Filter "name='chrome.exe'" | ForEach-Object { $cl = $_.CommandLine; foreach ($d in $dirs) { if ($d -and $cl -and $cl.Contains($d)) { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $n++; break } } }; $n`
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], {
    encoding: 'utf8',
    env: { ...process.env, HEAR_DIRS: profiles.join(';') }
  })
  return Number((r.stdout ?? '0').trim()) || 0
}

const LISTEN = (lang) => `new Promise((done) => {
  const R = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!R) return done({ error: 'no SpeechRecognition' })
  const rec = new R()
  rec.lang = ${JSON.stringify(lang)}
  rec.interimResults = false
  rec.continuous = false
  rec.maxAlternatives = 5
  const out = { results: [], error: null }
  rec.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i]
      if (res.isFinal) out.results.push(Array.from({ length: res.length }, (_, j) => [res[j].transcript, res[j].confidence]))
    }
  }
  rec.onerror = (e) => { out.error = e.error }
  rec.onend = () => done(out)
  setTimeout(() => { try { rec.stop() } catch {} }, 15000)
  setTimeout(() => done({ ...out, error: (out.error ?? '') + ' (gave up)' }), 22000)
  navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }).then(
    (s) => { try { rec.start(s.getAudioTracks()[0]) } catch (e) { done({ ...out, error: 'start(track): ' + e.message }) } },
    (e) => done({ ...out, error: 'getUserMedia: ' + e.message })
  )
})`

async function hear(wav) {
  const profile = mkdtempSync(join(tmpdir(), 'taily-hear-'))
  profiles.push(profile)
  const proc = spawn(
    CHROME,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${wav}%noloop`,
      'about:blank'
    ],
    { stdio: 'ignore' }
  )
  try {
    let port = 0
    for (let i = 0; i < 200 && !port; i++) {
      try {
        port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]) || 0
      } catch {
        await sleep(100)
      }
    }
    if (!port) throw new Error('no DevTools port')
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((ok, no) => {
      ws.onopen = ok
      ws.onerror = () => no(new Error('socket'))
    })
    let id = 0
    const pending = new Map()
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data)
      const p = m.id && pending.get(m.id)
      if (!p) return
      pending.delete(m.id)
      m.error ? p.no(new Error(m.error.message)) : p.ok(m.result)
    }
    const send = (method, params = {}) =>
      new Promise((ok, no) => {
        const i = ++id
        pending.set(i, { ok, no })
        ws.send(JSON.stringify({ id: i, method, params }))
      })
    await send('Page.enable')
    await send('Page.navigate', { url: PAGE })
    await sleep(700)
    const r = await send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: LISTEN(lang) })
    ws.close()
    return r.result.value
  } finally {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' })
    else proc.kill()
  }
}

const results = {}
try {
  const queue = [...wavs]
  await Promise.all(
    Array.from({ length: Math.min(PARALLEL, queue.length) }, async () => {
      while (queue.length) {
        const wav = queue.shift()
        const name = basename(wav, '.wav')
        try {
          results[name] = await hear(resolve(wav))
        } catch (e) {
          results[name] = { results: [], error: 'driver: ' + e.message }
        }
        const r = results[name]
        console.log(`${name}: ${r.error ? 'ERROR ' + r.error + ' ' : ''}${JSON.stringify(r.results)}`)
      }
    })
  )
} finally {
  server.close()
  const stopped = sweep()
  await sleep(500)
  for (const p of profiles) {
    for (let i = 0; i < 20 && existsSync(p); i++) {
      try {
        rmSync(p, { recursive: true, force: true })
      } catch {
        await sleep(250)
      }
    }
  }
  console.log(`cleanup: ${stopped} leftover chrome processes stopped; ${profiles.filter((p) => existsSync(p)).length} profiles left`)
  writeFileSync(outFile, JSON.stringify(results, null, 1))
}
