// Profiles: fully separate data spaces (two people, or work/personal records).
// Each profile is its own Dexie database — transactions, budgets, goals, loans,
// settings and PIN all live inside it. The registry of profiles is the only
// thing shared, kept in localStorage. Switching swaps the database and reloads.

export interface Profile {
  id: string
  name: string
  createdAt: number
}

interface ProfilesState {
  current: string
  list: Profile[]
}

const KEY = 'taily.profiles'

/** The original database predates profiles — profile 'main' keeps pointing at it. */
export function dbNameFor(profileId: string): string {
  return profileId === 'main' ? 'tally' : `tally-p-${profileId}`
}

export function loadProfiles(): ProfilesState {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const s = JSON.parse(raw) as ProfilesState
      if (Array.isArray(s.list) && s.list.length > 0 && s.list.some((p) => p.id === s.current)) return s
    }
  } catch {
    /* corrupt registry — fall through to the default */
  }
  return { current: 'main', list: [{ id: 'main', name: 'Personal', createdAt: 0 }] }
}

function save(state: ProfilesState): void {
  localStorage.setItem(KEY, JSON.stringify(state))
}

export function currentProfile(): Profile {
  const s = loadProfiles()
  return s.list.find((p) => p.id === s.current) ?? s.list[0]
}

export function currentDbName(): string {
  return dbNameFor(loadProfiles().current)
}

/** The current profile's name as a filename piece: "Mom's Shop" → "mom-s-shop". */
export function profileSlug(): string {
  return currentProfile().name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'main'
}

export function addProfile(name: string): Profile | null {
  const clean = name.trim()
  if (!clean) return null
  const s = loadProfiles()
  if (s.list.some((p) => p.name.toLowerCase() === clean.toLowerCase())) return null
  const p: Profile = {
    id: crypto.randomUUID?.() ?? `p${Date.now()}${Math.floor(Math.random() * 1e6)}`,
    name: clean,
    createdAt: Date.now()
  }
  save({ ...s, list: [...s.list, p] })
  return p
}

export function renameProfile(id: string, name: string): void {
  const clean = name.trim()
  if (!clean) return
  const s = loadProfiles()
  save({ ...s, list: s.list.map((p) => (p.id === id ? { ...p, name: clean } : p)) })
}

/** Switch and reload — the whole app re-boots against the other database. */
export function switchProfile(id: string): void {
  const s = loadProfiles()
  if (!s.list.some((p) => p.id === id) || s.current === id) return
  save({ ...s, current: id })
  window.location.reload()
}

/**
 * Remove a profile AND permanently delete its database.
 * The last remaining profile can't be deleted; deleting the current one
 * switches to the first other profile.
 */
export async function deleteProfile(id: string): Promise<void> {
  const s = loadProfiles()
  if (s.list.length <= 1 || !s.list.some((p) => p.id === id)) return
  const { default: Dexie } = await import('dexie')
  if (s.current === id) {
    // deleting the database this session has open — IndexedDB blocks the
    // delete until every connection to it closes, and ours is still live
    const { db } = await import('../db/db')
    db.close()
  }
  await Dexie.delete(dbNameFor(id))
  const list = s.list.filter((p) => p.id !== id)
  const current = s.current === id ? list[0].id : s.current
  save({ current, list })
  if (s.current === id) window.location.reload()
}
