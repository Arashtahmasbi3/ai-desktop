/**
 * Key health reporting (v3.1).
 *
 * The key pool knows how to park and rotate credentials, but nothing told it what happened. This
 * decorator is that link: it wraps a provider adapter, reports the outcome of each call against the
 * key that was handed out, and otherwise stays completely transparent.
 *
 * Two rules it must never break:
 *
 *  - **It never swallows an error.** The orchestrator's recovery (retry, switch provider, honour
 *    `Retry-After`) depends on the exact error travelling up untouched, so the original object is
 *    rethrown, not a copy.
 *  - **It covers the streaming path too.** Streaming is what the chat UI actually uses; a 429
 *    there must park the key just like a non-streaming call. That includes a failure *mid-stream*,
 *    after events have already been yielded.
 */
import type { BaseLLMAdapter, ChatRequest, ChatResponse, LLMConfig, ModelCapabilities, StreamEvent, ValidationResult } from '@shared/types'
import { LLMError } from './errors'
import type { KeyPool } from './key-pool'

/** The wait a provider asked for, when the error carries one. */
export function retryAfterOf(error: unknown): number | undefined {
  if (error instanceof LLMError && typeof error.retryAfterMs === 'number' && error.retryAfterMs > 0) {
    return error.retryAfterMs
  }
  return undefined
}

export function withKeyHealth(
  adapter: BaseLLMAdapter,
  pool: KeyPool,
  keyId: string
): BaseLLMAdapter {
  const fail = (error: unknown): never => {
    const retryAfterMs = retryAfterOf(error)
    pool.reportFailure(keyId, retryAfterMs !== undefined ? { retryAfterMs } : {})
    throw error
  }

  return {
    provider: adapter.provider,
    defaultBaseUrl: adapter.defaultBaseUrl,

    async chat(request: ChatRequest, config: LLMConfig): Promise<ChatResponse> {
      try {
        const response = await adapter.chat(request, config)
        pool.reportSuccess(keyId)
        return response
      } catch (error) {
        return fail(error)
      }
    },

    async *streamChat(request: ChatRequest, config: LLMConfig): AsyncIterable<StreamEvent> {
      let finished = false
      try {
        for await (const event of adapter.streamChat(request, config)) {
          yield event
        }
        finished = true
      } catch (error) {
        // Covers both "failed before the first token" and "died mid-stream": either way this key
        // was the one that failed, and the caller still gets the original error.
        return fail(error)
      }
      if (finished) pool.reportSuccess(keyId)
    },

    getCapabilities(model: string): ModelCapabilities {
      return adapter.getCapabilities(model)
    },

    validateConfig(config: LLMConfig): ValidationResult {
      return adapter.validateConfig(config)
    }
  }
}
