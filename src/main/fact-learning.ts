/**
 * Fact learning (v3.1) — the one place that calls a model to grow project memory.
 *
 * Two deliberate properties:
 *
 *  - **It is bounded.** At most five facts, from at most the last 24 messages, from a transcript
 *    capped by characters, on a model the caller chooses. Memory must not become a silent tax
 *    on every session.
 *  - **It never blocks or breaks a run.** Extraction is a separate, best-effort call: a provider
 *    error, a malformed reply or a timeout yields "learned nothing", never a failed session.
 *
 * The model call is injected as `complete`, so this module is tested with a scripted reply and
 * never touches a network, an API key or Electron.
 */
import {
  MIN_FACT_CHARS,
  buildFactExtractionPrompt,
  buildTranscript,
  parseFactExtraction,
  type FactProposal,
  type FactSource,
  type ProjectFact,
  type TranscriptMessage
} from '@shared/memory-facts'
import type { FactStore } from './fact-store'

export interface FactLearnerDeps {
  store: FactStore
  /** One-shot completion. Implemented in `AppServices` with the user's own provider + key. */
  complete: (prompt: string) => Promise<string>
  now?: () => number
}

export interface LearnResult {
  learned: number
  superseded: number
  /** Set when learning could not run; the run that triggered it is unaffected either way. */
  skipped?: 'no-transcript' | 'no-facts' | 'model-error'
  error?: string
}

export class FactLearner {
  private readonly store: FactStore
  private readonly complete: (prompt: string) => Promise<string>
  private readonly now: () => number

  constructor(deps: FactLearnerDeps) {
    this.store = deps.store
    this.complete = deps.complete
    this.now = deps.now ?? (() => Date.now())
  }

  /**
   * Extract durable facts from a finished session and merge them into the ledger.
   *
   * `supersedes` is only honoured for ids the model was actually shown, so a hallucinated id
   * cannot invalidate somebody else's belief (that check lives in `parseFactExtraction`).
   */
  async learn(input: {
    projectId: string
    task: string
    messages: readonly TranscriptMessage[]
    source?: FactSource
  }): Promise<LearnResult> {
    const transcript = buildTranscript(input.messages)
    if (transcript.trim().length === 0) return { learned: 0, superseded: 0, skipped: 'no-transcript' }

    const known = await this.store.live(input.projectId)
    const prompt = buildFactExtractionPrompt({
      task: input.task,
      transcript,
      known,
      now: this.now()
    })

    let reply: string
    try {
      reply = await this.complete(prompt)
    } catch (error) {
      // Memory is an optimisation; a provider hiccup must never surface as a failed session.
      return {
        learned: 0,
        superseded: 0,
        skipped: 'model-error',
        error: error instanceof Error ? error.message : String(error)
      }
    }

    const proposals: FactProposal[] = parseFactExtraction(reply, known).filter(
      (proposal) => proposal.text.length >= MIN_FACT_CHARS
    )
    if (proposals.length === 0) return { learned: 0, superseded: 0, skipped: 'no-facts' }

    const { added, superseded } = await this.store.add(input.projectId, proposals, {
      ...(input.source ? { source: input.source } : {})
    })
    return { learned: added.length, superseded: superseded.length }
  }

  /** Everything ever learned about a project, for the Settings view. */
  async ledger(projectId: string): Promise<ProjectFact[]> {
    return this.store.list(projectId)
  }
}
