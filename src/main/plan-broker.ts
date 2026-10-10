import type { Plan, PlanDecision, PlanWarning } from '@shared/plan'
import type { AgentEvent, PlanRequest } from '@shared/ui'

export const DEFAULT_PLAN_TIMEOUT_MS = 5 * 60 * 1000

export interface PlanBrokerOptions {
  emit: (event: AgentEvent) => void
  timeoutMs?: number
  now?: () => number
}

/**
 * Bridges the orchestrator's plan gate to the renderer: emits a `plan:request`
 * event and resolves with the user's decision. If nobody answers before the
 * timeout the plan is cancelled (fail closed), mirroring {@link ApprovalBroker}.
 */
export class PlanBroker {
  private readonly emit: (event: AgentEvent) => void
  private readonly timeoutMs: number
  private readonly now: () => number
  private readonly pending = new Map<string, (decision: PlanDecision) => void>()
  private counter = 0

  constructor(options: PlanBrokerOptions) {
    this.emit = options.emit
    this.timeoutMs = options.timeoutMs ?? DEFAULT_PLAN_TIMEOUT_MS
    this.now = options.now ?? (() => Date.now())
  }

  /** Ask the renderer to approve a plan. Resolves cancelled on timeout. */
  request(runId: string, plan: Plan, warnings: PlanWarning[] = []): Promise<PlanDecision> {
    const id = `plan-${++this.counter}`
    const request: PlanRequest = { id, runId, plan, warnings }
    return new Promise<PlanDecision>((resolve) => {
      const timer = setTimeout(() => this.resolve(id, { type: 'cancel' }), this.timeoutMs)
      timer.unref?.()
      this.pending.set(id, (decision) => {
        clearTimeout(timer)
        resolve(decision)
      })
      this.emit({ type: 'plan:request', request })
    })
  }

  /** Called from IPC when the user answers. Returns whether a request matched. */
  resolve(id: string, decision: PlanDecision): boolean {
    const settle = this.pending.get(id)
    if (!settle) return false
    this.pending.delete(id)
    this.emit({ type: 'plan:resolved', id, decision, at: this.now() })
    settle(decision)
    return true
  }

  /** Cancel every outstanding plan (e.g. the run was aborted). */
  cancelAll(): void {
    for (const id of [...this.pending.keys()]) this.resolve(id, { type: 'cancel' })
  }

  pendingCount(): number {
    return this.pending.size
  }
}
