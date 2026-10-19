import type { AgentEvent, AgentQuestionView } from '@shared/ui'
import { isAbandonedAnswer, type AgentQuestion, type AskUserAnswer } from '@core/agent/question'

/**
 * The configured deadline after which an unanswered question **pauses** the run (X2).
 *
 * This is a pause deadline, not a timeout that answers for the user. In the session log
 * behind X2 the deadline used to resolve the gate with `null`, so the model read "the user
 * did not answer… proceed", kept going, and the card stayed on screen: an open question and
 * an advancing run at the same time, with `status: needs_input` and `stop: none`.
 *
 * Named, exported and overridable through `pauseAfterMs`, so no literal hides inside `ask()`
 * and a test can drive the deadline instead of waiting five minutes.
 */
export const QUESTION_PAUSE_AFTER_MS = 5 * 60_000

/**
 * The configured ceiling after which a still-unanswered question **ends** the run (X2).
 *
 * A pause with no ceiling is a parked run forever: if the window is closed, the run belongs
 * to a headless worker, or a harness wired a gate with nobody to answer it, nothing will ever
 * press the button. This is the bounded deadlock guard — the run ends as `needs_input` with a
 * diagnostic, and still nothing executes. It is deliberately much longer than the pause: the
 * first deadline is the user's nudge, this one is the machine's last word.
 */
export const QUESTION_ABANDON_AFTER_MS = 10 * 60_000

/** Schedules a deadline callback and returns its canceller. Injected so tests own the clock. */
export type QuestionPauseScheduler = (callback: () => void, ms: number) => () => void

const defaultSchedule: QuestionPauseScheduler = (callback, ms) => {
  const timer = setTimeout(callback, ms)
  timer.unref?.()
  return () => clearTimeout(timer)
}

export interface QuestionBrokerOptions {
  emit: (event: AgentEvent) => void
  /** How long to wait before the question pauses the run. Default {@link QUESTION_PAUSE_AFTER_MS}. */
  pauseAfterMs?: number
  /** How long to wait before the pause becomes the end of the run. Default {@link QUESTION_ABANDON_AFTER_MS}. */
  abandonAfterMs?: number
  /** Timer seam: the platform timers by default, a manual clock in tests. */
  schedule?: QuestionPauseScheduler
  now?: () => number
}

/**
 * Bridges the orchestrator's mid-run question to the renderer (v2.8.0, X2).
 *
 * `ask()` emits `question:request` and settles only on a real user action:
 *  - a non-empty answer,
 *  - an explicit "you decide" / "resume with my best assumption" (resolves `null`),
 *  - an explicit cancel (the run was stopped),
 *  - or the abandonment ceiling, which resolves `{ abandoned }` so the run **ends**.
 *
 * Reaching the pause deadline does none of those: it logs `question.paused` with the reason
 * and leaves the promise pending, so the orchestrator is still awaiting it and no step can
 * run. The renderer mirrors the same configured deadline (`timeoutMs` on the request) to
 * replace the card with the explicit affordance — the user is the one who decides to move on.
 * The ceiling exists so "no listener at all" is a bounded, explained stop rather than a hang.
 */
export class QuestionBroker {
  private readonly emit: (event: AgentEvent) => void
  private readonly pauseAfterMs: number
  private readonly abandonAfterMs: number
  private readonly schedule: QuestionPauseScheduler
  private readonly now: () => number
  private readonly pending = new Map<string, (answer: AskUserAnswer) => void>()
  private counter = 0

  constructor(options: QuestionBrokerOptions) {
    this.emit = options.emit
    this.pauseAfterMs = options.pauseAfterMs ?? QUESTION_PAUSE_AFTER_MS
    this.abandonAfterMs = options.abandonAfterMs ?? QUESTION_ABANDON_AFTER_MS
    this.schedule = options.schedule ?? defaultSchedule
    this.now = options.now ?? (() => Date.now())
  }

  /** Ask the user. Settles only when a human acts or the deadlock guard fires. */
  ask(runId: string, question: AgentQuestion): Promise<AskUserAnswer> {
    const id = 'question-' + ++this.counter
    const request: AgentQuestionView = {
      id,
      runId,
      prompt: question.prompt,
      timeoutMs: this.pauseAfterMs,
      ...(question.options && question.options.length > 0 ? { options: question.options } : {})
    }
    return new Promise<AskUserAnswer>((resolve) => {
      const cancelPause = this.schedule(() => this.pause(id, runId), this.pauseAfterMs)
      const cancelAbandon = this.schedule(() => this.abandon(id, runId), this.abandonAfterMs)
      this.pending.set(id, (answer) => {
        cancelPause()
        cancelAbandon()
        resolve(answer)
      })
      this.emit({ type: 'question:request', request, at: this.now() })
    })
  }

  /**
   * X2: the deadline elapsed with the question still open.
   *
   * Deliberately settles nothing. `pending` still holds the id, so the run stays parked
   * until {@link resolve} or {@link cancelAll} is called; the log entry carries the reason
   * and the deadline, so a session log explains the pause instead of showing a run that
   * simply stopped making progress.
   */
  private pause(id: string, runId: string): void {
    if (!this.pending.has(id)) return
    this.emit({
      type: 'log',
      entry: {
        ts: new Date(this.now()).toISOString(),
        level: 'warn',
        event: 'question.paused',
        runId,
        questionId: id,
        reason: 'no_answer_before_pause_deadline',
        pauseAfterMs: this.pauseAfterMs,
        message:
          'The question was not answered within ' +
          this.pauseAfterMs +
          'ms, so the run is paused here. No tool runs until the user answers, resumes with ' +
          'their best assumption, or stops the run.'
      }
    })
  }

  /**
   * X2's bounded deadlock guard: the pause was never acted on, so the run ends.
   *
   * This is not an answer and never resumes the loop — it resolves `{ abandoned }`, the
   * orchestrator turns it into `needs_input` with this reason, and the tool calls behind the
   * question are answered for the transcript without executing. Without it, a run whose
   * window was closed (or that nobody ever listened to) would wait forever.
   */
  private abandon(id: string, runId: string): void {
    if (!this.pending.has(id)) return
    const reason =
      'The question was never answered: it stayed open past the pause deadline and the ' +
      this.abandonAfterMs +
      'ms abandonment ceiling, so the run ended instead of waiting forever. No tool ran — ' +
      'ask again when the user is present.'
    this.emit({
      type: 'log',
      entry: {
        ts: new Date(this.now()).toISOString(),
        level: 'warn',
        event: 'question.abandoned',
        runId,
        questionId: id,
        reason: 'abandonment_ceiling_reached',
        abandonAfterMs: this.abandonAfterMs,
        message: reason
      }
    })
    this.settle(id, { abandoned: reason })
  }

  /**
   * Called from IPC when the user answers. Returns whether a request matched.
   * An empty answer is treated as "no answer" rather than as the empty string: the user is
   * telling the agent to decide, which is a decision and not a typo.
   */
  resolve(id: string, answer: string | null): boolean {
    const normalized = typeof answer === 'string' && answer.trim() !== '' ? answer.trim() : null
    return this.settle(id, normalized)
  }

  /** Hand one settled answer to its waiter and close the card. */
  private settle(id: string, answer: AskUserAnswer): boolean {
    const settle = this.pending.get(id)
    if (!settle) return false
    this.pending.delete(id)
    this.emit({
      type: 'question:resolved',
      id,
      answered: !isAbandonedAnswer(answer) && answer !== null,
      at: this.now()
    })
    settle(answer)
    return true
  }

  /** Explicitly cancel every outstanding question (e.g. the run was stopped). */
  cancelAll(): void {
    for (const id of [...this.pending.keys()]) this.resolve(id, null)
  }

  pendingCount(): number {
    return this.pending.size
  }
}
