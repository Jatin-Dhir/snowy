import { db, type Goal } from './db'

function newId(): string {
  return crypto.randomUUID?.() ?? `g${Date.now()}${Math.floor(Math.random() * 1e6)}`
}

export async function addGoal(name: string, targetMinor: number): Promise<Goal> {
  const now = Date.now()
  const goal: Goal = { id: newId(), name: name.trim(), targetMinor, savedMinor: 0, createdAt: now, updatedAt: now }
  await db.goals.put(goal)
  return goal
}

export async function updateGoal(id: string, patch: Partial<Pick<Goal, 'name' | 'targetMinor'>>): Promise<void> {
  // the goal sheet sends the target back with a rename too: only a different one is a new fact
  const was = await db.goals.get(id)
  const changed = patch.targetMinor !== undefined && patch.targetMinor !== was?.targetMinor
  const clearBase = changed ? { baseTargetMinor: null, baseCurrency: null } : {}
  await db.goals.update(id, { ...patch, ...clearBase, updatedAt: Date.now() })
}

/**
 * What a goal holds, as it's shown and used: its running total, never below nothing. The total itself (savedMinor)
 * may dip below zero, when an entry's edit takes back more than is left in it, so the edit back puts it where it was.
 * Floored at every move instead, ₹1,000 in, ₹800 out, and the ₹1,000 made ₹100 and back again came to ₹900, not ₹200.
 */
export function goalSaved(g: Pick<Goal, 'savedMinor'>): number {
  return Math.max(0, g.savedMinor)
}

/**
 * The goal's own Add and Take out, and Home's tuck-away: delta may be negative (taking money back out). The running
 * total isn't floored here, goalSaved floors it; but money put into a goal that's below nothing starts it again from
 * nothing. A deposit deleted after a take-out leaves a gap no one can see, and the ₹500 just put in has to show as
 * ₹500, not fill that gap and leave the goal at ₹0
 */
export async function addToGoal(id: string, deltaMinor: number): Promise<void> {
  const g = await db.goals.get(id)
  if (!g) return
  const from = deltaMinor > 0 ? goalSaved(g) : g.savedMinor
  await db.goals.update(id, {
    savedMinor: from + deltaMinor,
    baseSavedMinor: null,
    updatedAt: Date.now()
  })
}

/** Returns the goal as it was, so the toast's Undo can put it back with restoreGoal. */
export async function deleteGoal(id: string): Promise<Goal | undefined> {
  const goal = await db.goals.get(id)
  await db.goals.delete(id)
  return goal
}

export async function restoreGoal(goal: Goal): Promise<void> {
  await db.goals.put(goal)
}
