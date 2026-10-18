/**
 * One planning call, with retry and provider fallback (F0-4 extraction).
 *
 * The providers, the retry budget, the plan-mode flag and the log sink arrive as
 * arguments instead of being read off the orchestrator; the retry-then-fall-back
 * order is unchanged.
 */
import type { ChatResponse, ProviderId, ToolDefinition } from '@shared/types'
import type { AgentRunOptions, ProviderEntry } from '@shared/agent'
import { sleep } from '@core/llm-adapters'
import type { ContextManager } from './context-manager'
import type { ErrorRecovery } from './error-recovery'
import type { OrchestratorLog } from './orchestrator-log'

export interface LlmCallOutcome {
  response: ChatResponse
  provider: ProviderId
}

/** What a call needs from the orchestrator (passed explicitly: it reads four fields). */
export interface LlmCallDeps {
  providers: ProviderEntry[]
  recovery: ErrorRecovery
  planMode: boolean
  log: OrchestratorLog
}

/** Call the model, retrying and falling back across providers. */
export async function callLlm(
  deps: LlmCallDeps,
  context: ContextManager,
  runId: string,
  step: number,
  options: AgentRunOptions,
  tools: ToolDefinition[]
): Promise<LlmCallOutcome> {
  const messages = context.buildMessages()
  deps.log('debug', 'context.sent', runId, {
    step,
    phase: 'planning',
    messages: messages.length,
    estimatedTokens: context.estimateTokens(messages)
  })

  let lastError: unknown
  for (let p = 0; p < deps.providers.length; p++) {
    const entry = deps.providers[p]
    // v2.6.5: a config with `maxLlmAttempts <= 0` skipped this loop entirely, so
    // the function ended in `throw undefined` ("LLM call failed: undefined").
    const attempts = Math.max(1, deps.recovery.maxLlmAttempts)
    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (options.signal?.aborted) throw new Error('Run aborted by caller')
      try {
        const response = await entry.adapter.chat(
          {
            model: entry.config.model,
            messages,
            tools,
            toolChoice: deps.planMode ? 'none' : 'auto',
            ...(options.signal ? { signal: options.signal } : {})
          },
          entry.config
        )
        return { response, provider: entry.provider }
      } catch (error) {
        lastError = error
        const code = (error as { code?: string }).code ?? 'api'
        deps.log('warn', 'llm.error', runId, {
          step,
          provider: entry.provider,
          attempt,
          code,
          message: error instanceof Error ? error.message : String(error)
        })
        const plan = deps.recovery.planLlmRetry(error, attempt)
        if (plan.retrySame) {
          deps.log('warn', 'recovery.llm_retry', runId, {
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
    const next = deps.providers[p + 1]
    if (next) {
      deps.log('warn', 'recovery.provider_switch', runId, {
        step,
        from: entry.provider,
        to: next.provider,
        decision: 'switch'
      })
    }
  }
  throw lastError ?? new Error('No LLM provider was available to run this step')
}
