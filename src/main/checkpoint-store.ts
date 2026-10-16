/**
 * Checkpoint persistence (v3.1).
 *
 * An **append-only JSONL log per project**, not a mutable document: a decision record is history,
 * and history that can be rewritten is worth less than no history. Appends are the only write, and
 * a corrupt line is skipped rather than failing the read.
 *
 * Boundaries are injected, so this is tested without touching the disk.
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { DecisionCheckpoint } from '@shared/decision-checkpoint'
import { safeProjectId } from './fact-store'

export interface CheckpointStoreDeps {
  dir: string
  readFile?: (path: string, encoding: 'utf8') => Promise<string | Buffer>
  appendFile?: (path: string, data: string) => Promise<void>
  mkdir?: (path: string, options: { recursive: true }) => Promise<string | undefined>
  now?: () => number
}

/** How many records are returned when no limit is given. */
export const CHECKPOINT_PAGE = 200

export class CheckpointStore {
  private readonly dir: string
  private readonly readFileImpl: (path: string, encoding: 'utf8') => Promise<string | Buffer>
  private readonly appendFileImpl: (path: string, data: string) => Promise<void>
  private readonly mkdirImpl: (path: string, options: { recursive: true }) => Promise<string | undefined>
  private readonly now: () => number

  constructor(deps: CheckpointStoreDeps) {
    this.dir = deps.dir
    this.readFileImpl = deps.readFile ?? ((path, encoding) => fs.readFile(path, encoding))
    this.appendFileImpl = deps.appendFile ?? ((path, data) => fs.appendFile(path, data, 'utf8'))
    this.mkdirImpl = deps.mkdir ?? ((path, options) => fs.mkdir(path, options))
    this.now = deps.now ?? (() => Date.now())
  }

  /** Append one checkpoint. Returns the stored record so a caller can show it. */
  async append(checkpoint: DecisionCheckpoint): Promise<DecisionCheckpoint> {
    const projectId = safeProjectId(checkpoint.projectId ?? '')
    if (!projectId) return checkpoint
    await this.mkdirImpl(this.dir, { recursive: true }).catch(() => undefined)
    // One line, no trailing newline inside it, so the log stays parseable line by line.
    await this.appendFileImpl(this.pathFor(projectId), `${JSON.stringify(checkpoint)}\n`)
    return checkpoint
  }

  /** Newest first, which is how a review list reads. */
  async list(projectId: string, limit = CHECKPOINT_PAGE): Promise<DecisionCheckpoint[]> {
    const id = safeProjectId(projectId)
    if (!id) return []
    let raw: string
    try {
      raw = (await this.readFileImpl(this.pathFor(id), 'utf8')).toString()
    } catch {
      return []
    }
    const out: DecisionCheckpoint[] = []
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (trimmed === '') continue
      try {
        const parsed = JSON.parse(trimmed) as DecisionCheckpoint
        // A record without an id or an intent cannot be reviewed, so it is not reported as one.
        if (parsed && typeof parsed.id === 'string' && typeof parsed.intent === 'string') out.push(parsed)
      } catch {
        // One corrupt line must not hide the rest of the history.
      }
    }
    return out.reverse().slice(0, Math.max(0, limit))
  }

  /** Records at or above a given impact, for a filtered review. */
  async listImpact(projectId: string, impact: DecisionCheckpoint['impact']): Promise<DecisionCheckpoint[]> {
    const all = await this.list(projectId)
    return all.filter((entry) => entry.impact === impact)
  }

  /** The file this project's log lives in — for a "show me the raw record" affordance. */
  path(projectId: string): string | undefined {
    const id = safeProjectId(projectId)
    return id ? this.pathFor(id) : undefined
  }

  private pathFor(projectId: string): string {
    return join(this.dir, `${projectId}.jsonl`)
  }

  /** Exposed for callers that need the clock this store uses (tests, and the wiring). */
  currentTime(): number {
    return this.now()
  }
}
