import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  FinishReason,
  ModelCapabilities,
  ProviderId,
  StreamEvent,
  ToolCall,
  ToolChoice,
  ToolDefinition
} from '@shared/types'
import { BaseAdapter, firstNumber, type ResolvedConfig } from './base'
import type { SSEEvent } from './sse'
import { asArray, asNumber, asRecord, asString, generateId, safeJsonParse } from './util'

const ANTHROPIC_VERSION = '2023-06-01'
const DEFAULT_MAX_TOKENS = 4096

export function mapAnthropicFinishReason(reason: string | undefined): FinishReason {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop'
    case 'max_tokens':
      return 'length'
    case 'tool_use':
      return 'tool_calls'
    default:
      return 'unknown'
  }
}

interface AnthropicBody {
  system?: string
  messages: Record<string, unknown>[]
}

export function toAnthropicMessages(messages: ChatMessage[]): AnthropicBody {
  const systemParts: string[] = []
  const converted: Record<string, unknown>[] = []

  for (const message of messages) {
    if (message.role === 'system') {
      if (message.content) systemParts.push(message.content)
      continue
    }
    if (message.role === 'tool') {
      converted.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: message.toolCallId ?? '',
            content: message.content ?? ''
          }
        ]
      })
      continue
    }
    if (message.role === 'assistant') {
      const blocks: Record<string, unknown>[] = []
      if (message.content) blocks.push({ type: 'text', text: message.content })
      for (const call of message.toolCalls ?? []) {
        blocks.push({
          type: 'tool_use',
          id: call.id,
          name: call.name,
          input: safeJsonParse<Record<string, unknown>>(call.arguments, {})
        })
      }
      converted.push({ role: 'assistant', content: blocks })
      continue
    }
    converted.push({ role: 'user', content: [{ type: 'text', text: message.content ?? '' }] })
  }

  const body: AnthropicBody = { messages: converted }
  if (systemParts.length > 0) body.system = systemParts.join('\n\n')
  return body
}

export function toAnthropicTools(tools: ToolDefinition[]): Record<string, unknown>[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters
  }))
}

export function toAnthropicToolChoice(choice: ToolChoice): unknown {
  if (choice === 'auto') return { type: 'auto' }
  if (choice === 'required') return { type: 'any' }
  if (typeof choice === 'object') return { type: 'tool', name: choice.name }
  return undefined
}

export class AnthropicAdapter extends BaseAdapter {
  readonly provider: ProviderId = 'anthropic'
  readonly defaultBaseUrl: string = 'https://api.anthropic.com/v1'

  getCapabilities(model: string): ModelCapabilities {
    const vision = /claude-3|claude-4|claude-sonnet|claude-opus|claude-haiku/.test(model)
    return {
      streaming: true,
      toolCalling: true,
      vision,
      jsonMode: false,
      contextWindow: 200_000,
      maxOutputTokens: 8_192
    }
  }

  protected buildHeaders(config: ResolvedConfig): Record<string, string> {
    return {
      'content-type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      ...config.headers
    }
  }

  protected chatEndpoint(
    _request: ChatRequest,
    config: ResolvedConfig,
    _stream: boolean
  ): string {
    return `${config.baseUrl}/messages`
  }

  protected buildChatBody(request: ChatRequest, stream: boolean): Record<string, unknown> {
    const converted = toAnthropicMessages(request.messages)
    const body: Record<string, unknown> = {
      model: request.model,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: converted.messages
    }
    if (converted.system) body.system = converted.system
    if (stream) body.stream = true
    if (request.temperature !== undefined) body.temperature = request.temperature
    if (request.tools?.length && request.toolChoice !== 'none') {
      body.tools = toAnthropicTools(request.tools)
      const choice = request.toolChoice ? toAnthropicToolChoice(request.toolChoice) : undefined
      if (choice) body.tool_choice = choice
    }
    return body
  }

  protected parseChatResponse(json: unknown, request: ChatRequest): ChatResponse {
    const root = asRecord(json)
    let content = ''
    const toolCalls: ToolCall[] = []
    for (const raw of asArray(root.content)) {
      const block = asRecord(raw)
      if (block.type === 'text') content += asString(block.text) ?? ''
      if (block.type === 'tool_use') {
        toolCalls.push({
          id: asString(block.id) ?? generateId('call'),
          name: asString(block.name) ?? '',
          arguments: JSON.stringify(block.input ?? {})
        })
      }
    }
    const usage = asRecord(root.usage)
    const input = asNumber(usage.input_tokens)
    const output = asNumber(usage.output_tokens)
    return {
      id: asString(root.id) ?? generateId('resp'),
      model: asString(root.model) ?? request.model,
      content: content.length > 0 ? content : null,
      toolCalls,
      finishReason: mapAnthropicFinishReason(asString(root.stop_reason)),
      usage:
        input === undefined && output === undefined
          ? undefined
          : {
              promptTokens: input ?? 0,
              completionTokens: output ?? 0,
              totalTokens: (input ?? 0) + (output ?? 0)
            }
    }
  }

  protected parseStreamEvent(event: SSEEvent): StreamEvent[] {
    const data = event.data.trim()
    if (data === '') return []
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      return []
    }
    const root = asRecord(payload)
    const type = asString(root.type) ?? event.event ?? ''
    const events: StreamEvent[] = []

    switch (type) {
      case 'message_start': {
        const usage = asRecord(asRecord(root.message).usage)
        const input = firstNumber(usage.input_tokens)
        if (input !== undefined) {
          events.push({
            type: 'usage',
            usage: { promptTokens: input, completionTokens: 0, totalTokens: input }
          })
        }
        break
      }
      case 'content_block_start': {
        const block = asRecord(root.content_block)
        if (block.type === 'tool_use') {
          events.push({
            type: 'tool_call',
            index: firstNumber(root.index) ?? 0,
            id: asString(block.id),
            name: asString(block.name)
          })
        }
        break
      }
      case 'content_block_delta': {
        const delta = asRecord(root.delta)
        if (delta.type === 'text_delta') {
          const text = asString(delta.text)
          if (text) events.push({ type: 'text', text })
        } else if (delta.type === 'input_json_delta') {
          events.push({
            type: 'tool_call',
            index: firstNumber(root.index) ?? 0,
            argumentsDelta: asString(delta.partial_json)
          })
        }
        break
      }
      case 'message_delta': {
        const usage = asRecord(root.usage)
        const output = firstNumber(usage.output_tokens)
        if (output !== undefined) {
          events.push({
            type: 'usage',
            usage: { promptTokens: 0, completionTokens: output, totalTokens: output }
          })
        }
        const stop = asString(asRecord(root.delta).stop_reason)
        if (stop) events.push({ type: 'done', finishReason: mapAnthropicFinishReason(stop) })
        break
      }
      case 'error': {
        const error = asRecord(root.error)
        throw new Error(asString(error.message) ?? 'Anthropic stream error')
      }
      default:
        break
    }
    return events
  }
}
