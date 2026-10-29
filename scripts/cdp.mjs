// Minimal Chrome DevTools Protocol driver, no dependencies: launches a throwaway
// headless Edge/Chrome with its own profile, opens one tab and exposes
// send / evaluate / waitFor. Used by the store-asset scripts. Needs Node 22+ (global WebSocket).
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CANDIDATES = [
  process.env.BROWSER,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].filter(Boolean)

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const answers = async (port) => {
  try {
    return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok
  } catch {
    return false
  }
}

/**
 * `args`: extra browser flags, after the defaults. `port` 0 (the default) lets the browser pick a free one,
 * so two scripts running at once (a film render and the store graphics, say) never attach to each other's
 * browser; a fixed port must be free, or this throws rather than driving whatever already answers there.
 */
export async function launch({ port = 0, args = [] } = {}) {
  const exe = CANDIDATES.find((p) => existsSync(p))
  if (!exe) throw new Error('No Edge or Chrome found. Set BROWSER to its full path.')
  if (port && (await answers(port))) throw new Error(`Port ${port} already has a browser on it; pick another or leave it to 0.`)
  const profile = mkdtempSync(join(tmpdir(), 'taily-cdp-'))
  const proc = spawn(
    exe,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      '--mute-audio',
      ...args,
      'about:blank'
    ],
    { stdio: 'ignore' }
  )

  // a busy machine can take a while to bring the browser up; with port 0 it writes the port it chose
  // into DevToolsActivePort in its profile
  let up = false
  for (let i = 0; i < 240 && !up; i++) {
    if (!port) {
      try {
        port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]) || 0
      } catch {
        /* not written yet */
      }
    }
    up = !!port && (await answers(port))
    if (!up) await sleep(150)
  }
  if (!up) throw new Error('The browser did not expose its DevTools endpoint.')

  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = () => reject(new Error('Could not open the DevTools socket.'))
  })

  let nextId = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    const p = m.id && pending.get(m.id)
    if (!p) return
    pending.delete(m.id)
    if (m.error) p.reject(new Error(m.error.message))
    else p.resolve(m.result)
  }

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
    return r.result.value
  }

  const waitFor = async (expression, ms = 15000) => {
    const t = Date.now()
    while (Date.now() - t < ms) {
      try {
        if (await evaluate(expression)) return
      } catch {
        /* page still loading */
      }
      await sleep(200)
    }
    throw new Error(`Timed out waiting for: ${expression}`)
  }

  const close = () => {
    try {
      ws.close()
    } catch {
      /* already closed */
    }
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' })
    else proc.kill()
    // Edge lets go of its profile a moment after it is killed: keep trying for a few seconds, or every run
    // leaves its profile and disk cache behind in the temp folder
    for (let i = 0; i < 24 && existsSync(profile); i++) {
      try {
        rmSync(profile, { recursive: true, force: true })
      } catch {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250)
      }
    }
  }

  return { send, evaluate, waitFor, close }
}
