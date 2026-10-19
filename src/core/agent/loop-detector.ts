import type {
  LoopDetectionPolicy,
  LoopStopReason,
  LoopWarning
} from '@shared/agent'
import { DEFAULT_LOOP_POLICY } from '@shared/agent'
import { stableStringify } from './tools'
import type { StrategyAlternative } from './strategies'
import type { StepInformation } from './step-information'

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
  /**
   * Whether the step was answered with a redirect (a suggested alternative).
   * v2.5.7: a redirect is a recovery step, so it must not itself trip the
   * failure-streak stop before the model can act on the suggestion.
   */
  redirected?: boolean
  /**
   * X5: what the step learned, when its actions were read-only probes. Present, a probing step is
   * judged by whether it added a lesson or changed a probe's answer — running a command and getting
   * output is activity, and progress is new information about the task.
   */
  information?: StepInformation
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
  /**
   * X5: present when the run stopped because two steps in a row added no information. Says what it
   * was doing and what it had already ruled out, so the stop can explain itself instead of leaving
   * the user with "it got stuck".
   */
  noInformation?: { activity: string; ruledOut: string[] }
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
   * `redirect` — the call keeps failing; suggest a concrete alternative instead
   * of stopping (v2.5.7).
   */
  action?: 'warn' | 'stop' | 'block' | 'redirect'
  toolName?: string
  /** How many times this call identity appears in the current window. */
  count?: number
  /** Farsi, user-facing explanation when a stop fires. */
  message?: string
  /** Concrete alternative the user/model can run instead (v2.5.7). */
  alternative?: StrategyAlternative
}

export interface LoopDetectorOptions {
  /** Injectable clock so timeout behaviour is testable. */
  now?: () => number
  /**
   * v2.5.7: map a failing call to a concrete alternative. When provided, a loop
   * or a repeatedly-blocked target is answered with `action: 'redirect'` (carrying
   * the alternative) instead of a hard stop, so the run can recover.
   */
  findAlternative?: (
    toolName: string,
    args: Record<string, unknown>,
    error: string
  ) => StrategyAlternative | null
}

/**
 * Sliding-window budget for the per-call guard. These are the exact thresholds
 * from Sprint v2.3.1: warn on the 3rd repeat, stop on the 5th, stop after 3
 * consecutive failures, and stop after 2 minutes without progress.
 */
const WARN_THRESHOLD = 3
const STOP_THRESHOLD = 5
const FAIL_THRESHOLD = 3
const GUARD_WINDOW_SIZE = 15
const PROGRESS_TIMEOUT_MS = 120_000
/** A.3: consecutive failures of one tool before it is taken out of rotation. */
const BLOCKED_TOOL_THRESHOLD = 2
/**
 * X5: consecutive steps without new information before the run stops.
 *
 * Two, not five: the old policy waited five steps and called it "no progress", which a run that
 * keeps *doing* things can never satisfy — every step was `productive`, so the counter never moved
 * and the guard never fired. The session log in this item spent 69.3s on two probes that answered
 * nothing and kept going. A step that adds no information is evidence the run has lost its thread,
 * and one step can still be an unlucky guess; two in a row is a drift.
 */
const NO_INFORMATION_STOP = 2
/** How many already-answered probes a stop reports. */
const RULED_OUT_LIMIT = 8

/**
 * Tools whose identity is the command they run. Two `run_command` calls are only
 * "the same call" when the command matches — `pwd`, `ls` and `cat` are three
 * different pieces of work, not a loop.
 */
const GENERAL_PURPOSE_TOOLS = new Set(['run_command', 'remote_shell', 'shell_exec'])
/** Tools whose identity is the path they target. */
const PATH_BASED_TOOLS = new Set([
  'read_file',
  'write_file',
  'list_dir',
  'remote_read_file',
  'remote_write_file',
  'remote_list_dir',
  'exists'
])
const COMMAND_ARG_KEYS = ['command', 'cmd', 'script']
const PATH_ARG_KEYS = ['path', 'file', 'filepath', 'dir', 'directory']

function blockedThreshold(): number {
  return BLOCKED_TOOL_THRESHOLD
}

function asRecord(args: unknown): Record<string, unknown> {
  return args && typeof args === 'object' && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : {}
}

function firstString(args: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string') return value
  }
  return ''
}

/** Collapse insignificant whitespace so `git  status` and `git status` match. */
function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ')
}

/** Normalise separators so `./src/app/` and `src\\app` compare equal. */
function normalizePath(path: string): string {
  const normalized = path
    .trim()
    .replace(/\\/g, '/')
    .replace(/^(\.\/)+/, '')
    .replace(/\/+$/, '')
  return normalized === '' ? '.' : normalized
}

/**
 * Identity of a tool call for the per-call guard. Grouping purely by tool *name*
 * over-fires on general-purpose tools: a script of `remote_shell(pwd)` followed
 * by `remote_shell(ls)` and `remote_shell(cat)` is legitimate exploration, yet
 * the old name-only count treated it as a loop.
 *
 * The key therefore carries the arguments that actually distinguish one call
 * from the next — the command for shell tools, the path for filesystem tools,
 * and the full (stably serialised) arguments for everything else. Repeated
 * *identical* calls still collide and hit the warn/stop thresholds, so genuine
 * loops remain caught.
 */
export function computeLoopHash(toolName: string, args: unknown): string {
  const record = asRecord(args)
  if (GENERAL_PURPOSE_TOOLS.has(toolName)) {
    return `${toolName}:${normalizeCommand(firstString(record, COMMAND_ARG_KEYS))}`
  }
  if (PATH_BASED_TOOLS.has(toolName)) {
    return `${toolName}:${normalizePath(firstString(record, PATH_ARG_KEYS))}`
  }
  return `${toolName}:${stableStringify(record)}`
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
 *  1. A **per-tool-call** sliding window (Sprint v2.3.1, refined in v2.4.2) keyed
 *     on the *call identity* — for shell tools this is the normalised command,
 *     for filesystem tools the path, otherwise the full arguments. Repeated
 *     `remote_shell` calls with different commands are therefore not a loop,
 *     while genuinely identical calls still are
 *     (`beforeToolCall` / `afterToolCall` / `markProgress`).
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
  // --- X5: information, not activity -----------------------------------------
  /** Every lesson the run has been taught, so the same one twice cannot pass for progress. */
  private readonly seenLessons = new Set<string>()
  /** Probes the run has run, and every answer each has given (a change is information). */
  private readonly seenProbeDigests = new Map<string, Set<string>>()
  private noInformationStreak = 0
  /** True once the run recorded a failure: until then it is exploring, not drifting (X5). */
  private sawFailure = false

  // --- Per-tool-call state (beforeToolCall / afterToolCall) -----------------
  private readonly now: () => number
  private readonly recentCallKeys: string[] = []
  private readonly warnedCallKeys = new Set<string>()
  private readonly recentCalls: RecentToolCall[] = []
  private toolFailureStreak = 0
  private lastProgressAt: number
  private guardStopReason: LoopStopReason | undefined
  private guardStopped = false
  // A.3: a tool that fails twice in this session is taken out of rotation so the
  // model stops retrying it and reaches for an alternative instead.
  private readonly toolFailureCount = new Map<string, number>()
  private readonly blockedTools = new Set<string>()
  // Fix 5: paths/commands policy refused this run. Re-asking for the same target
  // can only be refused again, so the model is steered to a different approach
  // instead of burning a step on a guaranteed failure.
  private readonly blockedPaths = new Set<string>()
  private readonly blockedCommands = new Set<string>()
  // v2.5.7: loop recovery. The last failure text feeds the alternative lookup,
  // and a call key that was already redirected once stops on the next repeat.
  private readonly findAlternative?: (
    toolName: string,
    args: Record<string, unknown>,
    error: string
  ) => StrategyAlternative | null
  private readonly redirectedCallKeys = new Set<string>()
  private lastError = ''

  constructor(policy: Partial<LoopDetectionPolicy> = {}, options: LoopDetectorOptions = {}) {
    this.policy = { ...DEFAULT_LOOP_POLICY, ...policy }
    this.now = options.now ?? (() => Date.now())
    this.lastProgressAt = this.now()
    this.findAlternative = options.findAlternative
  }

  get noProgressSteps(): number {
    return this.consecutiveNoProgress
  }

  /** X5: consecutive steps that added no new information (the drift guard's counter). */
  get noInformationSteps(): number {
    return this.noInformationStreak
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

  /**
   * Tools taken out of rotation after repeated failures (A.3).
   *
   * v2.8.0: the block is per call, so this reports the tool names of the blocked
   * calls (the call hash is `${toolName}:${arguments}`) rather than a tool that is
   * switched off entirely.
   */
  get blockedToolNames(): string[] {
    return [...new Set([...this.blockedTools].map((callKey) => callKey.split(':')[0] ?? callKey))]
  }

  /** Paths policy refused this run, retries of which are now skipped (Fix 5). */
  get blockedPathNames(): string[] {
    return [...this.blockedPaths]
  }

  /** Commands policy refused this run, retries of which are now skipped (Fix 5). */
  get blockedCommandNames(): string[] {
    return [...this.blockedCommands]
  }

  /** The normalised path a call targets, or '' when it targets none. */
  private callPath(args: unknown): string {
    const path = normalizePath(firstString(asRecord(args), PATH_ARG_KEYS))
    return path === '.' ? '' : path
  }

  /** The normalised command a call runs, or '' when it runs none. */
  private callCommand(args: unknown): string {
    return normalizeCommand(firstString(asRecord(args), COMMAND_ARG_KEYS))
  }

  /** B-5: occurrences of `signature` in the current window (not the whole run). */
  signatureCount(signature: string): number {
    return this.counts.get(signature) ?? 0
  }

  /** A concrete alternative for a failing call, or `null` (v2.5.7). */
  private alternativeFor(toolName: string, args: unknown): StrategyAlternative | null {
    if (!this.findAlternative) return null
    return this.findAlternative(toolName, asRecord(args), this.lastError)
  }

  /**
   * Decide what to do with a call that is already refused (blocked path/command
   * or a repeatedly-failing tool). With a known alternative, redirect once; if
   * the same call is repeated anyway, stop. Otherwise keep the historical block.
   */
  private blockedDecision(
    toolName: string,
    args: unknown,
    callKey: string,
    reason: string,
    count?: number
  ): LoopCallDecision {
    const alternative = this.alternativeFor(toolName, args)
    if (alternative && !this.redirectedCallKeys.has(callKey)) {
      this.redirectedCallKeys.add(callKey)
      // The alternative may reuse the same tool with different arguments, so lift
      // this call's failure block for the retry (v2.8.0: per call, not per tool).
      this.blockedTools.delete(callKey)
      this.toolFailureCount.delete(callKey)
      this.toolFailureStreak = 0
      return {
        allow: false,
        action: 'redirect',
        toolName,
        reason,
        alternative,
        ...(count !== undefined ? { count } : {})
      }
    }
    if (alternative) {
      // The model ignored the suggestion and repeated the failing call.
      this.guardStopped = true
      this.guardStopReason = 'repeated_action'
      return {
        allow: false,
        action: 'stop',
        reason: 'repeated_action',
        toolName,
        message: loopStopMessage(toolName, count ?? 0),
        ...(count !== undefined ? { count } : {})
      }
    }
    return { allow: false, action: 'block', toolName, reason, ...(count !== undefined ? { count } : {}) }
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
    // X5: a fresh start is a fresh run of evidence; the answers it already has are gone with it.
    this.seenLessons.clear()
    this.seenProbeDigests.clear()
    this.noInformationStreak = 0
    this.sawFailure = false
    // Per-tool-call
    this.recentCallKeys.length = 0
    this.warnedCallKeys.clear()
    this.recentCalls.length = 0
    this.toolFailureStreak = 0
    this.lastProgressAt = this.now()
    this.guardStopReason = undefined
    this.guardStopped = false
    this.toolFailureCount.clear()
    this.blockedTools.clear()
    this.blockedPaths.clear()
    this.blockedCommands.clear()
    this.redirectedCallKeys.clear()
    this.lastError = ''
  }

  // ---------------------------------------------------------------------------
  // Per-tool-call guard (Sprint v2.3.1)
  // ---------------------------------------------------------------------------

  /**
   * Decide whether the next tool call may run. Pushes the call onto the sliding
   * window first, then evaluates: no-progress timeout, repeated call identity
   * (warn at 3 / stop at 5), and consecutive-failure stop.
   */
  beforeToolCall(toolName: string, args: unknown): LoopCallDecision {
    const callKey = computeLoopHash(toolName, args)

    // v2.5.7: this exact call was already redirected once. If the model repeats
    // it verbatim instead of trying the suggested alternative, stop for good.
    if (this.redirectedCallKeys.has(callKey) && this.alternativeFor(toolName, args)) {
      this.guardStopped = true
      this.guardStopReason = 'repeated_action'
      return {
        allow: false,
        action: 'stop',
        reason: 'repeated_action',
        toolName,
        message: loopStopMessage(toolName, 0)
      }
    }

    // Fix 5: policy already refused this exact path/command earlier in the run, so
    // skip just this call (not the whole run) and tell the model to change tack.
    const targetPath = this.callPath(args)
    if (targetPath && this.blockedPaths.has(targetPath)) {
      return this.blockedDecision(
        toolName,
        args,
        callKey,
        `Path "${targetPath}" was blocked before. Try a different approach or ask the user ` +
          'to enable Diagnostic Mode.'
      )
    }
    const command = this.callCommand(args)
    if (command && this.blockedCommands.has(command)) {
      return this.blockedDecision(
        toolName,
        args,
        callKey,
        `Command "${command}" was blocked before. Try an alternative.`
      )
    }

    this.recentCallKeys.push(callKey)
    if (this.recentCallKeys.length > GUARD_WINDOW_SIZE) this.recentCallKeys.shift()

    const count = this.recentCallKeys.filter((key) => key === callKey).length

    // A.3: a call that already failed twice is skipped, not fatal — the model is
    // told to try something else and the run continues.
    //
    // v2.8.0: keyed on the *call hash*, not the tool name. Two failures of
    // `run_command` with two different commands used to blacklist `run_command`
    // for the rest of the run, and because a blocked call never executes it could
    // never succeed — so the block could never be lifted. The failure is a
    // property of the call, not of the tool.
    if (this.blockedTools.has(callKey)) {
      return this.blockedDecision(
        toolName,
        args,
        callKey,
        `This exact ${toolName} call failed ${blockedThreshold()} times in this session. ` +
          'Change the arguments or use another tool.',
        count
      )
    }

    if (this.guardStopped) {
      const reason = this.guardStopReason ?? 'repeated_action'
      // v2.5.7: a recoverable guard stop (not a turn timeout) redirects once to a
      // concrete alternative, then resumes; a second repeat stops for good.
      if (reason !== 'turn_timeout') {
        const alternative = this.alternativeFor(toolName, args)
        if (alternative && !this.redirectedCallKeys.has(callKey)) {
          this.redirectedCallKeys.add(callKey)
          this.guardStopped = false
          this.guardStopReason = undefined
          this.toolFailureStreak = 0
          return { allow: false, action: 'redirect', reason, toolName, count, alternative }
        }
      }
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
      // v2.5.7: if we know a concrete alternative, redirect instead of stopping —
      // but only once per call identity, so a model that ignores the hint stops.
      const alternative = this.alternativeFor(toolName, args)
      if (alternative && !this.redirectedCallKeys.has(callKey)) {
        this.redirectedCallKeys.add(callKey)
        return {
          allow: false,
          action: 'redirect',
          reason: loopStopMessage(toolName, count),
          toolName,
          count,
          alternative
        }
      }
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
    if (count >= WARN_THRESHOLD && !this.warnedCallKeys.has(callKey)) {
      this.warnedCallKeys.add(callKey)
      decision.action = 'warn'
      decision.reason =
        `Tool "${toolName}" called ${count} times in the last ${GUARD_WINDOW_SIZE} calls ` +
        'with the same arguments. Repeating it is unlikely to help.'
      decision.message = `⚠️ هشدار حلقه: ${toolName} ${count} بار تکرار شد.`
    }
    return decision
  }

  /** Record the outcome of the tool call just executed. */
  afterToolCall(
    toolName: string,
    result: { ok: boolean; blocked?: boolean; error?: string },
    args?: unknown
  ): void {
    // v2.8.0: failures are tracked per *call* (tool + arguments), not per tool, so a
    // tool that failed on one command is not blacklisted for every other command.
    const callKey = computeLoopHash(toolName, args)
    this.recentCalls.push({ toolName, ok: result.ok, at: this.now() })
    if (this.recentCalls.length > GUARD_WINDOW_SIZE) this.recentCalls.shift()

    // Remember the failure text so the next `beforeToolCall` can pick an
    // alternative strategy (v2.5.7).
    this.lastError = result.ok ? '' : (result.error ?? '')

    if (result.ok) {
      this.toolFailureStreak = 0
      // A success proves this call works, so forget its earlier failures.
      this.toolFailureCount.delete(callKey)
      this.blockedTools.delete(callKey)
    } else if (result.blocked === true) {
      // A policy refusal is not a broken tool: remember the refused target so the
      // model does not retry it (Fix 5), but do not count it toward the failure
      // streak or remove the tool from rotation.
      const path = this.callPath(args)
      if (path) this.blockedPaths.add(path)
      const command = this.callCommand(args)
      if (command) this.blockedCommands.add(command)
    } else {
      this.toolFailureStreak += 1
      const failures = (this.toolFailureCount.get(callKey) ?? 0) + 1
      this.toolFailureCount.set(callKey, failures)
      if (failures >= blockedThreshold()) this.blockedTools.add(callKey)
      if (this.toolFailureStreak >= FAIL_THRESHOLD) {
        this.guardStopped = true
        this.guardStopReason = 'failure_streak'
      }
    }
  }

  /**
   * Real progress happened (a file was written, tests passed, ...). Clears the
   * repeat window, the failure streak and the no-progress timer so the model
   * gets a fresh budget.
   *
   * Note (B-5): only the *per-call* guard's budget is refreshed here. The
   * step-level analyzer stays window-bounded instead, because a successful action
   * that keeps repeating is still a loop: a run that repeats the same successful
   * command five times must keep surfacing `repeated_action`.
   */
  markProgress(): void {
    this.lastProgressAt = this.now()
    this.toolFailureStreak = 0
    this.recentCallKeys.length = 0
    this.warnedCallKeys.clear()
    this.guardStopped = false
    this.guardStopReason = undefined
    // v2.8.0: real progress restores the budget for calls that failed earlier. The
    // per-call block used to be permanent for the whole run and could never be
    // lifted (a blocked call never executes, so it can never succeed), which is
    // what wedged runs that had already started making progress again.
    this.toolFailureCount.clear()
    this.blockedTools.clear()
  }

  // ---------------------------------------------------------------------------
  // Per-step analyzer (shared with the orchestrator)
  // ---------------------------------------------------------------------------

  observe(observation: LoopObservation): LoopCheckResult {
    const warnings: LoopWarning[] = []
    let stopReason: LoopStopReason | undefined

    // --- Repeated actions over a sliding window -------------------------------
    // B-5: the counters are *derived from* the window. They used to be cumulative
    // for the whole run — `this.window` was dead code — so five legitimate
    // re-reads of the same file spread over a long run stopped it, and
    // `markProgress()` had no effect on this layer at all.
    for (const signature of observation.signatures) {
      this.window.push(signature)
      while (this.window.length > this.policy.windowSize) {
        const evicted = this.window.shift()
        if (evicted === undefined) break
        const remaining = (this.counts.get(evicted) ?? 0) - 1
        if (remaining > 0) {
          this.counts.set(evicted, remaining)
        } else {
          this.counts.delete(evicted)
          // A signature that has left the window entirely may warn again if it
          // comes back: the earlier repeat burst is over.
          this.warnedSignatures.delete(evicted)
        }
      }

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
    if (observation.redirected) {
      // v2.5.7: a redirect is a deliberate change of approach, so it is neutral
      // and must not count toward the no-progress or failure-streak stops.
      this.consecutiveNoProgress = 0
      this.consecutiveFailures = 0
    } else {
      if (observation.productive) {
        this.consecutiveNoProgress = 0
      } else {
        this.consecutiveNoProgress += 1
      }

      // --- Failure streak -----------------------------------------------------
      // A step is only a *failure* step when it made no progress. `failures`
      // counts every `!ok` observation, so a red test plus a successful edit was
      // scored as a failure — and red→edit→red→edit→red, which is just ordinary
      // debugging (or TDD), stopped the run after three steps. The policy's own
      // doc says "steps whose actions all failed"; this now matches it.
      if (observation.productive) {
        this.consecutiveFailures = 0
      } else if ((observation.failures ?? 0) > 0) {
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
    }

    // --- X5: information, not activity ----------------------------------------
    //
    // `productive` answers "did a new action succeed", which a run that keeps doing *something* can
    // satisfy forever — that is why the 27.8s `ip -6 addr` and the 41.5s project-wide `grep` were
    // both progress and no guard fired. This counter answers the question the user was asking: did
    // the run learn anything it did not already know?
    //
    // It is a *separate* counter on purpose. The two contracts that already exist — warn on >2 of
    // one signature, stop on the 5th, and stop after 3 consecutive failing steps — are decided
    // above, unchanged; this rule only decides whether a step made of read-only probes counts as
    // progress. Two such steps in a row that taught nothing is drift, and it stops there rather
    // than waiting for five — but only once the run has a failure to explain. A run with no failure
    // evidence is exploring, not drifting, and the older no-progress ask remains its backstop.
    let noInformation: LoopCheckResult['noInformation']
    if ((observation.failures ?? 0) > 0) this.sawFailure = true
    if (observation.redirected) {
      this.noInformationStreak = 0
    } else {
      const learned = this.informationGained(observation)
      if (learned === undefined) {
        // A step that is not a read-only probe (a write, a file read, a plan decision): the
        // existing rules own it, and this guard does not count it either way.
      } else if (learned) {
        this.noInformationStreak = 0
      } else {
        this.noInformationStreak += 1
      }
      if (this.sawFailure && this.noInformationStreak >= NO_INFORMATION_STOP) {
        stopReason ??= 'no_progress'
        noInformation = this.driftSummary(observation.information)
        warnings.push({
          kind: 'no_progress',
          count: this.noInformationStreak,
          message:
            `${this.noInformationStreak} consecutive steps added no new information ` +
            `(doing: ${noInformation.activity})`
        })
      }
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
      ...(this.stopReason ? { stopReason: this.stopReason } : {}),
      ...(noInformation ? { noInformation } : {})
    }
  }

  /**
   * Did this probing step teach the run anything? (X5)
   *
   * `true` — it added a lesson the run had not been taught, or a probe answered differently than it
   * did before. `false` — it repeated what the run already knew. `undefined` — the step is not made
   * purely of read-only probes (or the caller did not describe what it learned), so this guard does
   * not judge it and the existing progress rules keep deciding.
   *
   * Lessons and probe answers are learnt from *every* step, because a step that is not purely a
   * probe can still settle a question, and a later probe repeating it must not look new.
   */
  private informationGained(observation: LoopObservation): boolean | undefined {
    const information = observation.information
    if (!information) return undefined

    let fresh = false
    for (const lesson of information.lessons) {
      if (this.seenLessons.has(lesson)) continue
      this.seenLessons.add(lesson)
      fresh = true
    }
    for (const probe of information.probes) {
      const answers = this.seenProbeDigests.get(probe.signature)
      if (!answers) {
        this.seenProbeDigests.set(probe.signature, new Set([probe.digest]))
        continue
      }
      // The same command answering differently is the one way a repeat can teach something.
      if (!answers.has(probe.digest)) {
        answers.add(probe.digest)
        fresh = true
      }
    }

    // Work that is not a read-only probe is measured by the old rules, not by this one.
    return information.probeOnly ? fresh : undefined
  }

  /** What the run was doing and what it has already ruled out, for a drift stop (X5). */
  private driftSummary(information?: StepInformation): { activity: string; ruledOut: string[] } {
    const doing = information?.probes.map((probe) => probe.signature) ?? []
    const ruledOut = [...this.seenProbeDigests.keys()]
    return {
      activity: doing.length > 0 ? doing.join(', ') : 'the same action',
      ruledOut: ruledOut.slice(Math.max(0, ruledOut.length - RULED_OUT_LIMIT))
    }
  }
}
