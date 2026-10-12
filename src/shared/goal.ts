/**
 * Goal vocabulary shared by main, core and the renderer (v2.6.2, Topic 4).
 *
 * A Goal is the *stable* statement of what the user wants to end up with: a
 * title plus explicit success criteria that survive across chats and runs. It is
 * deliberately separate from a Plan (a proposed, short-lived route) and from a
 * Run (one attempt), so a project can accumulate history against one outcome
 * instead of losing it when a chat ends.
 *
 * Dependency-free (no `node:crypto`, no `node:fs`) so the renderer can import it;
 * id generation and persistence live in `@core/agent/goal-store`.
 */

export type GoalStatus = 'active' | 'achieved' | 'abandoned' | 'blocked'

export const GOAL_STATUSES: readonly GoalStatus[] = ['active', 'achieved', 'abandoned', 'blocked']

/** One observable success criterion for a goal. */
export interface GoalCriterion {
  id: string
  text: string
  met: boolean
  /** When the criterion was marked met (epoch ms). */
  metAt?: number
}

/** A reference from a goal to the work done against it. */
export interface GoalLink {
  /** The run that worked on the goal. */
  runId: string
  /** The plan that run followed, when Plan Mode was in play. */
  planId?: string
  /** The chat/session the run belonged to. */
  sessionId?: string
  createdAt: number
}

export interface Goal {
  id: string
  projectId: string
  title: string
  criteria: GoalCriterion[]
  status: GoalStatus
  createdAt: number
  updatedAt: number
  links: GoalLink[]
  /** Set when the goal reached a terminal status. */
  closedAt?: number
  /** Why the goal was abandoned/blocked, when the user supplied a reason. */
  note?: string
}

export interface GoalProgress {
  met: number
  total: number
}

export function isGoalStatus(value: unknown): value is GoalStatus {
  return typeof value === 'string' && (GOAL_STATUSES as readonly string[]).includes(value)
}

/** True for a status that no longer accepts new work. */
export function isGoalClosed(status: GoalStatus): boolean {
  return status !== 'active'
}

/** How many criteria are met, out of the total. */
export function goalProgress(goal: Pick<Goal, 'criteria'>): GoalProgress {
  const total = goal.criteria.length
  const met = goal.criteria.reduce((count, criterion) => count + (criterion.met ? 1 : 0), 0)
  return { met, total }
}

/**
 * A goal is complete when it has at least one criterion and all of them are met.
 * A goal with no criteria is never auto-complete — the user decides.
 */
export function isGoalComplete(goal: Pick<Goal, 'criteria'>): boolean {
  return goal.criteria.length > 0 && goal.criteria.every((criterion) => criterion.met)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Parse a persisted criterion, dropping anything malformed. */
export function parseGoalCriterion(raw: unknown): GoalCriterion | null {
  if (!isRecord(raw)) return null
  if (typeof raw.id !== 'string' || typeof raw.text !== 'string') return null
  return {
    id: raw.id,
    text: raw.text,
    met: raw.met === true,
    ...(typeof raw.metAt === 'number' ? { metAt: raw.metAt } : {})
  }
}

/** Parse a persisted goal link, dropping anything malformed. */
export function parseGoalLink(raw: unknown): GoalLink | null {
  if (!isRecord(raw)) return null
  if (typeof raw.runId !== 'string' || typeof raw.createdAt !== 'number') return null
  return {
    runId: raw.runId,
    createdAt: raw.createdAt,
    ...(typeof raw.planId === 'string' ? { planId: raw.planId } : {}),
    ...(typeof raw.sessionId === 'string' ? { sessionId: raw.sessionId } : {})
  }
}

/**
 * Parse a persisted goal. Returns `null` for anything that is not a well-formed
 * goal so a corrupt file can be dropped rather than trusted (fail-closed: an
 * unparseable goal never becomes the active one).
 */
export function parseGoal(raw: unknown, projectId: string): Goal | null {
  if (!isRecord(raw)) return null
  if (typeof raw.id !== 'string' || typeof raw.title !== 'string') return null
  if (!isGoalStatus(raw.status)) return null
  if (typeof raw.createdAt !== 'number') return null
  const criteria = Array.isArray(raw.criteria)
    ? raw.criteria.map(parseGoalCriterion).filter((c): c is GoalCriterion => c !== null)
    : []
  const links = Array.isArray(raw.links)
    ? raw.links.map(parseGoalLink).filter((l): l is GoalLink => l !== null)
    : []
  return {
    id: raw.id,
    projectId,
    title: raw.title,
    criteria,
    status: raw.status,
    createdAt: raw.createdAt,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : raw.createdAt,
    links,
    ...(typeof raw.closedAt === 'number' ? { closedAt: raw.closedAt } : {}),
    ...(typeof raw.note === 'string' ? { note: raw.note } : {})
  }
}

/** The on-disk shape of one project's goals. */
export interface GoalFile {
  version: number
  activeGoalId?: string
  goals: Goal[]
}

export const GOAL_FILE_VERSION = 1

/** In-memory shape used by the store before ids/timestamps are assigned. */
export interface NewGoalInput {
  title: string
  criteria?: string[]
}
