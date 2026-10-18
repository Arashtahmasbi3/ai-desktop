import type { Persistence } from '@core/agent/persistence'
import { renderFactLedger, type ProjectFact, type TranscriptMessage } from '@shared/memory-facts'
import type { CheckpointStore } from '../checkpoint-store'
import { FactLearner, type LearnResult } from '../fact-learning'
import type { FactStore } from '../fact-store'
import { loadProjectMemory } from '../project-memory'

/**
 * What the app remembers about a project (F0-4): the project memory files, the dated
 * fact ledger, and the decision log.
 *
 * Split out of `agent-service.ts`. Everything here is best-effort by design — having no
 * memory is a normal state, so no method may fail a run.
 */

export interface MemoryServiceDeps {
  persistence: Persistence
  now: () => number
  facts?: FactStore
  checkpoints?: CheckpointStore
  /** One bounded, non-streaming completion, used to extract facts. */
  complete: (prompt: string) => Promise<string>
}

export class MemoryService {
  private readonly persistence: Persistence
  private readonly now: () => number
  private readonly facts?: FactStore
  private readonly checkpoints?: CheckpointStore
  private readonly complete: (prompt: string) => Promise<string>

  constructor(deps: MemoryServiceDeps) {
    this.persistence = deps.persistence
    this.now = deps.now
    if (deps.facts) this.facts = deps.facts
    if (deps.checkpoints) this.checkpoints = deps.checkpoints
    this.complete = deps.complete
  }

  /**
   * System hint built from the active project's AI_CONTEXT.md / AGENTS.md.
   * Remote projects are skipped (their files are not on this machine).
   */
  async projectMemoryHint(): Promise<string | undefined> {
    try {
      const settings = await this.persistence.load()
      const active = settings.projects.find(
        (project) => project.id === settings.activeProjectId
      )
      if (!active || active.type === 'remote') return undefined
      return await loadProjectMemory(active.path)
    } catch {
      return undefined
    }
  }

  /** v3.1: the active project's facts as dated prior beliefs, or "" when there are none. */
  async factLedgerHint(projectId: string | undefined): Promise<string> {
    if (!this.facts || !projectId) return ''
    return renderFactLedger(await this.facts.live(projectId).catch(() => []), {
      now: this.now()
    })
  }

  /**
   * v3.1: learn durable facts from a finished session.
   *
   * Best-effort by design: memory is an optimisation, so a provider error, a junk reply or an
   * empty chat returns a reason instead of throwing, and the session that triggered it is
   * unaffected. The model call resolves a provider exactly as a run does, one-shot, at
   * temperature 0, and is bounded by the extraction prompt itself.
   */
  async learn(input: {
    messages: readonly TranscriptMessage[]
    task: string
  }): Promise<LearnResult> {
    const store = this.facts
    const project = this.persistence.getActiveProject()
    if (!store) {
      return { learned: 0, superseded: 0, skipped: 'model-error', error: 'memory is disabled' }
    }
    if (!project) return { learned: 0, superseded: 0, skipped: 'no-transcript' }

    const learner = new FactLearner({
      store,
      now: () => this.now(),
      complete: (prompt) => this.complete(prompt)
    })
    return learner.learn({ projectId: project.id, task: input.task, messages: input.messages })
  }

  /** v3.1: the active project's decision log, newest first. */
  async checkpointsForProject(limit?: number): Promise<unknown[]> {
    const project = this.persistence.getActiveProject()
    if (!this.checkpoints || !project) return []
    return limit === undefined
      ? this.checkpoints.list(project.id)
      : this.checkpoints.list(project.id, limit)
  }

  /** Everything ever learned about the active project, for the Settings view. */
  async projectFacts(): Promise<ProjectFact[]> {
    const project = this.persistence.getActiveProject()
    if (!this.facts || !project) return []
    return this.facts.list(project.id)
  }

  /** Forget one fact. Always possible: memory the user cannot delete is a liability. */
  async forgetFact(factId: string): Promise<boolean> {
    const project = this.persistence.getActiveProject()
    if (!this.facts || !project) return false
    return this.facts.forget(project.id, factId)
  }

  /** Forget everything about the active project. */
  async clearFacts(): Promise<void> {
    const project = this.persistence.getActiveProject()
    if (!this.facts || !project) return
    await this.facts.clear(project.id)
  }
}