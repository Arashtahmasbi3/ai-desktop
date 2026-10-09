import type {
  LoopDetectionPolicy,
  LoopStopReason,
  LoopWarning
} from '@shared/agent'
import { DEFAULT_LOOP_POLICY } from '@shared/agent'

/** What one completed step tells the detector. */
export interface LoopObservation {
  /** Signatures of every action attempted in the step. */
  signatures: string[]
  /** Whether the step advanced the task (a new action succeeded). */
  productive: boolean
  /** How many of this step's actions failed (defaults to 0). */
  failures?: number
  /** Signature of the model's narration, used to spot repeated reasoning. */
  reasoningSignature?: string
  /** Whether this step introduced at least one brand-new action. */
  newAction?: boolean
}

export interface LoopCheckResult {
  warnings: LoopWarning[]
  /** Guidance to inject into the model context, if any. */
  hint?: string
  /** True when the run should pause and ask the user for guidance. */
  shouldAskUser: boolean
  /** True when the run must stop and hand control back to the user. */
  stop: boolean
  /** Why the run stopped, when {@link stop} is true. */
  stopReason?: LoopStopReason
}

function buildHint(warnings: LoopWarning[]): string {
  return warnings
    .map((warning) => {
      switch (warning.kind) {
        case 'repeated_action':
          return (
            `[loop-detected] You have repeated the same action ${warning.count} times ` +
            `(${warning.signature}). Repeating it again will not change the result. ` +
            'Change the arguments, use a different tool, or re-read the last observation.'
          )
        case 'failure_streak':
          return (
            `[loop-detected] Your last ${warning.count} steps all failed. ` +
            'Stop retrying the same approach and explain what is blocking you before proceeding.'
          )
        case 'reasoning_loop':
          return (
            `[loop-detected] You have repeated the same reasoning ${warning.count} times ` +
            'without making a new tool call. Commit to a different, concrete action.'
          )
        case 'turn_timeout':
          return '[loop-detected] This turn exceeded its time budget. Wrap up and report progress.'
        default:
          return (
            `[loop-detected] ${warning.count} consecutive steps produced no progress. ` +
            'Stop repeating and explain what is blocking you, or try a fundamentally different approach.'
          )
      }
    })
    .join('\n')
}

/**
 * Detects unproductive cycles:
 *  - the same action repeated across a sliding window of recent steps,
 *  - several consecutive steps whose actions all failed,
 *  - the model repeating the same reasoning without a new action, and
 *  - a run that exceeds its wall-clock budget.
 *
 * Severity is layered: a repeated action first produces a WARN (so the model can
 * self-correct), then a STOP once it crosses the hard threshold. Any STOP reason
 * sets {@link LoopCheckResult.stop} so the orchestrator can hand control back.
 */
export class LoopDetector {
  private readonly counts = new Map<string, number>()
  private readonly warnedSignatures = new Set<string>()
  private readonly window: string[] = []
  private consecutiveNoProgress = 0
  private consecutiveFailures = 0
  private reasoningStreak = 0
  private lastReasoning: string | null = null
  private stopReason: LoopStopReason | undefined
  private stopped = false
  private readonly policy: LoopDetectionPolicy

  constructor(policy: Partial<LoopDetectionPolicy> = {}) {
    this.policy = { ...DEFAULT_LOOP_POLICY, ...policy }
  }

  get noProgressSteps(): number {
    return this.consecutiveNoProgress
  }

  get windowSize(): number {
    return this.window.length
  }

  /** True once a hard stop condition has fired for this run. */
  get isStopped(): boolean {
    return this.stopped
  }

  signatureCount(signature: string): number {
    return this.counts.get(signature) ?? 0
  }

  reset(): void {
    this.counts.clear()
    this.warnedSignatures.clear()
    this.window.length = 0
    this.consecutiveNoProgress = 0
    this.consecutiveFailures = 0
    this.reasoningStreak = 0
    this.lastReasoning = null
    this.stopReason = undefined
    this.stopped = false
  }

  observe(observation: LoopObservation): LoopCheckResult {
    const warnings: LoopWarning[] = []
    let stopReason: LoopStopReason | undefined

    // --- Repeated actions over a sliding window -------------------------------
    for (const signature of observation.signatures) {
      this.window.push(signature)
      if (this.window.length > this.policy.windowSize) this.window.shift()

      const count = (this.counts.get(signature) ?? 0) + 1
      this.counts.set(signature, count)
      if (count > this.policy.repeatedActionThreshold && !this.warnedSignatures.has(signature)) {
        this.warnedSignatures.add(signature)
        warnings.push({
          kind: 'repeated_action',
          count,
          signature,
          message: `Action repeated ${count} times (threshold ${this.policy.repeatedActionThreshold})`
        })
      }
      if (count >= this.policy.repeatedStopThreshold) {
        // Stop is surfaced via LoopStopInfo; do not re-warn the same signature.
        stopReason ??= 'repeated_action'
      }
    }

    // --- Progress -------------------------------------------------------------
    if (observation.productive) {
      this.consecutiveNoProgress = 0
    } else {
      this.consecutiveNoProgress += 1
    }

    // --- Failure streak -------------------------------------------------------
    if ((observation.failures ?? 0) > 0) {
      this.consecutiveFailures += 1
    } else {
      this.consecutiveFailures = 0
    }
    if (this.consecutiveFailures >= this.policy.failureThreshold) {
      stopReason ??= 'failure_streak'
      warnings.push({
        kind: 'failure_streak',
        count: this.consecutiveFailures,
        message: `${this.consecutiveFailures} consecutive steps with failing actions`
      })
    }

    // --- Reasoning loop -------------------------------------------------------
    const newAction = observation.newAction ?? observation.productive
    if (observation.reasoningSignature && !newAction) {
      if (observation.reasoningSignature === this.lastReasoning) {
        this.reasoningStreak += 1
      } else {
        this.lastReasoning = observation.reasoningSignature
        this.reasoningStreak = 1
      }
      if (this.reasoningStreak >= this.policy.reasoningThreshold) {
        stopReason ??= 'reasoning_loop'
        warnings.push({
          kind: 'reasoning_loop',
          count: this.reasoningStreak,
          message: `Same reasoning repeated ${this.reasoningStreak} times without a new action`
        })
      }
    } else {
      this.reasoningStreak = 0
      this.lastReasoning = null
    }

    // --- No progress: pause and ask the user ----------------------------------
    let shouldAskUser = false
    if (this.consecutiveNoProgress > this.policy.noProgressThreshold) {
      shouldAskUser = true
      warnings.push({
        kind: 'no_progress',
        count: this.consecutiveNoProgress,
        message: `${this.consecutiveNoProgress} consecutive steps with no progress`
      })
    }

    if (stopReason) {
      this.stopped = true
      this.stopReason = stopReason
    }

    return {
      warnings,
      ...(warnings.length > 0 ? { hint: buildHint(warnings) } : {}),
      shouldAskUser,
      stop: this.stopped,
      ...(this.stopReason ? { stopReason: this.stopReason } : {})
    }
  }
}
