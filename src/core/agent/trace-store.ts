/**
 * In-memory trace store (v2.6.2 T3.2).
 *
 * Holds the decisions a run emitted so the renderer can ask "why?" about one of
 * them without re-running anything. Bounded: only the most recent runs are kept,
 * because this is a live-debugging aid, not the durable record (that is the audit
 * trail, T3.3).
 */
import type { TraceDecision, TraceExplanation } from '@shared/trace'
import { explainDecision } from '@shared/trace'

export class TraceStore {
  private readonly runs = new Map<string, Map<string, TraceDecision>>()

  constructor(private readonly maxRuns = 20) {}

  /** Record a decision, keeping insertion order per run. */
  record(decision: TraceDecision): void {
    let run = this.runs.get(decision.runId)
    if (!run) {
      run = new Map()
      this.runs.set(decision.runId, run)
    }
    run.set(decision.id, decision)
    while (this.runs.size > this.maxRuns) {
      const oldest = this.runs.keys().next().value
      if (oldest === undefined) break
      this.runs.delete(oldest)
    }
  }

  /** Decisions for a run, oldest first. */
  forRun(runId: string): TraceDecision[] {
    return [...(this.runs.get(runId)?.values() ?? [])]
  }

  get(runId: string, decisionId: string): TraceDecision | undefined {
    return this.runs.get(runId)?.get(decisionId)
  }

  /** Explain one decision deterministically, or `undefined` if unknown. */
  explain(runId: string, decisionId: string): TraceExplanation | undefined {
    const decision = this.get(runId, decisionId)
    return decision ? explainDecision(decision) : undefined
  }

  clear(runId: string): void {
    this.runs.delete(runId)
  }
}
