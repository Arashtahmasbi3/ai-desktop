import type { CreateSandboxOptions, SandboxManager } from '@shared/sandbox'
import type { ChatMessage, ContentPart, ProviderId, ToolDefinition, Usage } from '@shared/types'
import type {
  AgentAction,
  AgentLogger,
  AgentPhase,
  AgentRunOptions,
  AgentRunResult,
  AgentStatus,
  AgentStep,
  AgentToolResult,
  LoopDetectionPolicy,
  LoopStopInfo,
  LoopWarning,
  ProviderEntry
} from '@shared/agent'
export type { ProviderEntry }
import type { AgentOrchestratorOptions, FileChange } from './agent/orchestrator-options'
export type { AgentOrchestratorOptions, FileChange } from './agent/orchestrator-options'
import type { ToolResultView } from '@shared/ui'
import type { ApprovalMode } from '@shared/approval'
import type { PreflightChoice } from '@shared/preflight'
import { PREFLIGHT_RETRY_DELAY_MS } from '@shared/preflight'
import { ContextManager, type ContextSummarizer } from './agent/context-manager'
import { compressMessage, type CompressOptions } from './agent/context-compressor'
import { ErrorRecovery } from './agent/error-recovery'
import { LoopDetector, type LoopCallDecision } from './agent/loop-detector'
import { findAlternatives } from './agent/strategies'
import { silentLogger } from './agent/logger'
import type { SessionStore } from './agent/session-store'
import { SANDBOX_TOOLS, SandboxToolExecutor, actionFromToolCall } from './agent/tools'
import { shouldPlan, type Plan, type PlanDecision, type PlanWarning } from './agent/plan-mode'
import type { RoutingDecision } from './agent/remote-routing'
import { routeAction } from './agent/action-routing'
import type { ToolExecutor, ToolExecOptions } from './agent/tools'
import type { PreflightResult, PreflightTier } from './agent/preflight'
import type { ToolCallRecord } from './agent/success-verifier'
import { ASK_USER_TOOL, type AgentQuestion, type AskUserAnswer } from './agent/question'
import { answerAskUser, applyLoopGuard } from './agent/action-guards'
import { buildTraceDecision } from './agent/trace-decision'
import { createAdapterSummarizer } from './agent/transcript'
export { createAdapterSummarizer }
import { buildRemoteGuidance, buildRunSystemPrompt, buildSystemPrompt } from './agent/system-prompt'
export { buildRemoteGuidance, buildSystemPrompt }
export type { RemotePromptContext, SystemPromptOptions } from './agent/system-prompt'
import type { RemotePromptContext } from './agent/system-prompt'
import { addUsage, defaultContextTokens } from './agent/step-metrics'
import { formatObservation, settlePendingToolCalls } from './agent/tool-results'
import { buildStopInfo, finishRun, turnIsOverdue, turnTimeoutWarning } from './agent/turn-outcome'
import { callLlm, type LlmCallDeps } from './agent/llm-call'
export type { LlmCallOutcome } from './agent/llm-call'
import { guardedExecute, snapshotBefore, type ExecutionDeps } from './agent/action-execution'
import { resolvePreflight, type PreflightDeps } from './agent/preflight-runner'
import { maybeCompact } from './agent/context-compaction'
import { persistRunSession, resumeSessionIntoContext } from './agent/run-session'
import { createRunSandbox } from './agent/run-bootstrap'
import {
  applyLoopVerdict,
  applyPlanGate,
  settleAnswerWithoutTools,
  summarizeStep
} from './agent/step-outcome'
import type { OrchestratorLog } from './agent/orchestrator-log'

const DEFAULT_MAX_STEPS = 12
// A single shell command may run for up to a minute; a whole turn for five.
const DEFAULT_COMMAND_TIMEOUT_MS = 60_000
const DEFAULT_TURN_TIMEOUT_MS = 5 * 60 * 1000

/**
 * Orchestrates the Planning -> Execution -> Observation -> Reflection loop:
 * asks the LLM what to do, runs the requested tools in a sandbox, feeds the
 * observations back, detects loops and recovers from failures.
 *
 * F0-4: the cohesive halves of the loop live next door in `./agent/*` — the system
 * prompt (`system-prompt`), the transcript/summarizer (`transcript`), the idle clock
 * and stop report (`turn-outcome`), usage and productivity accounting
 * (`step-metrics`), the tool-result shapes (`tool-results`), the provider call
 * (`llm-call`), the preflight gate (`preflight-runner`), the per-action checks
 * (`action-guards`), routing (`action-routing`), tool execution
 * (`action-execution`), compaction (`context-compaction`), the session
 * (`run-session`), the sandbox (`run-bootstrap`), and the per-step decisions
 * (`step-outcome`). This class is the order they run in: same steps, same stop
 * reasons, same prompts.
 */
export class AgentOrchestrator {
  private readonly sandbox: SandboxManager
  private readonly providers: ProviderEntry[]
  private readonly logger: AgentLogger
  private readonly tools: ToolDefinition[]
  private readonly extraExecutor?: ToolExecutor
  private readonly extraToolNames: Set<string>
  private readonly systemHint?: string
  private readonly maxSteps: number
  private readonly contextMaxChars?: number
  private readonly commandTimeoutMs: number
  private readonly turnTimeoutMs: number
  private readonly loopPolicy: Partial<LoopDetectionPolicy>
  private readonly recovery: ErrorRecovery
  private readonly sandboxOptions: CreateSandboxOptions
  /** v2.9.0: staging hook and the first message's multimodal parts. */
  private readonly onSandboxReady?: (info: { id: string }) => Promise<void>
  private readonly initialUserParts?: ContentPart[]
  private readonly contextWindowTokens: number
  private readonly compactionThreshold: number
  private readonly compressContext: boolean
  private readonly compressOptions: CompressOptions
  private readonly summarizer?: ContextSummarizer
  private readonly sessionStore?: SessionStore
  private readonly sessionId?: string
  private readonly sessionMetadata?: () => Record<string, unknown> | undefined
  private readonly planMode: boolean
  private readonly goalId?: string
  private readonly approvalGate?: (action: AgentAction) => Promise<boolean>
  private readonly planGate?: (plan: Plan, warnings: PlanWarning[]) => Promise<PlanDecision>
  private readonly planApproval?: ApprovalMode
  private readonly toolRouting?: (
    toolName: string,
    args: Record<string, unknown>
  ) => RoutingDecision
  private readonly onFileWritten?: (change: FileChange) => void
  private readonly onToolResult?: (result: ToolResultView) => void
  private readonly preflightGate?: (action: AgentAction) => Promise<PreflightResult | undefined>
  private readonly preflightOverride?: (
    action: AgentAction,
    result: PreflightResult,
    tier: PreflightTier,
    context: { attempt: number }
  ) => Promise<PreflightChoice>
  private readonly preflightRetryDelayMs: number
  /** v2.8.0: mid-run questions. Absent means `ask_user` is not offered. */
  private readonly questionGate?: (
    question: AgentQuestion,
    context: { runId: string; step: number }
  ) => Promise<AskUserAnswer>
  private readonly enforceSuccessVerification: boolean
  private readonly diagnosticMode?: () => boolean
  private readonly remoteContext?: RemotePromptContext
  private readonly now: () => number
  private readonly runIdFactory: () => string
  private runCounter = 0

  constructor(options: AgentOrchestratorOptions) {
    if (options.providers.length === 0) {
      throw new Error('AgentOrchestrator requires at least one provider')
    }
    this.sandbox = options.sandbox
    this.providers = [...options.providers]
    this.logger = options.logger ?? silentLogger
    this.tools = [...(options.tools ?? SANDBOX_TOOLS), ...(options.extraTools ?? [])]
    if (options.toolPolicy) this.tools = this.tools.filter((tool) => options.toolPolicy!(tool.name))
    this.extraExecutor = options.extraExecutor
    this.extraToolNames = new Set(
      (options.extraTools ?? [])
        .map((tool) => tool.name)
        .filter((name) => (options.toolPolicy ? options.toolPolicy(name) : true))
    )
    this.systemHint = options.systemHint
    this.maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS
    this.contextMaxChars = options.contextMaxChars
    this.commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS
    this.turnTimeoutMs = options.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS
    this.loopPolicy = options.loopPolicy ?? {}
    this.recovery = new ErrorRecovery(options.recoveryPolicy)
    this.sandboxOptions = options.sandboxOptions ?? {}
    this.onSandboxReady = options.onSandboxReady
    this.initialUserParts = options.initialUserParts
    this.contextWindowTokens =
      options.contextWindowTokens ?? defaultContextTokens(this.providers[0])
    this.compactionThreshold = options.compactionThreshold ?? 0.8
    this.compressContext = options.compressContext ?? true
    this.compressOptions = options.compressOptions ?? {}
    this.summarizer = options.summarizer
    this.sessionStore = options.sessionStore
    this.sessionId = options.sessionId
    this.sessionMetadata = options.sessionMetadata
    this.planMode = options.planMode ?? false
    this.goalId = options.goalId
    this.approvalGate = options.approvalGate
    this.planGate = options.planGate
    this.planApproval = options.planApproval
    this.toolRouting = options.toolRouting
    this.onFileWritten = options.onFileWritten
    this.onToolResult = options.onToolResult
    this.preflightGate = options.preflightGate
    this.preflightOverride = options.preflightOverride
    this.questionGate = options.questionGate
    this.preflightRetryDelayMs = options.preflightRetryDelayMs ?? PREFLIGHT_RETRY_DELAY_MS
    this.enforceSuccessVerification = options.enforceSuccessVerification ?? false
    this.diagnosticMode = options.diagnosticMode
    this.remoteContext = options.remoteContext
    this.now = options.now ?? (() => Date.now())
    this.runCounter = 0
    this.runIdFactory = options.runIdFactory ?? (() => `run-${++this.runCounter}`)
  }

  /**
   * The structured log sink, as a value: the extracted modules are handed `this.log`
   * instead of the class, and the emitted record stays exactly what AgentLogger expects.
   */
  private readonly log: OrchestratorLog = (level, event, runId, extra = {}) => {
    this.logger.log({ ts: new Date(this.now()).toISOString(), level, event, runId, ...extra })
  }

  /**
   * v2.6.2 T3.1: derive one trace decision from a finished step and emit it on the
   * structured log stream as `event: 'decision'`. Deterministic — it reads what the
   * step already recorded, so no extra model call is made.
   */
  private emitDecision(runId: string, step: AgentStep): void {
    const decision = buildTraceDecision(step, {
      runId,
      ...(this.goalId ? { goalId: this.goalId } : {})
    })
    this.log('info', 'decision', runId, { step: step.index, decision })
  }

  async run(task: string, options: AgentRunOptions = {}): Promise<AgentRunResult> {
    const runId = this.runIdFactory()
    const startedAt = this.now()
    const steps: AgentStep[] = []
    const warnings: LoopWarning[] = []
    let usage: Usage | undefined
    let providerUsed: ProviderId | undefined
    let sandboxId: string | null = null
    let stopInfo: LoopStopInfo | undefined
    // v4.1: the turn clock is an idle timer now — see `turnIsOverdue`.

    this.log('info', 'run.start', runId, { task })

    const start = await createRunSandbox({
      sandbox: this.sandbox,
      sandboxOptions: this.sandboxOptions,
      ...(this.onSandboxReady ? { onSandboxReady: this.onSandboxReady } : {}),
      log: this.log,
      runId
    })
    if (!start.ok) {
      return finishRun(
        { log: this.log, now: this.now },
        runId,
        task,
        'failed',
        steps,
        null,
        start.message,
        { sandboxId: null },
        warnings,
        stopInfo,
        usage,
        startedAt
      )
    }
    sandboxId = start.sandboxId
    const provider = start.provider

    const executor = this.buildExecutor(sandboxId)
    // Plan Mode exposes no tools so the model can only describe what it would do.
    //
    // v2.8.0: `ask_user` is offered only when a question gate is wired, and it is
    // handled by this loop rather than by the sandbox executor. It is also available
    // in Plan Mode, where asking is most useful ("which of these should I plan for?").
    const tools = this.planMode
      ? this.questionGate
        ? [ASK_USER_TOOL]
        : []
      : this.questionGate
        ? [...this.tools, ASK_USER_TOOL]
        : this.tools
    // Per-run state so sequential or concurrent `run()` calls never share loop state.
    const loopDetector = new LoopDetector(this.loopPolicy, {
      findAlternative: (toolName, args, error) => findAlternatives(toolName, args, error)
    })
    const observedSignatures = new Set<string>()
    // The last plan shown to the user, so a repeated plan can be flagged (A.5).
    let lastPlan: Plan | undefined
    // `remote_shell` present ⇒ the run targets a VPS, so add the discovery /
    // loop / diagnostic guidance (v2.5.3, Fix 3).
    const remoteWork = this.extraToolNames.has('remote_shell')
    const context = new ContextManager({
      systemPrompt: buildRunSystemPrompt({
        provider,
        tools,
        planMode: this.planMode,
        ...(this.systemHint !== undefined ? { systemHint: this.systemHint } : {}),
        planGateEnabled: Boolean(this.planGate && this.planApproval && this.planApproval !== 'full'),
        remoteWork,
        diagnosticEnabled: Boolean(this.diagnosticMode?.()),
        crashDiagnosis: this.extraToolNames.has('diagnose_crash'),
        ...(this.remoteContext ? { remoteContext: this.remoteContext } : {})
      }),
      maxTokens: this.contextWindowTokens,
      compactionThreshold: this.compactionThreshold,
      ...(this.contextMaxChars !== undefined ? { maxChars: this.contextMaxChars } : {}),
      ...(this.compressContext
        ? { transformOldMessages: (message: ChatMessage) => compressMessage(message, this.compressOptions) }
        : {})
    })

    // Resume a stored session (e.g. after an app restart) before the new task.
    await resumeSessionIntoContext({
      ...(this.sessionStore ? { store: this.sessionStore } : {}),
      ...(options.resumeSessionId ? { resumeId: options.resumeSessionId } : {}),
      context,
      log: this.log,
      runId
    })

    // v2.9.0: the task's `parts` carry an attached image inline; `content` stays
    // the canonical plain text so history, compaction and the session keep
    // working for text-only consumers.
    if (this.initialUserParts?.length) {
      context.append({ role: 'user', content: task, parts: this.initialUserParts })
    } else {
      context.appendUser(task)
    }
    this.log('debug', 'context.built', runId, {
      messages: context.length,
      estimatedTokens: context.estimateTokens()
    })

    const summarizer = this.summarizer ?? createAdapterSummarizer(this.providers[0])

    let status: AgentStatus = 'max_steps'
    let finalAnswer: string | null = null
    let message: string | null = null
    // v2.4 A.3: recent tool results feed success-claim verification.
    const recentToolCalls: ToolCallRecord[] = []
    let verificationNudges = 0

    try {
      for (let index = 0; index < this.maxSteps; index++) {
        if (options.signal?.aborted) {
          status = 'aborted'
          message = 'Run aborted by caller'
          break
        }
        const turnClock = turnIsOverdue(steps, startedAt, this.turnTimeoutMs, this.now)
        if (turnClock.overdue) {
          this.log('warn', 'loop.turn_timeout', runId, { step: index, idle: turnClock.idle })
          warnings.push(turnTimeoutWarning(turnClock, index, this.turnTimeoutMs))
          stopInfo = buildStopInfo('turn_timeout', steps)
          status = 'needs_input'
          message = stopInfo.message
          finalAnswer = null
          break
        }

        const startedStepAt = this.now()
        this.log('debug', 'step.start', runId, { step: index, phase: 'planning' })

        // ---- Compaction: keep the prompt within budget before planning ----
        await maybeCompact(this.log, context, summarizer, runId, index)

        // ---- Planning: ask the model (with provider fallback) ----
        const outcome = await callLlm(this.llmDeps, context, runId, index, options, tools)
        providerUsed = outcome.provider
        usage = addUsage(usage, outcome.response.usage)
        const assistantText = outcome.response.content
        const toolCalls = outcome.response.toolCalls ?? []
        // v2.8.0: the provider's reasoning for this call (DeepSeek `reasoning_content`,
        // OpenAI-compatible `reasoning`, Anthropic thinking blocks). Kept out of
        // `content` on purpose, so it can never be mistaken for the reply or re-sent as
        // an assistant message on the next turn.
        const stepReasoning = outcome.response.reasoning?.trim() || undefined
        if (stepReasoning) {
          this.log('info', 'step.reasoning', runId, {
            step: index,
            phase: 'planning',
            // Capped in the log like every other free-text field.
            reasoning: stepReasoning.slice(0, 2000)
          })
        }

        if (toolCalls.length === 0) {
          // v2.4 A.3: don't accept a bare success claim without a recent verification.
          const answer = settleAnswerWithoutTools(
            {
              enforceSuccessVerification: this.enforceSuccessVerification,
              now: this.now,
              log: this.log,
              context
            },
            {
              runId,
              index,
              startedAt: startedStepAt,
              assistantText,
              ...(stepReasoning ? { stepReasoning } : {}),
              recentToolCalls,
              verificationNudges
            }
          )
          if (answer.kind === 'nudge') {
            verificationNudges++
            continue
          }
          finalAnswer = answer.finalAnswer
          status = answer.status
          message = answer.message
          steps.push(answer.step)
          this.emitDecision(runId, steps[steps.length - 1])
          this.log('debug', 'step.reflection', runId, {
            step: index,
            phase: 'reflection',
            detail: 'final answer'
          })
          break
        }

        // ---- Execution ----
        let actions = toolCalls.map(actionFromToolCall)
        context.appendAssistant(assistantText, toolCalls)
        this.log('debug', 'step.execution', runId, {
          step: index,
          phase: 'execution',
          actions: actions.map((action) => action.name)
        })

        const observations: AgentToolResult[] = []
        // A successful call to any of these means the run advanced, so the loop
        // guard starts a fresh window. Shell commands count too: `npm test`,
        // `git status` and friends are real work, and without this a long script
        // of distinct-but-successful commands could still exhaust the window.
        const progressTools = new Set([
          'write_file',
          'read_file',
          'remote_write_file',
          'remote_read_file',
          'run_command',
          'remote_shell'
        ])
        let guardStop: LoopCallDecision | null = null
        let planCancelled = false
        // X2: set when the question gate reported the deadlock guard rather than an answer.
        let questionAbandoned: string | null = null
        // v2.6.3 T3.2: the user refused a preflight block; stop the step cleanly.
        let preflightCancelled = false
        // Fix 4: durable system notes for this step, flushed after the tool
        // results so an approval/plan note never splits an assistant/tool pair.
        const stepNotes: string[] = []
        const approvalDecisions: Array<{ tool: string; approved: boolean }> = []

        // ---- Plan Mode gate (v2.3.2, A.5) ----
        if (
          this.planGate &&
          this.planApproval !== undefined &&
          shouldPlan(this.planApproval, actions)
        ) {
          const gated = await applyPlanGate(
            { planGate: this.planGate, now: this.now, log: this.log, context },
            {
              task,
              runId,
              step: index,
              actions,
              ...(lastPlan ? { lastPlan } : {})
            }
          )
          actions = gated.actions
          lastPlan = gated.plan
          planCancelled = gated.cancelled
          stepNotes.push(...gated.notes)
          observations.push(...gated.observations)
        }

        for (let actionIndex = 0; actionIndex < actions.length; actionIndex++) {
          if (options.signal?.aborted || planCancelled) break

          // Remote-first routing: rewrite local tools to their remote_* form (or
          // block with a clear message) before the action reaches an executor.
          const routed = routeAction(this.toolRouting, actions[actionIndex])
          if ('error' in routed) {
            observations.push(routed.error)
            context.appendToolResult({
              toolCallId: actions[actionIndex].id,
              name: actions[actionIndex].name,
              content: formatObservation(routed.error)
            })
            continue
          }
          actions[actionIndex] = routed.action
          const action = routed.action

          // v2.8.0: ask_user is answered here, before the loop guard.
          if (action.name === 'ask_user' && this.questionGate) {
            const asked = await answerAskUser(
              { questionGate: this.questionGate, log: this.log, context },
              action,
              runId,
              index
            )
            if (asked.kind === 'abandoned') {
              // X2's deadlock guard: nobody answered within the configured ceiling, so the
              // run ends here instead of parking forever. The calls behind the question never
              // ran — `settlePendingToolCalls` below still answers them for the transcript.
              questionAbandoned = asked.reason
              break
            }
            observations.push(asked.result)
            // Waiting on a human is not a stall, and a question repeated across steps
            // is not a loop: give the run its budget back.
            loopDetector.markProgress()
            continue
          }

          // Fuzzy loop guard: catch the same tool name repeated even when its
          // arguments change every call (e.g. remote_shell with new commands).
          const guard = loopDetector.beforeToolCall(action.name, action.arguments)
          const gated = applyLoopGuard(
            { log: this.log, context, runId, step: index },
            action,
            guard
          )
          if (gated.kind === 'handled') {
            observations.push(gated.result)
            continue
          }
          if (gated.kind === 'stop') {
            guardStop = gated.guard
            break
          }

          // v2.4 A.2: state check before a sensitive action executes.
          if (this.preflightGate) {
            const outcome = await resolvePreflight(
              this.preflightDeps,
              action,
              runId,
              index,
              options.signal,
              context,
              observations
            )
            if (outcome === 'blocked') continue
            if (outcome === 'cancelled') {
              preflightCancelled = true
              break
            }
          }

          const before = await snapshotBefore(this.sandbox, action, sandboxId)
          const result = await guardedExecute(
            this.executionDeps,
            executor,
            action,
            runId,
            index,
            options,
            (tool, approved) => approvalDecisions.push({ tool, approved })
          )
          loopDetector.afterToolCall(
            action.name,
            {
              ok: result.ok,
              blocked: result.blocked === true || result.code === 'blocked',
              ...(result.error ? { error: result.error } : {})
            },
            action.arguments
          )
          if (result.ok && progressTools.has(action.name)) loopDetector.markProgress()
          if (result.ok && before !== null) {
            this.onFileWritten?.({
              path: String(action.arguments.path ?? ''),
              before,
              after: String(action.arguments.content ?? '')
            })
          }
          observations.push(result)
          recentToolCalls.push({
            toolName: action.name,
            ...(typeof action.arguments.command === 'string'
              ? { command: action.arguments.command }
              : {}),
            exitCode: result.ok ? 0 : 1,
            timestamp: this.now()
          })
          context.appendToolResult({
            toolCallId: action.id,
            name: action.name,
            content: formatObservation(result)
          })
        }

        // Every requested tool call must be answered before the next assistant
        // turn. The action loop can stop early (abort, blocked guard, cancelled
        // plan/preflight), which would leave an assistant turn with tool_calls
        // and no matching tool responses — DeepSeek/OpenAI reject that with 400.
        //
        // Fix 4: the step's plan/approval decisions are pinned as system messages
        // here too, now that every assistant/tool pair is complete.
        const approvalNote = settlePendingToolCalls(actions, observations, approvalDecisions, context)
        if (approvalNote) stepNotes.push(approvalNote)
        for (const note of stepNotes) context.appendHint(note)

        if (planCancelled) {
          status = 'needs_input'
          message = 'Plan cancelled by the user.'
          finalAnswer = null
          break
        }

        // v2.6.3 T3.2: a cancelled preflight block stops the run with a clear reason
        // instead of silently dropping the action.
        if (preflightCancelled) {
          status = 'needs_input'
          message = 'Preflight block cancelled by the user.'
          finalAnswer = null
          break
        }

        // X2: a question nobody ever answered ends the run with the reason instead of
        // leaving it parked forever. Nothing executed, and the model's transcript stays
        // consistent because `settlePendingToolCalls` answered the calls this step skipped.
        if (questionAbandoned) {
          status = 'needs_input'
          message = questionAbandoned
          finalAnswer = null
          break
        }

        if (guardStop) {
          const guardReason = (guardStop.reason ?? 'repeated_action') as LoopStopInfo['reason']
          stopInfo = buildStopInfo(guardReason, steps)
          if (guardStop.message) stopInfo.message = guardStop.message
          const history = loopDetector.toolCallHistory.slice(-5)
          if (history.length > 0) {
            stopInfo.recentActions = history.map(
              (call) => `${call.toolName} (${call.ok ? 'ok' : 'failed'}) @ ${new Date(call.at).toISOString()}`
            )
          }
          status = 'needs_input'
          message = guardStop.message ?? stopInfo.message
          finalAnswer = null
          break
        }

        // ---- Observation + Reflection ----
        const summary = summarizeStep({
          index,
          startedAt: startedStepAt,
          now: this.now,
          assistantText,
          ...(stepReasoning ? { stepReasoning } : {}),
          actions,
          observations,
          observedSignatures
        })
        this.log('debug', 'step.reflection', runId, {
          step: index,
          phase: 'reflection',
          productive: summary.productive,
          reflection: summary.step.reflection
        })
        steps.push(summary.step)
        this.emitDecision(runId, steps[steps.length - 1])

        // ---- Loop detection ----
        const loop = applyLoopVerdict(
          { log: this.log, context, runId, step: index },
          {
            loopDetector,
            actions,
            observations,
            productive: summary.productive,
            failures: summary.failures,
            newAction: summary.newAction,
            ...(summary.reasoningSignature ? { reasoningSignature: summary.reasoningSignature } : {})
          },
          warnings
        )
        if (loop.stop) {
          stopInfo = buildStopInfo(loop.stopReason ?? 'repeated_action', steps)
          status = 'needs_input'
          message = stopInfo.message
          finalAnswer = null
          break
        }
        if (loop.shouldAskUser) {
          status = 'needs_input'
          message =
            `Stopped after ${loop.noProgressSteps} steps without progress. ` +
            'Provide guidance to continue.'
          finalAnswer = null
          break
        }
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      this.log('error', 'run.error', runId, { message: text })
      // A cancellation that lands mid-call should read as `aborted`, not `failed`.
      const aborted = options.signal?.aborted === true
      status = aborted ? 'aborted' : 'failed'
      message = aborted ? 'Run aborted by caller' : `LLM call failed: ${text}`
    } finally {
      if (sandboxId) {
        try {
          await this.sandbox.destroySandbox(sandboxId)
          this.log('info', 'sandbox.destroyed', runId, { sandboxId })
        } catch (error) {
          this.log('warn', 'sandbox.destroy_failed', runId, {
            sandboxId,
            message: error instanceof Error ? error.message : String(error)
          })
        }
      }
    }

    // v2.8.0: `max_steps` used to be a silent dead end. The loop simply ran out of
    // iterations, `status` stayed 'max_steps' with `message: null` and no stop info,
    // so `run:end` carried nothing to show: no answer, no message, no loop card —
    // the chat just went idle and the user was left wondering whether it was still
    // working. Give it the same voice as every other stop.
    if (status === 'max_steps' && !stopInfo) {
      stopInfo = buildStopInfo('no_progress', steps)
      message =
        `Stopped after the ${this.maxSteps}-step budget without finishing. ` +
        'Tell me how to continue, or raise the step budget.'
      this.log('warn', 'loop.max_steps', runId, { steps: steps.length, maxSteps: this.maxSteps })
    }

    const result = finishRun(
      { log: this.log, now: this.now },
      runId,
      task,
      status,
      steps,
      finalAnswer,
      message,
      { provider: providerUsed, sandboxId },
      warnings,
      stopInfo,
      usage,
      startedAt
    )
    await persistRunSession(
      {
        ...(this.sessionStore ? { store: this.sessionStore } : {}),
        ...(this.sessionId ? { sessionId: this.sessionId } : {}),
        ...(this.sessionMetadata ? { metadata: this.sessionMetadata } : {}),
        log: this.log
      },
      context,
      task,
      result,
      options.resumeSessionId
    )
    return result
  }

  /** Compose sandbox tools with any extra (e.g. remote) tool runtime. */
  private buildExecutor(sandboxId: string): ToolExecutor {
    const sandboxExecutor = new SandboxToolExecutor(
      this.sandbox,
      sandboxId,
      this.commandTimeoutMs
    )
    const extra = this.extraExecutor
    if (!extra) return sandboxExecutor
    const extraNames = this.extraToolNames
    return {
      execute: (action: AgentAction, options?: ToolExecOptions) =>
        extraNames.has(action.name)
          ? extra.execute(action, options)
          : sandboxExecutor.execute(action, options)
    }
  }

  /**
   * The dependencies the extracted modules need, gathered where they are used: no
   * helper ever receives the class, only the facts it reads.
   */
  private get llmDeps(): LlmCallDeps {
    return {
      providers: this.providers,
      recovery: this.recovery,
      planMode: this.planMode,
      log: this.log
    }
  }

  private get preflightDeps(): PreflightDeps {
    return {
      ...(this.preflightGate ? { gate: this.preflightGate } : {}),
      ...(this.preflightOverride ? { override: this.preflightOverride } : {}),
      retryDelayMs: this.preflightRetryDelayMs,
      log: this.log
    }
  }

  private get executionDeps(): ExecutionDeps {
    return {
      recovery: this.recovery,
      log: this.log,
      ...(this.approvalGate ? { approvalGate: this.approvalGate } : {}),
      ...(this.onToolResult ? { onToolResult: this.onToolResult } : {})
    }
  }

  /** Phase marker helper for consumers that render progress. */
  static phaseOrder(): AgentPhase[] {
    return ['planning', 'execution', 'observation', 'reflection']
  }
}
