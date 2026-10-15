/**
 * Shared LLM types used across the whole app (main, renderer, core).
 * Kept dependency-free and environment-neutral (Node + browser).
 */

import type { ImageMediaType } from './attachments'

export type ProviderId = 'openai' | 'anthropic' | 'deepseek' | 'google'

export type Role = 'system' | 'user' | 'assistant' | 'tool'

/** A tool/function call requested by the model. */
export interface ToolCall {
  id: string
  name: string
  /** Raw JSON string of the arguments, as produced by the model. */
  arguments: string
}

/**
 * v2.9.0: one part of a multimodal message.
 *
 * Text parts mirror `ChatMessage.content`; image parts carry the inline base64
 * payload the adapters translate into their own provider spelling
 * (OpenAI `image_url`, Anthropic `image` block, Google `inlineData`).
 */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: ImageMediaType; base64: string }

/** A single message in a conversation, provider-agnostic. */
export interface ChatMessage {
  role: Role
  content: string | null
  /**
   * v2.9.0: multimodal parts. Present only when the message carries an inline
   * image. `content` is deliberately kept as the canonical plain-text field
   * (dozens of consumers read it, and `context-compressor` early-returns on
   * falsy content so a parts-only message survives compression untouched).
   * When `parts` is present the adapters send *these* instead of `content`.
   */
  parts?: ContentPart[]
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
  /**
   * v2.8.0: the model's own reasoning, when the provider exposes it (DeepSeek's
   * `reasoning_content`, OpenAI-compatible `reasoning`, Anthropic `thinking` blocks).
   *
   * Reported: "I want it to show thinking, processing, etc. like you and Codex do."
   * The adapters read only `delta.content` and dropped this entirely, so there was
   * nothing to show even when the provider sent it.
   */
  reasoning?: string
}

/** Incremental event emitted while streaming. */
export type StreamEvent =
  | { type: 'text'; text: string }
  /** v2.8.0: reasoning/thinking tokens, kept separate from the answer text. */
  | { type: 'reasoning'; text: string }
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

/** A user-configured OpenAI-compatible endpoint ("Other" provider). */
export interface CustomProvider {
  id: string
  label: string
  baseUrl: string
  model: string
  /** Extra request headers (e.g. gateway routing). Never contains the API key. */
  headers?: Record<string, string>
  createdAt: number
  updatedAt: number
}

/** Public (non-secret) view of a custom provider, safe for the renderer. */
export interface CustomProviderView {
  id: string
  label: string
  baseUrl: string
  model: string
  hasApiKey: boolean
  headerCount: number
}

/** Payload for creating/updating a custom provider. */
export interface CustomProviderInput {
  /** Present when updating an existing provider. */
  id?: string
  label: string
  baseUrl: string
  model: string
  /** Plaintext key, encrypted at rest. Omit to keep the stored key on update. */
  apiKey?: string
  headers?: Record<string, string>
}

export interface CustomProviderTestResult {
  ok: boolean
  latencyMs: number
  message?: string
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
