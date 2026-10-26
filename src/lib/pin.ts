// The app-lock PIN is never stored, only a salted PBKDF2-SHA256 hash of it.
// Hashing can't make a 4-digit PIN uncrackable on its own (there are only
// 10,000 of them), so the real guards are Android's storage encryption and
// the wrong-guess cooldown below. The salt and the slow hash keep the PIN from
// being read straight back out of the data, which matters because people
// reuse PINs.

const ITERATIONS = 150_000
const PREFIX = 'pbkdf2'

function toB64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

function fromB64(b64: string) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

async function derive(pin: string, salt: BufferSource, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256)
  return new Uint8Array(bits)
}

/** A fresh hash for a new PIN: `pbkdf2$<iterations>$<salt>$<hash>`. */
export async function hashPin(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return `${PREFIX}$${ITERATIONS}$${toB64(salt)}$${toB64(await derive(pin, salt, ITERATIONS))}`
}

/** Builds before 2.10 stored an unsalted SHA-256. It still unlocks, and gets replaced after the next correct entry. */
export function isLegacyHash(stored: string): boolean {
  return !stored.startsWith(`${PREFIX}$`)
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  if (isLegacyHash(stored)) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('snowy:' + pin))
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('') === stored
  }
  const [, iterations, salt, hash] = stored.split('$')
  return toB64(await derive(pin, fromB64(salt), Number(iterations))) === hash
}

// Wrong guesses are counted across restarts. Every 5th miss in a row starts a
// cooldown that doubles each time (30 s, 1 min, 2 min … up to 15 min), which
// turns trying all 10,000 PINs by hand into weeks.
const GUARD_KEY = 'taily.pin.guard'

function readGuard(): { fails: number; until: number } {
  try {
    const g = JSON.parse(localStorage.getItem(GUARD_KEY) ?? 'null')
    if (typeof g?.fails === 'number' && typeof g?.until === 'number') return g
  } catch {
    /* unreadable: start clean */
  }
  return { fails: 0, until: 0 }
}

/** How long before another guess is allowed, in ms (0 = now). */
export function pinCooldownMs(): number {
  return Math.max(0, readGuard().until - Date.now())
}

/** Counts a wrong PIN and returns the cooldown it started, if any. */
export function recordPinFailure(): number {
  const g = readGuard()
  const fails = g.fails + 1
  const until = fails % 5 === 0 ? Date.now() + Math.min(15 * 60_000, 30_000 * 2 ** (fails / 5 - 1)) : g.until
  try {
    localStorage.setItem(GUARD_KEY, JSON.stringify({ fails, until }))
  } catch {
    /* storage full or blocked: the cooldown just won't survive a restart */
  }
  return Math.max(0, until - Date.now())
}

export function clearPinFailures(): void {
  try {
    localStorage.removeItem(GUARD_KEY)
  } catch {
    /* nothing to clear */
  }
}

/** 95000 → "1:35" */
export function formatWait(ms: number): string {
  const s = Math.ceil(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
