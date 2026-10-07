/**
 * Shared LLM types used across the whole app (main, renderer, core).
 * Kept dependency-free and environment-neutral (Node + browser).
 */

export type ProviderId = 'openai' | 'anthropic' | 'deepseek' | 'google'

export type Role = 'system' | 'user' | 'assistant' | 'tool'

/** A tool/function call requested by the model. */
export interface ToolCall {
  id: string
  name: string
  /** Raw JSON string of the arguments, as produced by the model. */
  arguments: string
}

/** A single message in a conversation, provider-agnostic. */
export interface ChatMessage {
  role: Role
  content: string | null
  /** Optional speaker name (also used by the `tool` role to identify the function). */
  name?: string
  /** Present on assistant messages that requested tools. */
  toolCalls?: ToolCall[]
  /** Present on `tool` messages: the id of the tool call being answered. */
  toolCallId?: string
}

/** Minimal JSON Schema shape accepted by all providers. */
export type JsonSchema = Record<string, unknown>

export interface ToolDefinition {
  name: string
  description: string
  parameters: JsonSchema
}

export type ToolChoice = 'auto' | 'none' | 'required' | { name: string }

export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  tools?: ToolDefinition[]
  toolChoice?: ToolChoice
  temperature?: number
  maxTokens?: number
  /** External cancellation signal. */
  signal?: AbortSignal
}

export type FinishReason =
  | 'stop'
  | 'length'
  | 'tool_calls'
  | 'content_filter'
  | 'error'
  | 'unknown'

export interface Usage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface ChatResponse {
  id: string
  model: string
  content: string | null
  toolCalls: ToolCall[]
  finishReason: FinishReason
  usage?: Usage
}

/** Incremental event emitted while streaming. */
export type StreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; index: number; id?: string; name?: string; argumentsDelta?: string }
  | { type: 'usage'; usage: Usage }
  | { type: 'done'; finishReason: FinishReason }

export interface ModelCapabilities {
  streaming: boolean
  toolCalling: boolean
  vision: boolean
  jsonMode: boolean
  contextWindow: number
  maxOutputTokens?: number
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface LLMConfig {
  apiKey: string
  model: string
  provider?: ProviderId
  /** Overrides the adapter's default base URL. */
  baseUrl?: string
  /** Extra headers merged into every request. */
  headers?: Record<string, string>
  timeoutMs?: number
  maxRetries?: number
  /** Injectable fetch (defaults to the global fetch) — used for testing. */
  fetchImpl?: FetchLike
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

/** The contract every provider adapter must fulfil. */
export interface BaseLLMAdapter {
  readonly provider: ProviderId
  readonly defaultBaseUrl: string

  /** Single, non-streaming completion. */
  chat(request: ChatRequest, config: LLMConfig): Promise<ChatResponse>

  /** Streaming completion as an async iterable of incremental events. */
  streamChat(request: ChatRequest, config: LLMConfig): AsyncIterable<StreamEvent>

  /** Static capabilities for a given model. */
  getCapabilities(model: string): ModelCapabilities

  /** Validate a config before use (missing key/model, malformed base URL, ...). */
  validateConfig(config: LLMConfig): ValidationResult
}
