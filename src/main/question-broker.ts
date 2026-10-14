import type { AgentEvent, AgentQuestionView } from '@shared/ui'
import type { AgentQuestion } from '@core/agent/question'

/** How long a mid-run question waits before the agent proceeds without an answer. */
export const QUESTION_TIMEOUT_MS = 5 * 60_000

export interface QuestionBrokerOptions {
  emit: (event: AgentEvent) => void
  timeoutMs?: number
  now?: () => number
}

/**
 * Bridges the orchestrator's mid-run question to the renderer (v2.8.0): emits a
 * `question:request` and resolves with the user's answer. Modelled on
 * {@link PlanBroker} / {@link PreflightBroker}, with one deliberate difference —
 * the timeout resolves `null` ("the user did not answer") rather than cancelling,
 * because a question is not a gate: the run should carry on with the model's own
 * judgement instead of stopping or hanging.
 */
export class QuestionBroker {
  private readonly emit: (event: AgentEvent) => void
  private readonly timeoutMs: number
  private readonly now: () => number
  private readonly pending = new Map<string, (answer: string | null) => void>()
  private counter = 0

  constructor(options: QuestionBrokerOptions) {
    this.emit = options.emit
    this.timeoutMs = options.timeoutMs ?? QUESTION_TIMEOUT_MS
    this.now = options.now ?? (() => Date.now())
  }

  /** Ask the user. Resolves `null` on timeout, so the run never hangs. */
  ask(runId: string, question: AgentQuestion): Promise<string | null> {
    const id = `question-${++this.counter}`
    const request: AgentQuestionView = {
      id,
      runId,
      prompt: question.prompt,
      timeoutMs: this.timeoutMs,
      ...(question.options && question.options.length > 0 ? { options: question.options } : {})
    }
    return new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => this.resolve(id, null), this.timeoutMs)
      timer.unref?.()
      this.pending.set(id, (answer) => {
        clearTimeout(timer)
        resolve(answer)
      })
      this.emit({ type: 'question:request', request, at: this.now() })
    })
  }

  /**
   * Called from IPC when the user answers. Returns whether a request matched.
   * An empty answer is treated as "no answer" rather than as the empty string.
   */
  resolve(id: string, answer: string | null): boolean {
    const settle = this.pending.get(id)
    if (!settle) return false
    this.pending.delete(id)
    const normalized = typeof answer === 'string' && answer.trim() !== '' ? answer.trim() : null
    this.emit({ type: 'question:resolved', id, answered: normalized !== null, at: this.now() })
    settle(normalized)
    return true
  }

  /** Answer every outstanding question as unanswered (e.g. the run was aborted). */
  cancelAll(): void {
    for (const id of [...this.pending.keys()]) this.resolve(id, null)
  }

  pendingCount(): number {
    return this.pending.size
  }
}
