import type { LoopDetectionPolicy, LoopWarning } from '@shared/agent'
import { DEFAULT_LOOP_POLICY } from '@shared/agent'

/** What one completed step tells the detector. */
export interface LoopObservation {
  /** Signatures of every action attempted in the step. */
  signatures: string[]
  /** Whether the step advanced the task (a new action succeeded). */
  productive: boolean
}

export interface LoopCheckResult {
  warnings: LoopWarning[]
  /** Guidance to inject into the model context, if any. */
  hint?: string
  /** True when the run should pause and ask the user for guidance. */
  shouldAskUser: boolean
}

function buildHint(warnings: LoopWarning[]): string {
  return warnings
    .map((warning) => {
      if (warning.kind === 'repeated_action') {
        return (
          `[loop-detected] You have repeated the same action ${warning.count} times ` +
          `(${warning.signature}). Repeating it again will not change the result. ` +
          'Change the arguments, use a different tool, or re-read the last observation.'
        )
      }
      return (
        `[loop-detected] ${warning.count} consecutive steps produced no progress. ` +
        'Stop repeating and explain what is blocking you, or try a fundamentally different approach.'
      )
    })
    .join('\n')
}

/**
 * Detects unproductive cycles:
 *  - the same action repeated more than `repeatedActionThreshold` times, and
 *  - more than `noProgressThreshold` consecutive steps that make no progress.
 * When the no-progress limit is exceeded the run should stop and ask the user.
 */
export class LoopDetector {
  private readonly counts = new Map<string, number>()
  private readonly warnedSignatures = new Set<string>()
  private consecutiveNoProgress = 0
  private readonly policy: LoopDetectionPolicy

  constructor(policy: Partial<LoopDetectionPolicy> = {}) {
    this.policy = { ...DEFAULT_LOOP_POLICY, ...policy }
  }

  get noProgressSteps(): number {
    return this.consecutiveNoProgress
  }

  signatureCount(signature: string): number {
    return this.counts.get(signature) ?? 0
  }

  reset(): void {
    this.counts.clear()
    this.warnedSignatures.clear()
    this.consecutiveNoProgress = 0
  }

  observe(observation: LoopObservation): LoopCheckResult {
    const warnings: LoopWarning[] = []

    for (const signature of observation.signatures) {
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
    }

    if (observation.productive) {
      this.consecutiveNoProgress = 0
    } else {
      this.consecutiveNoProgress += 1
    }

    let shouldAskUser = false
    if (this.consecutiveNoProgress > this.policy.noProgressThreshold) {
      shouldAskUser = true
      warnings.push({
        kind: 'no_progress',
        count: this.consecutiveNoProgress,
        message: `${this.consecutiveNoProgress} consecutive steps with no progress`
      })
    }

    return {
      warnings,
      ...(warnings.length > 0 ? { hint: buildHint(warnings) } : {}),
      shouldAskUser
    }
  }
}
