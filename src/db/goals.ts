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
  const clearBase = patch.targetMinor !== undefined ? { baseTargetMinor: null, baseCurrency: null } : {}
  await db.goals.update(id, { ...patch, ...clearBase, updatedAt: Date.now() })
}

/** delta may be negative (taking money back out); saved never goes below 0. */
export async function addToGoal(id: string, deltaMinor: number): Promise<void> {
  const g = await db.goals.get(id)
  if (!g) return
  await db.goals.update(id, {
    savedMinor: Math.max(0, g.savedMinor + deltaMinor),
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
