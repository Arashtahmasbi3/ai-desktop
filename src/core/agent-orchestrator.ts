import type {
  CreateSandboxOptions,
  SandboxManager,
  SandboxProvider
} from '@shared/sandbox'
import type {
  ChatMessage,
  ChatResponse,
  ProviderId,
  ToolDefinition,
  Usage
} from '@shared/types'
import type {
  AgentAction,
  AgentLogEntry,
  AgentLogLevel,
  AgentLogger,
  AgentPhase,
  AgentRecoveryPolicy,
  AgentRunOptions,
  AgentRunResult,
  AgentStatus,
  AgentStep,
  AgentToolResult,
  LoopDetectionPolicy,
  LoopStopInfo,
  LoopWarning,
  ProviderEntry,
  ToolRecoveryInfo
} from '@shared/agent'
export type { ProviderEntry }
import type { ToolResultView } from '@shared/ui'
import { buildToolDetail, toolDetailLogFields } from './agent/tool-detail'
import { sleep } from '@core/llm-adapters'
import {
  ContextManager,
  summarizeDeterministically,
  type ContextSummarizer
} from './agent/context-manager'
import { compressMessage, type CompressOptions } from './agent/context-compressor'
import { ErrorRecovery, guidanceForToolError } from './agent/error-recovery'
import { LoopDetector, type LoopCallDecision } from './agent/loop-detector'
import { silentLogger } from './agent/logger'
import { SESSION_SCHEMA_VERSION, type AgentSession, type SessionStore } from './agent/session-store'
import { SANDBOX_TOOLS, SandboxToolExecutor, actionFromToolCall, stableStringify } from './agent/tools'
import { PLAN_MODE_HINT } from './agent/approval'
import {
  PLAN_SYSTEM_PROMPT,
  applyModifications,
  planFromActions,
  shouldPlan,
  validatePlan,
  type Plan,
  type PlanDecision,
  type PlanWarning
} from './agent/plan-mode'
import type { ApprovalMode } from '@shared/approval'
import type { RoutingDecision } from './agent/remote-routing'
import type { ToolExecutor, ToolExecOptions } from './agent/tools'
import { preflightWarnings, type PreflightResult } from './agent/preflight'
import { verifySuccess, type ToolCallRecord } from './agent/success-verifier'

/** A file that an agent `write_file` action changed during a run. */
export interface FileChange {
  path: string
  before: string
  after: string
}

export interface AgentOrchestratorOptions {
  sandbox: SandboxManager
  providers: ProviderEntry[]
  logger?: AgentLogger
  /** Tools exposed to the model (defaults to {@link SANDBOX_TOOLS}). */
  tools?: ToolDefinition[]
  /** Extra tools (e.g. `remote_shell`) exposed alongside the sandbox tools. */
  extraTools?: ToolDefinition[]
  /** Executor for {@link extraTools}; sandbox tools keep using the sandbox. */
  extraExecutor?: ToolExecutor
  /** Extra environment/instructions appended to the system prompt. */
  systemHint?: string
  /** Maximum number of plan/execute cycles before stopping. Default 12. */
  maxSteps?: number
  /** Character budget for history sent to the model. */
  contextMaxChars?: number
  /** Default per-command timeout inside the sandbox (ms). */
  commandTimeoutMs?: number
  /**
   * Wall-clock budget for one run() call (ms). 0 disables the turn timeout.
   * Defaults to {@link DEFAULT_TURN_TIMEOUT_MS}.
   */
  turnTimeoutMs?: number
  loopPolicy?: Partial<LoopDetectionPolicy>
  recoveryPolicy?: Partial<AgentRecoveryPolicy>
  /** Extra options merged into `createSandbox`. */
  sandboxOptions?: CreateSandboxOptions
  /** Token budget for the model context (defaults from provider capabilities). */
  contextWindowTokens?: number
  /** Fraction of the token budget that triggers compaction. Default 0.8 (80%). */
  compactionThreshold?: number
  /** Compress old context (strip code comments/blank lines, dedupe). Default true. */
  compressContext?: boolean
  compressOptions?: CompressOptions
  /** Override the summarizer used when compacting history. */
  summarizer?: ContextSummarizer
  /** Persist each run's session to disk (see {@link SessionStore}). */
  sessionStore?: SessionStore
  /** Base session id, reused across runs so resumes update the same session. */
  sessionId?: string
  /** Plan Mode: expose no tools and only produce a plan. */
  planMode?: boolean
  /**
   * Consulted before every action executes. Return false to block the action
   * (recorded as a `blocked` observation) without running it.
   */
  approvalGate?: (action: AgentAction) => Promise<boolean>
  /**
   * Plan Mode (v2.3.2, A.5). When present (and `planApproval` is not `full`),
   * a batch containing mutating actions is offered as a plan and must be
   * approved before anything runs. Full access and read-only batches skip it.
   */
  planGate?: (plan: Plan, warnings: PlanWarning[]) => Promise<PlanDecision>
  /** Approval mode the plan gate reasons about. Absent ⇒ plan gate disabled. */
  planApproval?: ApprovalMode
  /**
   * Remote-first routing (v2.3.2, A.1). Consulted before an action runs so local
   * file/shell tools can be rewritten to their `remote_*` equivalents, or turned
   * into a clear error, when the active project lives on a VPS.
   */
  toolRouting?: (toolName: string, args: Record<string, unknown>) => RoutingDecision
  /**
   * Called after a successful `write_file`, with the file's previous and new
   * contents, so callers can surface a reviewable diff.
   */
  onFileWritten?: (change: FileChange) => void
  /**
   * Called after every executed action with its redacted, length-capped detail
   * (v2.5.2). Lets the caller stream a `tool:result` event to the renderer
   * independently of the structured log.
   */
  onToolResult?: (result: ToolResultView) => void
  /**
   * Reliability preflight (v2.4, A.2). Consulted before each action runs; a result
   * with `ok: false` blocks the action and any warn/fail checks are logged.
   */
  preflightGate?: (action: AgentAction) => Promise<PreflightResult | undefined>
  /**
   * Enforcement (v2.4, A.3). When true, a final answer that claims success is only
   * accepted if a verification-shaped tool call (test/build/health) recently passed.
   */
  enforceSuccessVerification?: boolean
  /**
   * v2.5.3 Fix 3: reports whether Diagnostic Mode is active right now. Read at
   * run start so the system prompt copies the current read-only posture. A
   * function (not a boolean) because the 30-minute window can lapse between runs.
   */
  diagnosticMode?: () => boolean
  /**
   * v2.5.3 Smarter Prompt: the active project, its path, the VPS and the
   * environment, baked into the system prompt so simple "where am I?" questions
   * are answered from context instead of tool calls.
   */
  remoteContext?: RemotePromptContext
  now?: () => number
  runIdFactory?: () => string
}

const DEFAULT_MAX_STEPS = 12
// A single shell command may run for up to a minute; a whole turn for five.
const DEFAULT_COMMAND_TIMEOUT_MS = 60_000
const DEFAULT_TURN_TIMEOUT_MS = 5 * 60 * 1000

function addUsage(total: Usage | undefined, next: Usage | undefined): Usage | undefined {
  if (!next) return total
  if (!total) return { ...next }
  return {
    promptTokens: total.promptTokens + next.promptTokens,
    completionTokens: total.completionTokens + next.completionTokens,
    totalTokens: total.totalTokens + next.totalTokens
  }
}

function defaultContextTokens(entry: ProviderEntry): number {
  const caps = entry.adapter.getCapabilities(entry.config.model)
  const reserve = caps.maxOutputTokens ?? 4096
  return Math.max(2048, (caps.contextWindow ?? 32_000) - reserve)
}

function formatTranscriptForSummary(messages: readonly ChatMessage[]): string {
  return messages
    .map((message) => {
      const role = message.role.toUpperCase()
      const body = message.content ?? ''
      const calls = message.toolCalls?.map((call) => `${call.name}(${call.arguments})`).join(', ')
      return calls ? `${role}: ${body}\n[tool_calls: ${calls}]` : `${role}: ${body}`
    })
    .join('\n\n')
}

/**
 * Build a {@link ContextSummarizer} that asks the provider to compress dropped
 * history, falling back to a deterministic summary if the call fails.
 */
export function createAdapterSummarizer(entry: ProviderEntry): ContextSummarizer {
  const instruction =
    'You compress an AI coding agent conversation. Summarize the transcript into ' +
    'a compact brief (max ~200 words) that preserves: the user goal, files created ' +
    'or changed, key commands and their outcomes, decisions made, and any open ' +
    'blockers. Keep file paths and identifiers verbatim. Respond with the summary only.'

  return async ({ previousSummary, messages }) => {
    const transcript = formatTranscriptForSummary(messages)
    try {
      const response = await entry.adapter.chat(
        {
          model: entry.config.model,
          temperature: 0,
          messages: [
            { role: 'system', content: instruction },
            {
              role: 'user',
              content: `${previousSummary ? `Previous summary:\n${previousSummary}\n\n` : ''}Transcript:\n${transcript}`
            }
          ]
        },
        entry.config
      )
      const summary = response.content?.trim()
      if (summary) return summary
    } catch {
      // Fall through to the deterministic summary.
    }
    return summarizeDeterministically(messages, previousSummary)
  }
}

function summarizeTools(tools: ToolDefinition[]): string {
  return tools
    .map((tool) => {
      const props = (tool.parameters as { properties?: Record<string, { description?: string }> })
        .properties
      const args = props
        ? Object.entries(props)
            .map(([name, schema]) => `${name}${schema.description ? `: ${schema.description}` : ''}`)
            .join(', ')
        : ''
      return `- ${tool.name}(${args})\n  ${tool.description}`
    })
    .join('\n')
}

/**
 * Concrete run context baked into the prompt (v2.5.3, Smarter Prompt) so the
 * model can answer "which project am I on?" from what it already knows instead
 * of spending tool calls re-discovering it.
 */
export interface RemotePromptContext {
  projectName?: string
  projectPath?: string
  vpsId?: string
  vpsName?: string
  environment?: string
}

export interface SystemPromptOptions {
  /** A remote VPS is in play, so remote discovery/loop rules apply (v2.5.3). */
  remote?: boolean
  /** Diagnostic Mode is currently active (read-only system access). */
  diagnosticEnabled?: boolean
  /** Active project/VPS/environment shown to the model (v2.5.3). */
  remoteContext?: RemotePromptContext
  /** The `diagnose_crash` tool is available, so teach the diagnosis workflow. */
  crashDiagnosis?: boolean
}

/**
 * Guidance appended to the system prompt for remote/VPS work (v2.5.3, Fix 3).
 *
 * The v2.5.2 tool cards made a specific failure visible: the agent probed
 * `/etc/os-release` and `/proc/loadavg` (blocked by P0-2) and re-tried a path
 * that did not exist instead of discovering the real layout. This block teaches
 * the two habits that fix it — discover before acting, and change strategy after
 * a block — plus what to use when Diagnostic Mode is off.
 */
export function buildRemoteGuidance(
  diagnosticEnabled = false,
  context?: RemotePromptContext,
  crashDiagnosis = false
): string {
  const contextBlock = context
    ? [
        '## Context awareness (already known - do NOT spend tool calls re-discovering)',
        context.projectName ? `- Project: ${context.projectName}` : '',
        context.projectPath ? `- Path: ${context.projectPath}` : '',
        context.vpsName || context.vpsId
          ? `- VPS: ${context.vpsName ?? context.vpsId}` +
            `${context.vpsName && context.vpsId ? ` (${context.vpsId})` : ''}`
          : '',
        context.environment ? `- Environment: ${context.environment}` : '',
        'Answer a question about any of these directly from this context instead of ' +
          'making tool calls. Only call tools when you need new information from the host.'
      ]
        .filter(Boolean)
        .join('\n')
    : [
        '## Context awareness',
        'The current project, its path, the VPS and the environment are shown in the chat',
        'header. For a simple question about them, answer from that context instead of',
        'making tool calls. Only call tools when you need new information from the host.'
      ].join('\n')
  return `# Remote diagnostics (VPS / remote project)
You are working on a remote host. Follow these habits.

## Discover the project layout before acting
- Never assume \`package.json\` (or any manifest) sits at the project root; it is
  commonly under \`apps/\`, \`packages/\`, \`services/\` or \`src/\`.
- Find it first, then read it:
  \`find <projectRoot> -maxdepth 3 -name package.json 2>/dev/null\`
- Use \`list_dir\` on the project root before guessing nested paths.

## Read-only system facts (allowed without a path)
- \`uname -a\` kernel, \`hostname\` server name, \`uptime\` load average
- \`free -h\` memory, \`df -h\` disk, \`nproc\` CPUs
- \`systemctl status <service>\` service state
These carry no path argument and are always permitted.

## If a path is blocked
The project root is confined (P0-2). A message like
\`Blocked: Path "..." is outside project root\` means the target is off-limits.
- Do NOT retry the same path; it will be blocked again.
- Use a whitelisted command above, or stay inside the project root.
- If you truly need logs or \`/proc\`, ask the user to enable Diagnostic Mode.

## If a file is not found
Do NOT assume where it lives. Run \`find\` (or \`list_dir\`) first, then act on the
real path.

${
  crashDiagnosis
    ? `## Crash diagnosis workflow
When the user asks about a crash, an error or a service being down:
1. FIRST call the \`diagnose_crash\` tool. It runs the standard read-only probes
   (process managers, logs, resources, network) and collects the evidence for you.
2. THEN report in two sections:
   - **Evidence**: the key outputs from the probes.
   - **Diagnosis**: the probable cause, a confidence level (HIGH/MEDIUM/LOW) and
     concrete recommendations.
3. NEVER guess without evidence, never claim the project is healthy without
   checking, and do not invent complex shell one-liners yourself.
4. If \`diagnose_crash\` is not enough, ask the user before reaching further:
   "Should I check log file X?" or "Enable Diagnostic Mode so I can read the
   system logs."

Example report:
\`\`\`
== Evidence ==
- PM2: app is errored (15 restarts)
- Memory: 3.7/4 GB used (92%)
- Disk: 45% used
- No OOM events detected

== Diagnosis ==
Cause: pm2_process_error (confidence: HIGH)
Summary: PM2 logs show repeated restarts
Recommendations:
- Check: pm2 logs <app> --err
- Increase the memory limit in ecosystem.config.js
- Review recent changes for a memory leak
\`\`\``
    : ''
}

${contextBlock}

${
  diagnosticEnabled
    ? `## Diagnostic Mode: ON (read-only, ~30 min)
You may read \`/var/log\`, \`/root/.pm2/logs\`, \`/proc\`, \`/etc/os-release\` and
other allowed system paths to diagnose a crash. Read-only — never write there.`
    : `## Diagnostic Mode: OFF
System paths (\`/var/log\`, \`/proc\`, \`/etc/os-release\`, \`journalctl\`) are
blocked. Use the whitelisted commands above, or ask the user to enable
Diagnostic Mode in Settings for a crash investigation.`
}`
}

export function buildSystemPrompt(
  provider: SandboxProvider,
  tools: ToolDefinition[],
  systemHint?: string,
  options: SystemPromptOptions = {}
): string {
  return `You are AI Desktop, an autonomous coding agent working inside a sandbox.

# Environment
- You operate inside an isolated "${provider}" sandbox workspace. The host filesystem is NOT accessible.
- Every path you use is relative to the workspace root (for example "hello.txt", "src/app.js").
- Network access is disabled by default.
${systemHint ? `\n# Remote access\n${systemHint}\n` : ''}
# Available tools
${summarizeTools(tools)}

# How you work (repeat until the task is done)
1. Planning  - decide the single next step that moves the task forward.
2. Execution - call one or more tools. Batch independent calls in one turn.
3. Observation - read the tool results that are returned to you. Never invent results.
4. Reflection - judge whether the task is complete.

# Finishing
When the task is complete, reply with a short summary and make NO tool calls.
If you are blocked, explain what you need from the user and make NO tool calls.

# Rules
- Do not repeat an action that already succeeded.
- If an action failed, correct the arguments before retrying.
- Prefer write_file to create files and run_command to execute them.
- Reply in the same language the user wrote in (Persian or English).
${options.remote ? `\n${buildRemoteGuidance(options.diagnosticEnabled, options.remoteContext, options.crashDiagnosis)}\n` : ''}`
}

function formatObservation(result: AgentToolResult): string {
  if (result.ok) {
    return `[ok] ${result.name}\n${result.output || '(no output)'}`
  }
  const guidance = guidanceForToolError(result.code, result.name)
  return `[error:${result.code ?? 'unknown'}] ${result.name} failed: ${result.error ?? 'unknown error'}\n${guidance}`
}

export interface LlmCallOutcome {
  response: ChatResponse
  provider: ProviderId
}

/**
 * Orchestrates the Planning -> Execution -> Observation -> Reflection loop:
 * asks the LLM what to do, runs the requested tools in a sandbox, feeds the
 * observations back, detects loops and recovers from failures.
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
  private readonly contextWindowTokens: number
  private readonly compactionThreshold: number
  private readonly compressContext: boolean
  private readonly compressOptions: CompressOptions
  private readonly summarizer?: ContextSummarizer
  private readonly sessionStore?: SessionStore
  private readonly sessionId?: string
  private readonly planMode: boolean
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
    this.extraExecutor = options.extraExecutor
    this.extraToolNames = new Set((options.extraTools ?? []).map((tool) => tool.name))
    this.systemHint = options.systemHint
    this.maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS
    this.contextMaxChars = options.contextMaxChars
    this.commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS
    this.turnTimeoutMs = options.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS
    this.loopPolicy = options.loopPolicy ?? {}
    this.recovery = new ErrorRecovery(options.recoveryPolicy)
    this.sandboxOptions = options.sandboxOptions ?? {}
    this.contextWindowTokens =
      options.contextWindowTokens ?? defaultContextTokens(this.providers[0])
    this.compactionThreshold = options.compactionThreshold ?? 0.8
    this.compressContext = options.compressContext ?? true
    this.compressOptions = options.compressOptions ?? {}
    this.summarizer = options.summarizer
    this.sessionStore = options.sessionStore
    this.sessionId = options.sessionId
    this.planMode = options.planMode ?? false
    this.approvalGate = options.approvalGate
    this.planGate = options.planGate
    this.planApproval = options.planApproval
    this.toolRouting = options.toolRouting
    this.onFileWritten = options.onFileWritten
    this.onToolResult = options.onToolResult
    this.preflightGate = options.preflightGate
    this.enforceSuccessVerification = options.enforceSuccessVerification ?? false
    this.diagnosticMode = options.diagnosticMode
    this.remoteContext = options.remoteContext
    this.now = options.now ?? (() => Date.now())
    this.runCounter = 0
    this.runIdFactory = options.runIdFactory ?? (() => `run-${++this.runCounter}`)
  }

  private log(
    level: AgentLogLevel,
    event: string,
    runId: string,
    extra: Omit<Partial<AgentLogEntry>, 'ts' | 'level' | 'event' | 'runId'> = {}
  ): void {
    this.logger.log({ ts: new Date(this.now()).toISOString(), level, event, runId, ...extra })
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
    const deadline = this.turnTimeoutMs > 0 ? startedAt + this.turnTimeoutMs : null

    this.log('info', 'run.start', runId, { task })

    let provider: SandboxProvider
    try {
      const info = await this.sandbox.createSandbox({
        network: { enabled: false },
        ...this.sandboxOptions
      })
      sandboxId = info.id
      provider = info.provider
      this.log('info', 'sandbox.created', runId, {
        sandboxId,
        provider,
        workspaceRoot: info.workspaceRoot
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.log('error', 'sandbox.create_failed', runId, { message })
      return this.finish(
        runId,
        task,
        'failed',
        steps,
        null,
        message,
        { sandboxId },
        warnings,
        stopInfo,
        usage,
        startedAt
      )
    }

    const executor = this.buildExecutor(sandboxId)
    // Plan Mode exposes no tools so the model can only describe what it would do.
    const tools = this.planMode ? [] : this.tools
    // Per-run state so sequential or concurrent `run()` calls never share loop state.
    const loopDetector = new LoopDetector(this.loopPolicy)
    const observedSignatures = new Set<string>()
    // The last plan shown to the user, so a repeated plan can be flagged (A.5).
    let lastPlan: Plan | undefined
    const planHints = [this.systemHint]
    if (this.planGate && this.planApproval && this.planApproval !== 'full') {
      planHints.push(PLAN_SYSTEM_PROMPT)
    }
    // `remote_shell` present ⇒ the run targets a VPS, so add the discovery /
    // loop / diagnostic guidance (v2.5.3, Fix 3).
    const remoteWork = this.extraToolNames.has('remote_shell')
    const context = new ContextManager({
      systemPrompt: buildSystemPrompt(
        provider,
        tools,
        this.planMode
          ? [this.systemHint, PLAN_MODE_HINT].filter(Boolean).join('\n\n')
          : planHints.filter(Boolean).join('\n\n'),
        {
          remote: remoteWork,
          diagnosticEnabled: Boolean(this.diagnosticMode?.()),
          crashDiagnosis: this.extraToolNames.has('diagnose_crash'),
          ...(this.remoteContext ? { remoteContext: this.remoteContext } : {})
        }
      ),
      maxTokens: this.contextWindowTokens,
      compactionThreshold: this.compactionThreshold,
      ...(this.contextMaxChars !== undefined ? { maxChars: this.contextMaxChars } : {}),
      ...(this.compressContext
        ? { transformOldMessages: (message: ChatMessage) => compressMessage(message, this.compressOptions) }
        : {})
    })

    // Resume a stored session (e.g. after an app restart) before the new task.
    const resumeId = options.resumeSessionId
    if (resumeId && this.sessionStore) {
      try {
        const session = await this.sessionStore.load(resumeId)
        if (session) {
          context.restore({
            messages: session.messages,
            summary: session.summary ?? null,
            droppedCount: 0
          })
          this.log('info', 'session.resumed', runId, {
            sessionId: resumeId,
            messages: session.messages.length
          })
        }
      } catch (error) {
        this.log('warn', 'session.resume_failed', runId, {
          sessionId: resumeId,
          message: error instanceof Error ? error.message : String(error)
        })
      }
    }

    context.appendUser(task)
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
        if (deadline !== null && this.now() >= deadline) {
          this.log('warn', 'loop.turn_timeout', runId, { step: index })
          warnings.push({
            kind: 'turn_timeout',
            count: index,
            message: `Turn exceeded ${Math.round(this.turnTimeoutMs / 1000)}s budget`
          })
          stopInfo = this.buildStopInfo('turn_timeout', steps)
          status = 'needs_input'
          message = stopInfo.message
          finalAnswer = null
          break
        }

        const startedStepAt = this.now()
        this.log('debug', 'step.start', runId, { step: index, phase: 'planning' })

        // ---- Compaction: keep the prompt within budget before planning ----
        await this.maybeCompact(context, summarizer, runId, index)

        // ---- Planning: ask the model (with provider fallback) ----
        const outcome = await this.callLlm(context, runId, index, options, tools)
        providerUsed = outcome.provider
        usage = addUsage(usage, outcome.response.usage)
        const assistantText = outcome.response.content
        const toolCalls = outcome.response.toolCalls ?? []

        if (toolCalls.length === 0) {
          // v2.4 A.3: don't accept a bare success claim without a recent verification.
          if (this.enforceSuccessVerification && assistantText) {
            const verification = verifySuccess(assistantText, recentToolCalls, this.now())
            if (!verification.allowed) {
              this.log('warn', 'success.unverified', runId, {
                step: index,
                reason: verification.reason ?? 'unverified'
              })
              if (verificationNudges < 1) {
                verificationNudges++
                context.appendUser(
                  'Verification required before claiming success: run a test/build/health-check ' +
                    'command and report its actual result.'
                )
                continue
              }
              finalAnswer = assistantText
              context.appendAssistant(assistantText)
              status = 'needs_input'
              message = verification.reason ?? 'Success claim could not be verified.'
              steps.push({
                index,
                startedAt: startedStepAt,
                finishedAt: this.now(),
                thought: assistantText,
                actions: [],
                observations: [],
                reflection: 'Blocked a success claim without recent verification.',
                productive: false
              })
              break
            }
          }
          finalAnswer = assistantText
          context.appendAssistant(assistantText)
          status = 'completed'
          message = assistantText ? null : 'The model returned an empty response'
          steps.push({
            index,
            startedAt: startedStepAt,
            finishedAt: this.now(),
            thought: assistantText,
            actions: [],
            observations: [],
            reflection: 'Model produced a final answer with no tool calls.',
            productive: true
          })
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

        // ---- Plan Mode gate (v2.3.2, A.5) ----
        if (
          this.planGate &&
          this.planApproval !== undefined &&
          shouldPlan(this.planApproval, actions)
        ) {
          const plan = planFromActions(task, actions, this.now())
          const planWarnings = validatePlan(plan, lastPlan)
          lastPlan = plan
          this.log('debug', 'plan.requested', runId, {
            step: index,
            steps: plan.steps.length,
            warnings: planWarnings.map((warning) => warning.code)
          })
          let decision: PlanDecision = { type: 'cancel' }
          try {
            decision = await this.planGate(plan, planWarnings)
          } catch {
            decision = { type: 'cancel' }
          }
          if (decision.type === 'modify') {
            actions = applyModifications(actions, decision.steps)
            this.log('debug', 'plan.modified', runId, { step: index })
          } else if (decision.type === 'cancel') {
            planCancelled = true
            this.log('warn', 'plan.cancelled', runId, { step: index })
            for (const action of actions) {
              const blocked: AgentToolResult = {
                actionId: action.id,
                name: action.name,
                ok: false,
                output: '',
                error: 'Plan cancelled by the user.',
                code: 'blocked',
                attempts: 1,
                durationMs: 0
              }
              observations.push(blocked)
              context.appendToolResult({
                toolCallId: action.id,
                name: action.name,
                content: formatObservation(blocked)
              })
            }
          } else {
            this.log('debug', 'plan.approved', runId, { step: index })
          }
        }

        for (let actionIndex = 0; actionIndex < actions.length; actionIndex++) {
          if (options.signal?.aborted || planCancelled) break

          // Remote-first routing: rewrite local tools to their remote_* form (or
          // block with a clear message) before the action reaches an executor.
          const routed = this.routeAction(actions[actionIndex])
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

          // Fuzzy loop guard: catch the same tool name repeated even when its
          // arguments change every call (e.g. remote_shell with new commands).
          const guard = loopDetector.beforeToolCall(action.name, action.arguments)
          if (guard.action === 'warn') {
            this.log('warn', 'loop.guard_warn', runId, {
              step: index,
              tool: action.name,
              count: guard.count
            })
          }
          if (!guard.allow && guard.action === 'block') {
            // A.3: the tool failed twice in this session, so skip just this call
            // and hand the model a tool result telling it to choose another tool.
            const toolBlocked: AgentToolResult = {
              actionId: action.id,
              name: action.name,
              ok: false,
              output: '',
              error:
                guard.reason ??
                `Tool "${action.name}" is unavailable after repeated failures.`,
              code: 'blocked',
              attempts: 1,
              durationMs: 0
            }
            this.log('warn', 'loop.tool_blocked', runId, {
              step: index,
              tool: action.name,
              reason: guard.reason ?? 'repeated_failure'
            })
            observations.push(toolBlocked)
            context.appendToolResult({
              toolCallId: action.id,
              name: action.name,
              content: formatObservation(toolBlocked)
            })
            continue
          }
          if (!guard.allow) {
            guardStop = guard
            this.log('warn', 'loop.stop', runId, {
              step: index,
              reason: guard.reason ?? 'repeated_action',
              tool: action.name,
              count: guard.count
            })
            break
          }

          // v2.4 A.2: state check before a sensitive action executes.
          if (this.preflightGate) {
            let check: PreflightResult | undefined
            try {
              check = await this.preflightGate(action)
            } catch {
              check = undefined
            }
            if (check && !check.ok) {
              const failed = check.checks.filter((entry) => entry.status === 'fail')
              const blocked: AgentToolResult = {
                actionId: action.id,
                name: action.name,
                ok: false,
                output: '',
                error: `Preflight failed: ${failed.map((entry) => entry.message).join('; ')}`,
                code: 'blocked',
                attempts: 1,
                durationMs: 0
              }
              this.log('warn', 'preflight.blocked', runId, {
                step: index,
                tool: action.name,
                checks: failed.map((entry) => entry.name)
              })
              observations.push(blocked)
              context.appendToolResult({
                toolCallId: action.id,
                name: action.name,
                content: formatObservation(blocked)
              })
              continue
            }
            const warnings = check ? preflightWarnings(check) : []
            if (warnings.length > 0) {
              this.log('warn', 'preflight.warnings', runId, {
                step: index,
                tool: action.name,
                checks: warnings.map((entry) => entry.name)
              })
            }
          }

          const before = await this.snapshotBefore(action, sandboxId)
          const result = await this.guardedExecute(executor, action, runId, index, options)
          loopDetector.afterToolCall(
            action.name,
            { ok: result.ok, blocked: result.blocked === true || result.code === 'blocked' },
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

        if (planCancelled) {
          status = 'needs_input'
          message = 'Plan cancelled by the user.'
          finalAnswer = null
          break
        }

        if (guardStop) {
          const guardReason = (guardStop.reason ?? 'repeated_action') as LoopStopInfo['reason']
          stopInfo = this.buildStopInfo(guardReason, steps)
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
        const attemptedBefore = new Set(observedSignatures)
        const productive = this.isProductive(actions, observations, observedSignatures)
        const newAction = observations.some(
          (result, index) =>
            result.ok && !attemptedBefore.has(actions[index]?.signature ?? '')
        )
        const failures = observations.filter((result) => !result.ok).length
        const reasoningSignature = assistantText ? assistantText.trim().slice(0, 200) : undefined
        const reflection = this.reflect(actions, observations, productive)
        this.log('debug', 'step.reflection', runId, {
          step: index,
          phase: 'reflection',
          productive,
          reflection
        })

        steps.push({
          index,
          startedAt: startedStepAt,
          finishedAt: this.now(),
          thought: assistantText,
          actions,
          observations,
          reflection,
          productive
        })

        // ---- Loop detection ----
        const loop = loopDetector.observe({
          signatures: actions.map((action) => action.signature),
          productive,
          failures,
          newAction,
          ...(reasoningSignature ? { reasoningSignature } : {})
        })
        if (loop.warnings.length > 0) {
          warnings.push(...loop.warnings)
          for (const warning of loop.warnings) {
            this.log('warn', 'loop.warning', runId, {
              step: index,
              kind: warning.kind,
              count: warning.count,
              signature: warning.signature
            })
          }
        }
        if (loop.hint) context.appendHint(loop.hint)
        if (loop.stop) {
          const reason = loop.stopReason ?? 'repeated_action'
          this.log('warn', 'loop.stop', runId, { step: index, reason })
          stopInfo = this.buildStopInfo(reason, steps)
          status = 'needs_input'
          message = stopInfo.message
          finalAnswer = null
          break
        }
        if (loop.shouldAskUser) {
          this.log('warn', 'loop.needs_input', runId, {
            step: index,
            noProgressSteps: loopDetector.noProgressSteps
          })
          status = 'needs_input'
          message =
            `Stopped after ${loopDetector.noProgressSteps} steps without progress. ` +
            'Provide guidance to continue.'
          finalAnswer = null
          break
        }

        if (options.signal?.aborted) {
          status = 'aborted'
          message = 'Run aborted by caller'
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

    const result = this.finish(
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
    await this.persistSession(context, task, result, options.resumeSessionId)
    return result
  }

  /** Compact the context when it crosses the token threshold (best-effort). */
  private async maybeCompact(
    context: ContextManager,
    summarizer: ContextSummarizer,
    runId: string,
    step: number
  ): Promise<void> {
    if (!context.needsCompaction()) return
    const tokensBefore = context.estimateTokens()
    try {
      const result = await context.compact(summarizer)
      if (!result) return
      this.log('info', 'context.compacted', runId, {
        step,
        droppedMessages: result.droppedMessages,
        tokensBefore: result.tokensBefore,
        tokensAfter: result.tokensAfter
      })
    } catch (error) {
      // Compaction is an optimization: never fail a run because it failed.
      this.log('warn', 'context.compaction_failed', runId, {
        step,
        tokensBefore,
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  /** Persist the run's session (best-effort) when a store is configured. */
  private async persistSession(
    context: ContextManager,
    task: string,
    result: AgentRunResult,
    resumeSessionId?: string
  ): Promise<void> {
    if (!this.sessionStore) return
    const snapshot = context.snapshot()
    const session: AgentSession = {
      id: this.sessionId ?? resumeSessionId ?? result.runId,
      version: SESSION_SCHEMA_VERSION,
      task,
      status: result.status,
      createdAt: result.startedAt,
      updatedAt: result.finishedAt,
      messages: snapshot.messages,
      summary: snapshot.summary,
      result
    }
    try {
      await this.sessionStore.save(session)
      this.log('info', 'session.saved', result.runId, { sessionId: session.id })
    } catch (error) {
      this.log('warn', 'session.save_failed', result.runId, {
        sessionId: session.id,
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private finish(
    runId: string,
    task: string,
    status: AgentStatus,
    steps: AgentStep[],
    finalAnswer: string | null,
    message: string | null,
    ctx: { provider?: ProviderId; sandboxId: string | null },
    warnings: LoopWarning[],
    stop: LoopStopInfo | undefined,
    usage: Usage | undefined,
    startedAt: number
  ): AgentRunResult {
    const finishedAt = this.now()
    this.log('info', 'run.end', runId, {
      status,
      steps: steps.length,
      warnings: warnings.length,
      usage
    })
    return {
      runId,
      status,
      task,
      steps,
      finalAnswer,
      message,
      sandboxId: ctx.sandboxId,
      warnings,
      ...(stop ? { stop } : {}),
      ...(usage ? { usage } : {}),
      startedAt,
      finishedAt
    }
  }

  /** Build the user-facing stop summary, including the most recent actions. */
  private buildStopInfo(reason: LoopStopInfo['reason'], steps: AgentStep[]): LoopStopInfo {
    const last = steps[steps.length - 1]
    const recentActions =
      last?.actions.map((action) => {
        const first = Object.entries(action.arguments)
          .map(([key, value]) => `${key}=${String(value).slice(0, 60)}`)
          .join(', ')
        return `${action.name}${first ? `(${first})` : ''}`
      }) ?? []
    const label: Record<LoopStopInfo['reason'], string> = {
      repeated_action: 'the same action was repeated too many times',
      failure_streak: 'several steps in a row failed',
      reasoning_loop: 'the same reasoning was repeated without a new action',
      no_progress: 'several steps in a row made no progress',
      turn_timeout: 'the turn exceeded its time budget'
    }
    return {
      reason,
      message:
        `⚠️ It looks like I got stuck: ${label[reason]}. ` +
        'I stopped so I do not keep repeating myself. Review the recent actions and ' +
        'reply with **Continue**, **Correct**, or **Stop**.',
      recentActions
    }
  }

  /** Call the model, retrying and falling back across providers. */
  private async callLlm(
    context: ContextManager,
    runId: string,
    step: number,
    options: AgentRunOptions,
    tools: ToolDefinition[] = this.tools
  ): Promise<LlmCallOutcome> {
    const messages = context.buildMessages()
    this.log('debug', 'context.sent', runId, {
      step,
      phase: 'planning',
      messages: messages.length,
      estimatedTokens: context.estimateTokens(messages)
    })

    let lastError: unknown
    for (let p = 0; p < this.providers.length; p++) {
      const entry = this.providers[p]
      for (let attempt = 1; attempt <= this.recovery.maxLlmAttempts; attempt++) {
        if (options.signal?.aborted) throw new Error('Run aborted by caller')
        try {
          const response = await entry.adapter.chat(
            {
              model: entry.config.model,
              messages,
              tools,
              toolChoice: this.planMode ? 'none' : 'auto',
              ...(options.signal ? { signal: options.signal } : {})
            },
            entry.config
          )
          return { response, provider: entry.provider }
        } catch (error) {
          lastError = error
          const code = (error as { code?: string }).code ?? 'api'
          this.log('warn', 'llm.error', runId, {
            step,
            provider: entry.provider,
            attempt,
            code,
            message: error instanceof Error ? error.message : String(error)
          })
          const plan = this.recovery.planLlmRetry(error, attempt)
          if (plan.retrySame) {
            this.log('warn', 'recovery.llm_retry', runId, {
              step,
              provider: entry.provider,
              attempt,
              delayMs: plan.delayMs,
              detail: plan.guidance,
              decision: 'retry'
            })
            await sleep(plan.delayMs, options.signal)
            continue
          }
          break
        }
      }
      const next = this.providers[p + 1]
      if (next) {
        this.log('warn', 'recovery.provider_switch', runId, {
          step,
          from: entry.provider,
          to: next.provider,
          decision: 'switch'
        })
      }
    }
    throw lastError
  }

  /**
   * Apply remote-first routing to a single action. Returns the (possibly
   * rewritten) action, or a synthetic failed observation when routing refuses.
   */
  private routeAction(action: AgentAction): { action: AgentAction } | { error: AgentToolResult } {
    if (!this.toolRouting || !action.valid) return { action }
    const decision = this.toolRouting(action.name, action.arguments)
    if (decision.kind === 'passthrough') return { action }
    if (decision.kind === 'error') {
      return {
        error: {
          actionId: action.id,
          name: action.name,
          ok: false,
          output: '',
          error: decision.message,
          code: 'blocked',
          attempts: 1,
          durationMs: 0
        }
      }
    }
    const name = decision.tool
    const args = decision.args
    return {
      action: { ...action, name, arguments: args, signature: `${name}:${stableStringify(args)}` }
    }
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

  /** Ask the approval gate (when present), then execute or block the action. */
  private async guardedExecute(
    executor: ToolExecutor,
    action: AgentAction,
    runId: string,
    step: number,
    options: AgentRunOptions
  ): Promise<AgentToolResult> {
    if (this.approvalGate) {
      let allowed = false
      try {
        allowed = await this.approvalGate(action)
      } catch {
        allowed = false
      }
      if (!allowed) {
        this.log('warn', 'action.denied', runId, { step, tool: action.name })
        return {
          actionId: action.id,
          name: action.name,
          ok: false,
          output: '',
          error: `Action "${action.name}" was not approved by the user.`,
          code: 'blocked',
          attempts: 1,
          durationMs: 0
        }
      }
    }
    return this.executeAction(executor, action, runId, step, options)
  }

  /** Execute one action, retrying transient sandbox failures. */
  /** Reads the pre-write contents of a `write_file` target ('' when new). */
  private async snapshotBefore(
    action: AgentAction,
    sandboxId: string | null
  ): Promise<string | null> {
    if (!sandboxId || action.name !== 'write_file' || !action.valid) return null
    const path = action.arguments.path
    if (typeof path !== 'string') return null
    try {
      return await this.sandbox.readFile(sandboxId, path)
    } catch {
      return ''
    }
  }

  private async executeAction(
    executor: ToolExecutor,
    action: AgentAction,
    runId: string,
    step: number,
    options: AgentRunOptions
  ): Promise<AgentToolResult> {
    let attempt = 1
    let retried = false
    let result = await executor.execute(action, {
      ...(options.signal ? { signal: options.signal } : {})
    })

    while (!result.ok && !options.signal?.aborted) {
      const plan = this.recovery.planToolRetry(result.code, attempt)
      if (!plan.retry) break
      retried = true
      this.log('warn', 'recovery.action_retry', runId, {
        step,
        tool: action.name,
        attempt,
        delayMs: plan.delayMs,
        code: result.code,
        decision: 'retry',
        ...(plan.guidance ? { message: plan.guidance } : {})
      })
      await sleep(plan.delayMs, options.signal)
      attempt += 1
      const retriedResult = await executor.execute(action, {
        ...(options.signal ? { signal: options.signal } : {})
      })
      retriedResult.attempts = attempt
      result = retriedResult
    }

    // v2.5.2: record what the run chose to do after a failure so the chat can
    // explain it. Omitted for a clean first-try success.
    const recovery: ToolRecoveryInfo | undefined = !result.ok
      ? {
          decision: retried ? 'retry' : 'stop',
          attempts: attempt,
          recovered: false,
          ...(result.code ? { code: result.code } : {})
        }
      : attempt > 1
        ? { decision: 'retry', attempts: attempt, recovered: true }
        : undefined
    if (recovery) result = { ...result, recovery }

    const detail = buildToolDetail(result)
    this.log(result.ok ? 'info' : 'error', result.ok ? 'action.ok' : 'action.error', runId, {
      step,
      tool: action.name,
      code: result.code,
      attempts: result.attempts,
      durationMs: result.durationMs,
      // Short technical cause, so the existing `message`-based card keeps working.
      ...(detail.error !== undefined ? { message: detail.error } : {}),
      ...toolDetailLogFields(detail)
    })
    this.onToolResult?.(detail)
    return result
  }

  /** A step is productive when a newly-attempted action succeeds. */
  private isProductive(
    actions: AgentAction[],
    observations: AgentToolResult[],
    observedSignatures: Set<string>
  ): boolean {
    const attemptedBefore = new Set(observedSignatures)
    for (const action of actions) observedSignatures.add(action.signature)
    return observations.some(
      (result, index) => result.ok && !attemptedBefore.has(actions[index]?.signature ?? '')
    )
  }

  private reflect(
    actions: AgentAction[],
    observations: AgentToolResult[],
    productive: boolean
  ): string {
    const failed = observations.filter((result) => !result.ok)
    const succeeded = observations.filter((result) => result.ok)
    let summary: string
    if (failed.length === 0 && succeeded.length > 0) {
      summary = `Executed ${succeeded.length} action(s): ${succeeded.map((r) => r.name).join(', ')}.`
    } else if (succeeded.length > 0 && failed.length > 0) {
      summary = `${succeeded.length} action(s) succeeded, ${failed.length} failed (${failed
        .map((r) => r.name)
        .join(', ')}).`
    } else if (failed.length > 0) {
      summary = `All ${failed.length} action(s) failed: ${failed.map((r) => `${r.name}(${r.code})`).join(', ')}.`
    } else {
      summary = `${actions.length} action(s) requested; no observations recorded.`
    }
    return productive ? summary : `No new progress. ${summary}`
  }

  /** Phase marker helper for consumers that render progress. */
  static phaseOrder(): AgentPhase[] {
    return ['planning', 'execution', 'observation', 'reflection']
  }
}
