// Minimal Chrome DevTools Protocol driver, no dependencies: launches a throwaway
// headless Edge/Chrome with its own profile, opens one tab and exposes
// send / evaluate / waitFor. Used by the store-asset scripts. Needs Node 22+ (global WebSocket).
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
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

export async function launch({ port = 9333 } = {}) {
  const exe = CANDIDATES.find((p) => existsSync(p))
  if (!exe) throw new Error('No Edge or Chrome found. Set BROWSER to its full path.')
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
      'about:blank'
    ],
    { stdio: 'ignore' }
  )

  let up = false
  for (let i = 0; i < 100 && !up; i++) {
    try {
      up = (await fetch(`http://127.0.0.1:${port}/json/version`)).ok
    } catch {
      await sleep(150)
    }
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
    try {
      rmSync(profile, { recursive: true, force: true })
    } catch {
      /* the OS may still hold a lock; it is a temp folder */
    }
  }

  return { send, evaluate, waitFor, close }
}
