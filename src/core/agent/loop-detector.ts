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

/** One executed tool call, kept so a STOP can show a short recent history. */
export interface RecentToolCall {
  toolName: string
  ok: boolean
  at: number
}

/**
 * The verdict of {@link LoopDetector.beforeToolCall}: whether the next tool call
 * may run, and — when it may not — why.
 */
export interface LoopCallDecision {
  allow: boolean
  reason?: string
  /**
   * `warn` — allow but advise. `stop` — end the run (a hard loop condition).
   * `block` — skip this one action and let the model try something else
   * (a tool that has failed repeatedly in this session, A.3).
   */
  action?: 'warn' | 'stop' | 'block'
  toolName?: string
  /** How many times this tool name appears in the current window. */
  count?: number
  /** Farsi, user-facing explanation when a stop fires. */
  message?: string
}

export interface LoopDetectorOptions {
  /** Injectable clock so timeout behaviour is testable. */
  now?: () => number
}

/**
 * Sliding-window budget for the fuzzy (per-tool-name) guard. These are the exact
 * thresholds from Sprint v2.3.1: warn on the 3rd repeat, stop on the 5th, stop
 * after 3 consecutive failures, and stop after 2 minutes without progress.
 */
const WARN_THRESHOLD = 3
const STOP_THRESHOLD = 5
const FAIL_THRESHOLD = 3
const GUARD_WINDOW_SIZE = 15
const PROGRESS_TIMEOUT_MS = 120_000
/** A.3: consecutive failures of one tool before it is taken out of rotation. */
const BLOCKED_TOOL_THRESHOLD = 2

function blockedThreshold(): number {
  return BLOCKED_TOOL_THRESHOLD
}

function hashCall(toolName: string, args: unknown): string {
  let serialized: string
  try {
    serialized = JSON.stringify(args) ?? 'undefined'
  } catch {
    serialized = String(args)
  }
  return `${toolName}:${serialized}`
}

/** The Farsi stop message shown in the chat when a loop is detected. */
export function loopStopMessage(toolName: string, count: number): string {
  return `⚠️ تشخیص حلقه. ${count} بار تلاش تکراری برای ${toolName}. متوقف کردم.`
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
 * Detects unproductive cycles. Two layers share one instance:
 *
 *  1. A **per-tool-call** sliding window (Sprint v2.3.1) keyed on the tool
 *     *name* — so repeated `remote_shell` calls are caught even when the
 *     arguments change every time (`beforeToolCall` / `afterToolCall` /
 *     `markProgress`).
 *  2. A **per-step** analyzer (`observe`) that also spots failure streaks,
 *     repeated reasoning, and steps that make no progress.
 *
 * Severity is layered: a repeat first produces a WARN (so the model can
 * self-correct), then a STOP once a hard threshold is crossed. Any STOP reason
 * surfaces via {@link LoopCheckResult.stop} / {@link LoopCallDecision.allow}
 * so the orchestrator can hand control back to the user.
 */
export class LoopDetector {
  // --- Step-level state (observe) -------------------------------------------
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

  // --- Per-tool-call state (beforeToolCall / afterToolCall) -----------------
  private readonly now: () => number
  private readonly recentToolNames: string[] = []
  private readonly recentToolHashes: string[] = []
  private readonly warnedToolNames = new Set<string>()
  private readonly recentCalls: RecentToolCall[] = []
  private toolFailureStreak = 0
  private lastProgressAt: number
  private guardStopReason: LoopStopReason | undefined
  private guardStopped = false
  // A.3: a tool that fails twice in this session is taken out of rotation so the
  // model stops retrying it and reaches for an alternative instead.
  private readonly toolFailureCount = new Map<string, number>()
  private readonly blockedTools = new Set<string>()

  constructor(policy: Partial<LoopDetectionPolicy> = {}, options: LoopDetectorOptions = {}) {
    this.policy = { ...DEFAULT_LOOP_POLICY, ...policy }
    this.now = options.now ?? (() => Date.now())
    this.lastProgressAt = this.now()
  }

  get noProgressSteps(): number {
    return this.consecutiveNoProgress
  }

  get windowSize(): number {
    return this.window.length
  }

  /** True once a hard stop condition has fired for this run. */
  get isStopped(): boolean {
    return this.stopped || this.guardStopped
  }

  /** Why the run stopped (either layer), when it did. */
  get stoppedReason(): LoopStopReason | undefined {
    return this.guardStopReason ?? this.stopReason
  }

  /** The most recent executed tool calls (newest last), for the STOP summary. */
  get toolCallHistory(): RecentToolCall[] {
    return [...this.recentCalls]
  }

  /** Tools taken out of rotation after repeated failures (A.3). */
  get blockedToolNames(): string[] {
    return [...this.blockedTools]
  }

  signatureCount(signature: string): number {
    return this.counts.get(signature) ?? 0
  }

  reset(): void {
    // Step-level
    this.counts.clear()
    this.warnedSignatures.clear()
    this.window.length = 0
    this.consecutiveNoProgress = 0
    this.consecutiveFailures = 0
    this.reasoningStreak = 0
    this.lastReasoning = null
    this.stopReason = undefined
    this.stopped = false
    // Per-tool-call
    this.recentToolNames.length = 0
    this.recentToolHashes.length = 0
    this.warnedToolNames.clear()
    this.recentCalls.length = 0
    this.toolFailureStreak = 0
    this.lastProgressAt = this.now()
    this.guardStopReason = undefined
    this.guardStopped = false
    this.toolFailureCount.clear()
    this.blockedTools.clear()
  }

  // ---------------------------------------------------------------------------
  // Per-tool-call guard (Sprint v2.3.1)
  // ---------------------------------------------------------------------------

  /**
   * Decide whether the next tool call may run. Pushes the call onto the sliding
   * window first, then evaluates: no-progress timeout, tool-name repeat
   * (warn at 3 / stop at 5), and consecutive-failure stop.
   */
  beforeToolCall(toolName: string, args: unknown): LoopCallDecision {
    this.recentToolNames.push(toolName)
    this.recentToolHashes.push(hashCall(toolName, args))
    if (this.recentToolNames.length > GUARD_WINDOW_SIZE) this.recentToolNames.shift()
    if (this.recentToolHashes.length > GUARD_WINDOW_SIZE) this.recentToolHashes.shift()

    const count = this.recentToolNames.filter((name) => name === toolName).length

    // A.3: a tool that already failed twice is skipped, not fatal — the model is
    // told to use an alternative and the run continues.
    if (this.blockedTools.has(toolName)) {
      return {
        allow: false,
        action: 'block',
        reason:
          `Tool "${toolName}" failed ${blockedThreshold()} times in this session. ` +
          'Use an alternative tool instead.',
        toolName,
        count
      }
    }

    if (this.guardStopped) {
      const reason = this.guardStopReason ?? 'repeated_action'
      return {
        allow: false,
        action: 'stop',
        reason,
        toolName,
        count,
        ...(reason === 'repeated_action' ? { message: loopStopMessage(toolName, count) } : {})
      }
    }

    if (this.now() - this.lastProgressAt > PROGRESS_TIMEOUT_MS) {
      this.guardStopped = true
      this.guardStopReason = 'turn_timeout'
      return {
        allow: false,
        action: 'stop',
        reason: 'turn_timeout',
        toolName,
        count,
        message: '⚠️ تشخیص حلقه. ۲ دقیقه بدون پیشرفت. متوقف کردم.'
      }
    }

    if (this.toolFailureStreak >= FAIL_THRESHOLD) {
      this.guardStopped = true
      this.guardStopReason = 'failure_streak'
      return {
        allow: false,
        action: 'stop',
        reason: 'failure_streak',
        toolName,
        count,
        message: `⚠️ تشخیص حلقه. ${this.toolFailureStreak} خطای متوالی در ${toolName}. متوقف کردم.`
      }
    }

    if (count >= STOP_THRESHOLD) {
      this.guardStopped = true
      this.guardStopReason = 'repeated_action'
      return {
        allow: false,
        action: 'stop',
        reason: 'repeated_action',
        toolName,
        count,
        message: loopStopMessage(toolName, count)
      }
    }

    const decision: LoopCallDecision = { allow: true, toolName, count }
    if (count >= WARN_THRESHOLD && !this.warnedToolNames.has(toolName)) {
      this.warnedToolNames.add(toolName)
      decision.action = 'warn'
      decision.reason =
        `Tool "${toolName}" called ${count} times in the last ${GUARD_WINDOW_SIZE} calls ` +
        'with different arguments. Repeating it is unlikely to help.'
      decision.message = `⚠️ هشدار حلقه: ${toolName} ${count} بار تکرار شد.`
    }
    return decision
  }

  /** Record the outcome of the tool call just executed. */
  afterToolCall(toolName: string, result: { ok: boolean }): void {
    this.recentCalls.push({ toolName, ok: result.ok, at: this.now() })
    if (this.recentCalls.length > GUARD_WINDOW_SIZE) this.recentCalls.shift()

    if (result.ok) {
      this.toolFailureStreak = 0
      // A success proves the tool works again, so forget its earlier failures.
      this.toolFailureCount.delete(toolName)
      this.blockedTools.delete(toolName)
    } else {
      this.toolFailureStreak += 1
      const failures = (this.toolFailureCount.get(toolName) ?? 0) + 1
      this.toolFailureCount.set(toolName, failures)
      if (failures >= blockedThreshold()) this.blockedTools.add(toolName)
      if (this.toolFailureStreak >= FAIL_THRESHOLD) {
        this.guardStopped = true
        this.guardStopReason = 'failure_streak'
      }
    }
  }

  /**
   * Real progress happened (a file was written, tests passed, ...). Clears the
   * fuzzy window, the failure streak and the no-progress timer so the model
   * gets a fresh budget.
   */
  markProgress(): void {
    this.lastProgressAt = this.now()
    this.toolFailureStreak = 0
    this.recentToolNames.length = 0
    this.recentToolHashes.length = 0
    this.warnedToolNames.clear()
    this.guardStopped = false
    this.guardStopReason = undefined
  }

  // ---------------------------------------------------------------------------
  // Per-step analyzer (shared with the orchestrator)
  // ---------------------------------------------------------------------------

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
