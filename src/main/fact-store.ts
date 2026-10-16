/**
 * Project-fact persistence (v3.1).
 *
 * One JSON file per project under `<userData>/facts/<projectId>.json`, written atomically
 * (temp + rename) so a crash mid-write cannot leave a half-file that loses the ledger.
 *
 * Every boundary is injected (`readFile`/`writeFile`/`rename`/`mkdir`/`now`), which is how this
 * is tested without touching the disk — the same pattern the session store and persistence layer
 * already use.
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import {
  MAX_FACTS_PER_PROJECT,
  applyFactProposals,
  liveFacts,
  parseFactFile,
  trimFacts,
  type FactProposal,
  type FactSource,
  type ProjectFact
} from '@shared/memory-facts'

export interface FactStoreDeps {
  dir: string
  readFile?: (path: string, encoding: 'utf8') => Promise<string | Buffer>
  writeFile?: (path: string, data: string) => Promise<void>
  rename?: (from: string, to: string) => Promise<void>
  mkdir?: (path: string, options: { recursive: true }) => Promise<string | undefined>
  rm?: (path: string) => Promise<void>
  now?: () => number
}

/** Ids are UUIDs; anything else is refused rather than becoming a path segment. */
export function safeProjectId(projectId: string): string | undefined {
  const value = String(projectId ?? '').trim()
  if (!value || value.length > 64) return undefined
  return /^[A-Za-z0-9._-]+$/.test(value) ? value : undefined
}

export class FactStore {
  private readonly dir: string
  private readonly readFileImpl: (path: string, encoding: 'utf8') => Promise<string | Buffer>
  private readonly writeFileImpl: (path: string, data: string) => Promise<void>
  private readonly renameImpl: (from: string, to: string) => Promise<void>
  private readonly mkdirImpl: (path: string, options: { recursive: true }) => Promise<string | undefined>
  private readonly rmImpl: (path: string) => Promise<void>
  private readonly now: () => number
  /** Projects already prepared on disk, so we do not mkdir on every read. */
  private readonly ready = new Set<string>()

  constructor(deps: FactStoreDeps) {
    this.dir = deps.dir
    this.readFileImpl = deps.readFile ?? ((path, encoding) => fs.readFile(path, encoding))
    this.writeFileImpl = deps.writeFile ?? ((path, data) => fs.writeFile(path, data, 'utf8'))
    this.renameImpl = deps.rename ?? ((from, to) => fs.rename(from, to))
    this.mkdirImpl = deps.mkdir ?? ((path, options) => fs.mkdir(path, options))
    this.rmImpl = deps.rm ?? ((path) => fs.rm(path, { force: true }))
    this.now = deps.now ?? (() => Date.now())
  }

  /** Every fact ever recorded for a project, oldest first. */
  async list(projectId: string): Promise<ProjectFact[]> {
    const id = safeProjectId(projectId)
    if (!id) return []
    try {
      const raw = await this.readFileImpl(this.pathFor(id), 'utf8')
      return parseFactFile(JSON.parse(raw.toString()), id)
    } catch {
      // No file yet, or an unreadable one: an empty ledger, never a thrown error on startup.
      return []
    }
  }

  /** The facts a prompt may rely on right now. */
  async live(projectId: string): Promise<ProjectFact[]> {
    return liveFacts(await this.list(projectId), this.now())
  }

  /**
   * Merge extracted proposals into the ledger. Superseding a fact closes its validity window at
   * `now` and keeps the statement, so the project's history stays answerable.
   */
  async add(
    projectId: string,
    proposals: readonly FactProposal[],
    options: { source?: FactSource } = {}
  ): Promise<{ added: ProjectFact[]; superseded: ProjectFact[] }> {
    const id = safeProjectId(projectId)
    if (!id || proposals.length === 0) return { added: [], superseded: [] }

    const existing = await this.list(id)
    const result = applyFactProposals(existing, proposals, {
      projectId: id,
      now: this.now(),
      ...(options.source ? { source: options.source } : {}),
      idFactory: () => this.newFactId()
    })
    await this.write(id, result.facts)
    return { added: result.added, superseded: result.superseded }
  }

  /** Remove one fact outright — the user's "forget this", which must always be possible. */
  async forget(projectId: string, factId: string): Promise<boolean> {
    const id = safeProjectId(projectId)
    if (!id) return false
    const existing = await this.list(id)
    const next = existing.filter((fact) => fact.id !== factId)
    if (next.length === existing.length) return false
    await this.write(id, next)
    return true
  }

  /** Forget everything about a project. */
  async clear(projectId: string): Promise<void> {
    const id = safeProjectId(projectId)
    if (!id) return
    await this.rmImpl(this.pathFor(id)).catch(() => undefined)
  }

  private pathFor(projectId: string): string {
    return join(this.dir, `${projectId}.json`)
  }

  private async write(projectId: string, facts: readonly ProjectFact[]): Promise<void> {
    if (!this.ready.has(projectId)) {
      await this.mkdirImpl(this.dir, { recursive: true }).catch(() => undefined)
      this.ready.add(projectId)
    }
    const target = this.pathFor(projectId)
    const temporary = `${target}.tmp`
    const payload = JSON.stringify({ version: 1, facts: trimFacts(facts, MAX_FACTS_PER_PROJECT) }, null, 2)
    await this.writeFileImpl(temporary, payload)
    // Atomic swap: a crash leaves either the old ledger or the new one, never a partial file.
    await this.renameImpl(temporary, target)
  }

  private newFactId(): string {
    // Collision-resistant without a dependency; the ledger is per project and small.
    return `fact-${this.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  }
}
