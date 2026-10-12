/**
 * On-disk persistence for project goals (v2.6.2, Topic 4).
 *
 * Goals live in `<appData>/projects/<projectId>/goals.json`, the same layout for
 * local and remote projects: a remote project has no local root, but it still has
 * an app-data directory keyed by its project id. Every record is re-parsed
 * through `@shared/goal` on read, so a corrupt file degrades to "no goals"
 * instead of crashing the app or resurrecting a malformed active goal.
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  GOAL_FILE_VERSION,
  goalProgress,
  parseGoal,
  type Goal,
  type GoalFile,
  type GoalLink,
  type GoalUpdate,
  type NewGoalInput
} from '@shared/goal'

/** The result of picking the goal a run should attach itself to. */
export type ResolvedGoal =
  | { kind: 'none' }
  | { kind: 'resolved'; goalId: string }
  | { kind: 'ambiguous'; goalIds: string[] }

export interface GoalStoreOptions {
  /** App-data root; goals are written under `projects/<projectId>/goals.json`. */
  dir: string
  /** Clock override, mainly for tests. */
  now?: () => number
  /** Id generator override, mainly for tests. */
  generateId?: () => string
}

export type { GoalUpdate } from '@shared/goal'

export class GoalStore {
  private readonly dir: string
  private readonly now: () => number
  private readonly generateId: () => string

  constructor(options: GoalStoreOptions) {
    this.dir = options.dir
    this.now = options.now ?? (() => Date.now())
    this.generateId = options.generateId ?? (() => randomUUID())
  }

  private fileFor(projectId: string): string {
    return join(this.dir, 'projects', projectId, 'goals.json')
  }

  private async readFile(projectId: string): Promise<GoalFile> {
    try {
      const text = await readFile(this.fileFor(projectId), 'utf8')
      return this.parseFile(JSON.parse(text), projectId)
    } catch {
      return { version: GOAL_FILE_VERSION, goals: [] }
    }
  }

  private parseFile(raw: unknown, projectId: string): GoalFile {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return { version: GOAL_FILE_VERSION, goals: [] }
    }
    const record = raw as Record<string, unknown>
    const goals = Array.isArray(record.goals)
      ? record.goals.map((goal) => parseGoal(goal, projectId)).filter((g): g is Goal => g !== null)
      : []
    const active =
      typeof record.activeGoalId === 'string' && goals.some((goal) => goal.id === record.activeGoalId)
        ? record.activeGoalId
        : undefined
    return { version: GOAL_FILE_VERSION, goals, ...(active ? { activeGoalId: active } : {}) }
  }

  private async writeFile(projectId: string, file: GoalFile): Promise<void> {
    const target = this.fileFor(projectId)
    await mkdir(dirname(target), { recursive: true })
    // Write-then-rename so a crash mid-write cannot truncate the goals file.
    const temp = `${target}.${process.pid}.${this.generateId()}.tmp`
    await writeFile(temp, JSON.stringify(file, null, 2), 'utf8')
    await rename(temp, target)
  }

  /** Every goal recorded for a project, oldest first. */
  async list(projectId: string): Promise<Goal[]> {
    const file = await this.readFile(projectId)
    return [...file.goals].sort((a, b) => a.createdAt - b.createdAt)
  }

  async get(projectId: string, goalId: string): Promise<Goal | undefined> {
    return (await this.readFile(projectId)).goals.find((goal) => goal.id === goalId)
  }

  async create(projectId: string, input: NewGoalInput): Promise<Goal> {
    const file = await this.readFile(projectId)
    const at = this.now()
    const goal: Goal = {
      id: this.generateId(),
      projectId,
      title: input.title,
      criteria: (input.criteria ?? []).map((text) => ({
        id: this.generateId(),
        text,
        met: false
      })),
      status: 'active',
      createdAt: at,
      updatedAt: at,
      links: []
    }
    file.goals.push(goal)
    // The first goal of a project becomes active automatically.
    if (!file.activeGoalId) file.activeGoalId = goal.id
    await this.writeFile(projectId, file)
    return goal
  }

  /** Apply a partial update. Returns the updated goal, or undefined if missing. */
  async update(projectId: string, goalId: string, patch: GoalUpdate): Promise<Goal | undefined> {
    const file = await this.readFile(projectId)
    const goal = file.goals.find((candidate) => candidate.id === goalId)
    if (!goal) return undefined
    if (patch.title !== undefined) goal.title = patch.title
    if (patch.criteria !== undefined) goal.criteria = patch.criteria
    goal.updatedAt = this.now()
    await this.writeFile(projectId, file)
    return goal
  }

  /** Mark a single criterion met/unmet. Returns the updated goal, if found. */
  async setCriterion(
    projectId: string,
    goalId: string,
    criterionId: string,
    met: boolean
  ): Promise<Goal | undefined> {
    const file = await this.readFile(projectId)
    const goal = file.goals.find((candidate) => candidate.id === goalId)
    if (!goal) return undefined
    const criterion = goal.criteria.find((candidate) => candidate.id === criterionId)
    if (!criterion) return undefined
    const at = this.now()
    criterion.met = met
    if (met) criterion.metAt = at
    else delete criterion.metAt
    goal.updatedAt = at
    await this.writeFile(projectId, file)
    return goal
  }

  async delete(projectId: string, goalId: string): Promise<boolean> {
    const file = await this.readFile(projectId)
    const index = file.goals.findIndex((goal) => goal.id === goalId)
    if (index === -1) return false
    file.goals.splice(index, 1)
    if (file.activeGoalId === goalId) delete file.activeGoalId
    await this.writeFile(projectId, file)
    return true
  }

  /** Set (or clear, with `null`) the project's explicit active goal. */
  async setActive(projectId: string, goalId: string | null): Promise<boolean> {
    const file = await this.readFile(projectId)
    if (goalId === null) {
      if (!file.activeGoalId) return false
      delete file.activeGoalId
      await this.writeFile(projectId, file)
      return true
    }
    const goal = file.goals.find((candidate) => candidate.id === goalId)
    if (!goal) return false
    file.activeGoalId = goalId
    await this.writeFile(projectId, file)
    return true
  }

  /**
   * The goal a run should attach to. An explicit active goal wins; otherwise a
   * single `active` goal is unambiguous, several are `ambiguous` (the caller must
   * ask the user) and none is `none`.
   */
  async resolveGoalId(projectId: string): Promise<ResolvedGoal> {
    const file = await this.readFile(projectId)
    if (file.activeGoalId) {
      const active = file.goals.find((goal) => goal.id === file.activeGoalId)
      if (active && active.status === 'active') return { kind: 'resolved', goalId: active.id }
    }
    const open = file.goals.filter((goal) => goal.status === 'active')
    if (open.length === 0) return { kind: 'none' }
    if (open.length === 1) return { kind: 'resolved', goalId: open[0].id }
    return { kind: 'ambiguous', goalIds: open.map((goal) => goal.id) }
  }

  /** The active goal, when one is unambiguously selected. */
  async getActive(projectId: string): Promise<Goal | undefined> {
    const resolved = await this.resolveGoalId(projectId)
    if (resolved.kind !== 'resolved') return undefined
    return this.get(projectId, resolved.goalId)
  }

  /** Record that a run worked on a goal. Idempotent per run id. */
  async linkRun(projectId: string, goalId: string, link: GoalLink): Promise<Goal | undefined> {
    const file = await this.readFile(projectId)
    const goal = file.goals.find((candidate) => candidate.id === goalId)
    if (!goal) return undefined
    if (!goal.links.some((existing) => existing.runId === link.runId)) {
      goal.links.push(link)
      goal.updatedAt = this.now()
      await this.writeFile(projectId, file)
    }
    return goal
  }

  /** Progress for a goal (0/0 when it has no criteria). */
  async progress(projectId: string, goalId: string): Promise<{ met: number; total: number } | undefined> {
    const goal = await this.get(projectId, goalId)
    return goal ? goalProgress(goal) : undefined
  }

  async achieve(projectId: string, goalId: string): Promise<Goal | undefined> {
    return this.close(projectId, goalId, 'achieved')
  }

  async abandon(projectId: string, goalId: string, note?: string): Promise<Goal | undefined> {
    return this.close(projectId, goalId, 'abandoned', note)
  }

  async block(projectId: string, goalId: string, note?: string): Promise<Goal | undefined> {
    return this.close(projectId, goalId, 'blocked', note)
  }

  private async close(
    projectId: string,
    goalId: string,
    status: 'achieved' | 'abandoned' | 'blocked',
    note?: string
  ): Promise<Goal | undefined> {
    const file = await this.readFile(projectId)
    const goal = file.goals.find((candidate) => candidate.id === goalId)
    if (!goal) return undefined
    const at = this.now()
    goal.status = status
    goal.closedAt = at
    goal.updatedAt = at
    if (note !== undefined) goal.note = note
    // A closed goal must not stay selected; the next run would be misattributed.
    if (file.activeGoalId === goalId) delete file.activeGoalId
    await this.writeFile(projectId, file)
    return goal
  }
}
