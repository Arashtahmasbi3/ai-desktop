import type {
  BaseLLMAdapter,
  ChatRequest,
  ChatResponse,
  FetchLike,
  FinishReason,
  LLMConfig,
  ModelCapabilities,
  ProviderId,
  StreamEvent,
  ToolCall,
  Usage,
  ValidationResult
} from '@shared/types'
import { ConfigError } from './errors'
import {
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT_MS,
  getGlobalFetch,
  httpJson,
  httpStream,
  type HttpCallOptions
} from './http'
import { iterateSSE, type SSEEvent } from './sse'
import { asNumber } from './util'

export interface ResolvedConfig {
  apiKey: string
  model: string
  baseUrl: string
  headers: Record<string, string>
  timeoutMs: number
  maxRetries: number
  fetchImpl: FetchLike
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

/**
 * Shared machinery for provider adapters: config resolution, validation,
 * the generic `chat`/`streamChat` flow and error plumbing. Subclasses only
 * supply the provider-specific request/response translation.
 */
export abstract class BaseAdapter implements BaseLLMAdapter {
  abstract readonly provider: ProviderId
  abstract readonly defaultBaseUrl: string

  abstract getCapabilities(model: string): ModelCapabilities

  validateConfig(config: LLMConfig): ValidationResult {
    const errors: string[] = []
    if (!config || typeof config !== 'object') {
      return { valid: false, errors: ['config is required'] }
    }
    if (!config.apiKey || config.apiKey.trim() === '') errors.push('apiKey is required')
    if (!config.model || config.model.trim() === '') errors.push('model is required')
    const baseUrl = config.baseUrl ?? this.defaultBaseUrl
    try {
      new URL(baseUrl)
    } catch {
      errors.push(`baseUrl is not a valid URL: ${baseUrl}`)
    }
    return { valid: errors.length === 0, errors }
  }

  protected resolve(config: LLMConfig): ResolvedConfig {
    const validation = this.validateConfig(config)
    if (!validation.valid) {
      throw new ConfigError(`${this.provider}: ${validation.errors.join('; ')}`, {
        provider: this.provider
      })
    }
    if (!config.fetchImpl && typeof (globalThis as { fetch?: unknown }).fetch !== 'function') {
      throw new ConfigError('No fetch implementation available', { provider: this.provider })
    }
    return {
      apiKey: config.apiKey,
      model: config.model,
      baseUrl: trimTrailingSlash(config.baseUrl ?? this.defaultBaseUrl),
      headers: config.headers ?? {},
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
      fetchImpl: config.fetchImpl ?? getGlobalFetch()
    }
  }

  protected httpOptions(config: ResolvedConfig, signal?: AbortSignal): HttpCallOptions {
    return {
      provider: this.provider,
      timeoutMs: config.timeoutMs,
      maxRetries: config.maxRetries,
      fetchImpl: config.fetchImpl,
      signal
    }
  }

  async chat(request: ChatRequest, config: LLMConfig): Promise<ChatResponse> {
    const resolved = this.resolve(config)
    const url = this.chatEndpoint(request, resolved, false)
    const json = await httpJson(
      url,
      {
        method: 'POST',
        headers: this.buildHeaders(resolved),
        body: JSON.stringify(this.buildChatBody(request, false))
      },
      this.httpOptions(resolved, request.signal)
    )
    return this.parseChatResponse(json, request)
  }

  async *streamChat(request: ChatRequest, config: LLMConfig): AsyncIterable<StreamEvent> {
    const resolved = this.resolve(config)
    const url = this.chatEndpoint(request, resolved, true)
    const response = await httpStream(
      url,
      {
        method: 'POST',
        headers: this.buildHeaders(resolved),
        body: JSON.stringify(this.buildChatBody(request, true))
      },
      { ...this.httpOptions(resolved, request.signal), maxRetries: 0 }
    )
    for await (const event of iterateSSE(response)) {
      for (const streamEvent of this.parseStreamEvent(event)) {
        yield streamEvent
      }
    }
  }

  /** Provider-specific request headers (auth, versioning, ...). */
  protected abstract buildHeaders(config: ResolvedConfig): Record<string, string>

  /** Full URL for the chat/completions endpoint. */
  protected abstract chatEndpoint(
    request: ChatRequest,
    config: ResolvedConfig,
    stream: boolean
  ): string

  /** Build the provider-specific JSON request body. */
  protected abstract buildChatBody(
    request: ChatRequest,
    stream: boolean
  ): Record<string, unknown>

  /** Convert a provider response payload into a `ChatResponse`. */
  protected abstract parseChatResponse(json: unknown, request: ChatRequest): ChatResponse

  /** Convert one SSE event into zero or more `StreamEvent`s. */
  protected abstract parseStreamEvent(event: SSEEvent): StreamEvent[]
}

/** Fold a stream of `StreamEvent`s into a single `ChatResponse`. */
export async function collectStream(
  events: AsyncIterable<StreamEvent>,
  model = ''
): Promise<ChatResponse> {
  let content = ''
  const toolCalls: ToolCall[] = []
  let finishReason: FinishReason = 'unknown'
  let hasUsage = false
  let promptTokens = 0
  let completionTokens = 0
  let totalTokens = 0

  for await (const event of events) {
    switch (event.type) {
      case 'text':
        content += event.text
        break
      case 'tool_call': {
        const slot = toolCalls[event.index] ?? {
          id: '',
          name: '',
          arguments: ''
        }
        if (event.id) slot.id = event.id
        if (event.name) slot.name = event.name
        if (event.argumentsDelta) slot.arguments += event.argumentsDelta
        toolCalls[event.index] = slot
        break
      }
      case 'usage':
        hasUsage = true
        promptTokens = Math.max(promptTokens, event.usage.promptTokens)
        completionTokens = Math.max(completionTokens, event.usage.completionTokens)
        totalTokens = Math.max(totalTokens, event.usage.totalTokens)
        break
      case 'done':
        finishReason = event.finishReason
        break
    }
  }

  const usage = hasUsage
    ? {
        promptTokens,
        completionTokens,
        totalTokens: Math.max(totalTokens, promptTokens + completionTokens)
      }
    : undefined

  return {
    id: '',
    model,
    content: content.length > 0 ? content : null,
    toolCalls: toolCalls.filter((call): call is ToolCall => Boolean(call)),
    finishReason,
    usage
  }
}

export function usageFrom(
  prompt: number | undefined,
  completion: number | undefined
): Usage | undefined {
  if (prompt === undefined && completion === undefined) return undefined
  const p = prompt ?? 0
  const c = completion ?? 0
  return { promptTokens: p, completionTokens: c, totalTokens: p + c }
}

export function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const n = asNumber(value)
    if (n !== undefined) return n
  }
  return undefined
}
