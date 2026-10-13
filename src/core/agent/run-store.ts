import { createHash, randomUUID } from 'node:crypto'

/** Lifecycle of an agent run. Runs are kept around after they finish so their
 * captured file patches can still be reviewed and applied for a short window. */
export type AgentRunStatus = 'running' | 'completed' | 'aborted'

/**
 * An immutable snapshot of the project an agent run belongs to. `projectId` and
 * `projectRoot` are captured when the run starts and never change, so a patch
 * created during the run cannot be applied to a different project the user
 * switched to afterwards.
 */
export interface AgentRun {
  readonly id: string
  readonly projectId: string
  readonly projectRoot: string
  /** The project Goal this run serves, when one was selected (v2.6.2 T4.3). */
  readonly goalId?: string
  /** path -> hash of the file content the (next) patch is based on. */
  readonly baseRevisions: Map<string, string>
  readonly startedAt: number
  /**
   * Last time this run captured or applied a patch (v2.6.5). The TTL used to be
   * measured from `startedAt`, so a run longer than the TTL had *every* patch
   * already expired the moment it was captured and the user could never apply it.
   */
  lastActivityAt: number
  status: AgentRunStatus
}

/** How long a finished run's patches stay applicable. */
export const DEFAULT_RUN_TTL_MS = 30 * 60 * 1000

export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

/** Project-scoped file access used to verify and apply a patch. */
export interface RunFileIO {
  readAt(projectRoot: string, relativePath: string): Promise<string>
  writeAt(projectRoot: string, relativePath: string, content: string): Promise<void>
}

export type PatchRejection =
  | 'run-not-found'
  | 'run-expired'
  | 'project-changed'
  | 'file-changed'
  | 'write-failed'

export type ApplyPatchResult =
  | { ok: true }
  | { ok: false; reason: PatchRejection; message: string }

export interface CreateRunInput {
  projectId: string
  projectRoot: string
  /** Reuse the run id the orchestrator already emitted; generated otherwise. */
  id?: string
  startedAt?: number
  /** The project Goal this run serves, when one was selected. */
  goalId?: string
}

export interface CapturePatchInput {
  runId: string
  path: string
  /** Content the orchestrator saw before the write, used as a fallback. */
  fallbackBefore: string
  io: RunFileIO
}

export interface ApplyPatchInput {
  runId: string
  /** Project the user currently has open (`undefined` when none). */
  activeProjectId: string | undefined
  path: string
  content: string
  io: RunFileIO
  /** Clock override, mainly for tests. */
  at?: number
}

/**
 * Tracks agent runs so their captured file patches are bound to the project the
 * run started on. `applyPatch` re-checks project identity, run freshness and the
 * base revision before writing, which prevents a stale patch from being applied
 * to whichever project happens to be active at review time.
 */
export class RunStore {
  private readonly runs = new Map<string, AgentRun>()
  private readonly ttlMs: number
  private readonly now: () => number

  constructor(options: { ttlMs?: number; now?: () => number } = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_RUN_TTL_MS
    this.now = options.now ?? (() => Date.now())
  }

  createRun(input: CreateRunInput): AgentRun {
    // Drop runs that can no longer be applied so the map cannot grow forever.
    this.evictExpired(input.startedAt ?? this.now())
    const startedAt = input.startedAt ?? this.now()
    const run: AgentRun = {
      id: input.id ?? randomUUID(),
      projectId: input.projectId,
      projectRoot: input.projectRoot,
      ...(input.goalId ? { goalId: input.goalId } : {}),
      baseRevisions: new Map(),
      startedAt,
      lastActivityAt: startedAt,
      status: 'running'
    }
    this.runs.set(run.id, run)
    return run
  }

  /** Remove runs whose TTL has lapsed (v2.6.5: the map used to keep them forever). */
  private evictExpired(at: number): void {
    for (const [id, run] of this.runs) {
      if (at - run.lastActivityAt > this.ttlMs) this.runs.delete(id)
    }
  }

  getRun(id: string): AgentRun | undefined {
    return this.runs.get(id)
  }

  /** Freshness is measured from the last patch activity, not from the run start. */
  isExpired(run: AgentRun, at = this.now()): boolean {
    return at - run.lastActivityAt > this.ttlMs
  }

  markCompleted(id: string): void {
    const run = this.runs.get(id)
    if (run) run.status = 'completed'
  }

  markAborted(id: string): void {
    const run = this.runs.get(id)
    if (run) run.status = 'aborted'
  }

  /**
   * Read the file the patch targets from the run's own root and remember its
   * hash as the base revision. A read failure means the file is new, so no base
   * is recorded and `applyPatch` will refuse to overwrite a file that appears
   * before the patch is applied. Returns the `before` content for the review UI.
   */
  async capturePatch(input: CapturePatchInput): Promise<{ before: string }> {
    const run = this.runs.get(input.runId)
    if (!run) return { before: input.fallbackBefore }
    run.lastActivityAt = this.now()
    try {
      const before = await input.io.readAt(run.projectRoot, input.path)
      run.baseRevisions.set(input.path, hashContent(before))
      return { before }
    } catch {
      return { before: input.fallbackBefore }
    }
  }

  /**
   * Apply `content` to `path` inside the run's own project root, but only when
   * the run is still fresh, its project is the active one, and the file has not
   * changed externally since the patch captured its base revision.
   */
  async applyPatch(input: ApplyPatchInput): Promise<ApplyPatchResult> {
    const run = this.runs.get(input.runId)
    if (!run) {
      return { ok: false, reason: 'run-not-found', message: 'Run not found or expired.' }
    }
    if (this.isExpired(run, input.at)) {
      return {
        ok: false,
        reason: 'run-expired',
        message: 'This run expired. Re-run the task to create a fresh patch.'
      }
    }
    if (!input.activeProjectId || input.activeProjectId !== run.projectId) {
      return {
        ok: false,
        reason: 'project-changed',
        message: `Project changed since this patch was created. It belongs to ${run.projectId}, but ${input.activeProjectId ?? 'none'} is open.`
      }
    }

    const base = run.baseRevisions.get(input.path)
    if (base !== undefined) {
      let current: string
      try {
        current = await input.io.readAt(run.projectRoot, input.path)
      } catch {
        return {
          ok: false,
          reason: 'file-changed',
          message: `${input.path} was removed since this patch was created. Reload and retry.`
        }
      }
      if (hashContent(current) !== base) {
        return {
          ok: false,
          reason: 'file-changed',
          message: `${input.path} changed since this patch was created. Reload and retry.`
        }
      }
    } else {
      // No base revision means the file was new when captured: refuse to clobber
      // a file that someone (or something) created in the meantime.
      try {
        await input.io.readAt(run.projectRoot, input.path)
        return {
          ok: false,
          reason: 'file-changed',
          message: `${input.path} now exists. Reload and retry.`
        }
      } catch {
        // Expected: the file is still absent.
      }
    }

    try {
      await input.io.writeAt(run.projectRoot, input.path, input.content)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, reason: 'write-failed', message: `Could not write ${input.path}: ${message}` }
    }

    run.baseRevisions.set(input.path, hashContent(input.content))
    return { ok: true }
  }
}
