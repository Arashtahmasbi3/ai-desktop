import type {
  CreateSandboxOptions,
  SandboxManager,
  SandboxProvider
} from '@shared/sandbox'
import type {
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
  LoopWarning,
  ProviderEntry
} from '@shared/agent'
export type { ProviderEntry }
import { sleep } from '@core/llm-adapters'
import { ContextManager } from './agent/context-manager'
import { ErrorRecovery, guidanceForToolError } from './agent/error-recovery'
import { LoopDetector } from './agent/loop-detector'
import { silentLogger } from './agent/logger'
import { SANDBOX_TOOLS, SandboxToolExecutor, actionFromToolCall } from './agent/tools'

export interface AgentOrchestratorOptions {
  sandbox: SandboxManager
  providers: ProviderEntry[]
  logger?: AgentLogger
  /** Tools exposed to the model (defaults to {@link SANDBOX_TOOLS}). */
  tools?: ToolDefinition[]
  /** Maximum number of plan/execute cycles before stopping. Default 12. */
  maxSteps?: number
  /** Character budget for history sent to the model. */
  contextMaxChars?: number
  /** Default per-command timeout inside the sandbox (ms). */
  commandTimeoutMs?: number
  loopPolicy?: Partial<LoopDetectionPolicy>
  recoveryPolicy?: Partial<AgentRecoveryPolicy>
  /** Extra options merged into `createSandbox`. */
  sandboxOptions?: CreateSandboxOptions
  now?: () => number
  runIdFactory?: () => string
}

const DEFAULT_MAX_STEPS = 12
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000

function addUsage(total: Usage | undefined, next: Usage | undefined): Usage | undefined {
  if (!next) return total
  if (!total) return { ...next }
  return {
    promptTokens: total.promptTokens + next.promptTokens,
    completionTokens: total.completionTokens + next.completionTokens,
    totalTokens: total.totalTokens + next.totalTokens
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

export function buildSystemPrompt(provider: SandboxProvider, tools: ToolDefinition[]): string {
  return `You are AI Desktop, an autonomous coding agent working inside a sandbox.

# Environment
- You operate inside an isolated "${provider}" sandbox workspace. The host filesystem is NOT accessible.
- Every path you use is relative to the workspace root (for example "hello.txt", "src/app.js").
- Network access is disabled by default.

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
- Reply in the same language the user wrote in (Persian or English).`
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
  private readonly maxSteps: number
  private readonly contextMaxChars?: number
  private readonly commandTimeoutMs: number
  private readonly loopDetector: LoopDetector
  private readonly recovery: ErrorRecovery
  private readonly sandboxOptions: CreateSandboxOptions
  private readonly now: () => number
  private readonly runIdFactory: () => string
  private readonly observedSignatures = new Set<string>()
  private runCounter = 0

  constructor(options: AgentOrchestratorOptions) {
    if (options.providers.length === 0) {
      throw new Error('AgentOrchestrator requires at least one provider')
    }
    this.sandbox = options.sandbox
    this.providers = [...options.providers]
    this.logger = options.logger ?? silentLogger
    this.tools = options.tools ?? SANDBOX_TOOLS
    this.maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS
    this.contextMaxChars = options.contextMaxChars
    this.commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS
    this.loopDetector = new LoopDetector(options.loopPolicy)
    this.recovery = new ErrorRecovery(options.recoveryPolicy)
    this.sandboxOptions = options.sandboxOptions ?? {}
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
        usage,
        startedAt
      )
    }

    const executor = new SandboxToolExecutor(this.sandbox, sandboxId, this.commandTimeoutMs)
    const context = new ContextManager({
      systemPrompt: buildSystemPrompt(provider, this.tools),
      ...(this.contextMaxChars !== undefined ? { maxChars: this.contextMaxChars } : {})
    })
    context.appendUser(task)
    this.log('debug', 'context.built', runId, {
      messages: context.length,
      estimatedTokens: context.estimateTokens()
    })

    let status: AgentStatus = 'max_steps'
    let finalAnswer: string | null = null
    let message: string | null = null

    try {
      for (let index = 0; index < this.maxSteps; index++) {
        if (options.signal?.aborted) {
          status = 'aborted'
          message = 'Run aborted by caller'
          break
        }

        const startedStepAt = this.now()
        this.log('debug', 'step.start', runId, { step: index, phase: 'planning' })

        // ---- Planning: ask the model (with provider fallback) ----
        const outcome = await this.callLlm(context, runId, index, options)
        providerUsed = outcome.provider
        usage = addUsage(usage, outcome.response.usage)
        const assistantText = outcome.response.content
        const toolCalls = outcome.response.toolCalls ?? []

        if (toolCalls.length === 0) {
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
        const actions = toolCalls.map(actionFromToolCall)
        context.appendAssistant(assistantText, toolCalls)
        this.log('debug', 'step.execution', runId, {
          step: index,
          phase: 'execution',
          actions: actions.map((action) => action.name)
        })

        const observations: AgentToolResult[] = []
        for (const action of actions) {
          if (options.signal?.aborted) break
          const result = await this.executeAction(executor, action, runId, index, options)
          observations.push(result)
          context.appendToolResult({
            toolCallId: action.id,
            name: action.name,
            content: formatObservation(result)
          })
        }

        // ---- Observation + Reflection ----
        const productive = this.isProductive(actions, observations)
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
        const loop = this.loopDetector.observe({
          signatures: actions.map((action) => action.signature),
          productive
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
        if (loop.shouldAskUser) {
          this.log('warn', 'loop.needs_input', runId, {
            step: index,
            noProgressSteps: this.loopDetector.noProgressSteps
          })
          status = 'needs_input'
          message =
            `Stopped after ${this.loopDetector.noProgressSteps} steps without progress. ` +
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
      return this.finish(
        runId,
        task,
        'failed',
        steps,
        finalAnswer,
        `LLM call failed: ${text}`,
        { provider: providerUsed, sandboxId },
        warnings,
        usage,
        startedAt
      )
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

    return this.finish(
      runId,
      task,
      status,
      steps,
      finalAnswer,
      message,
      { provider: providerUsed, sandboxId },
      warnings,
      usage,
      startedAt
    )
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
      ...(usage ? { usage } : {}),
      startedAt,
      finishedAt
    }
  }

  /** Call the model, retrying and falling back across providers. */
  private async callLlm(
    context: ContextManager,
    runId: string,
    step: number,
    options: AgentRunOptions
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
              tools: this.tools,
              toolChoice: 'auto',
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
              detail: plan.guidance
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
          to: next.provider
        })
      }
    }
    throw lastError
  }

  /** Execute one action, retrying transient sandbox failures. */
  private async executeAction(
    executor: SandboxToolExecutor,
    action: AgentAction,
    runId: string,
    step: number,
    options: AgentRunOptions
  ): Promise<AgentToolResult> {
    let attempt = 1
    let result = await executor.execute(action, {
      ...(options.signal ? { signal: options.signal } : {})
    })

    while (!result.ok && !options.signal?.aborted) {
      const plan = this.recovery.planToolRetry(result.code, attempt)
      if (!plan.retry) break
      this.log('warn', 'recovery.action_retry', runId, {
        step,
        tool: action.name,
        attempt,
        delayMs: plan.delayMs,
        code: result.code
      })
      await sleep(plan.delayMs, options.signal)
      attempt += 1
      const retried = await executor.execute(action, {
        ...(options.signal ? { signal: options.signal } : {})
      })
      retried.attempts = attempt
      result = retried
    }

    this.log(result.ok ? 'info' : 'error', result.ok ? 'action.ok' : 'action.error', runId, {
      step,
      tool: action.name,
      code: result.code,
      attempts: result.attempts,
      durationMs: result.durationMs
    })
    return result
  }

  /** A step is productive when a newly-attempted action succeeds. */
  private isProductive(
    actions: AgentAction[],
    observations: AgentToolResult[]
  ): boolean {
    const attemptedBefore = new Set(this.observedSignatures)
    for (const action of actions) this.observedSignatures.add(action.signature)
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
