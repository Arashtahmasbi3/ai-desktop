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
import { asArray, asNumber, asRecord, asString, generateId } from './util'

export function mapOpenAIFinishReason(reason: string | undefined): FinishReason {
  switch (reason) {
    case 'stop':
      return 'stop'
    case 'length':
      return 'length'
    case 'tool_calls':
    case 'function_call':
      return 'tool_calls'
    case 'content_filter':
      return 'content_filter'
    default:
      return 'unknown'
  }
}

export function toOpenAIMessages(messages: ChatMessage[]): Record<string, unknown>[] {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: message.toolCallId ?? '',
        content: message.content ?? ''
      }
    }
    if (message.role === 'assistant' && message.toolCalls?.length) {
      return {
        role: 'assistant',
        content: message.content ?? null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.arguments }
        }))
      }
    }
    return { role: message.role, content: message.content ?? '' }
  })
}

export function toOpenAITools(tools: ToolDefinition[]): Record<string, unknown>[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }))
}

export function toOpenAIToolChoice(choice: ToolChoice): unknown {
  if (typeof choice === 'object') {
    return { type: 'function', function: { name: choice.name } }
  }
  return choice
}

export class OpenAIAdapter extends BaseAdapter {
  readonly provider: ProviderId = 'openai'
  readonly defaultBaseUrl: string = 'https://api.openai.com/v1'

  getCapabilities(model: string): ModelCapabilities {
    const vision = /gpt-4o|gpt-4\.1|gpt-4-turbo|o1|o3|o4/.test(model)
    return {
      streaming: true,
      toolCalling: true,
      vision,
      jsonMode: true,
      contextWindow: vision ? 128_000 : 16_385,
      maxOutputTokens: 16_384
    }
  }

  protected buildHeaders(config: ResolvedConfig): Record<string, string> {
    return {
      'content-type': 'application/json',
      authorization: `Bearer ${config.apiKey}`,
      ...config.headers
    }
  }

  protected chatEndpoint(
    _request: ChatRequest,
    config: ResolvedConfig,
    _stream: boolean
  ): string {
    return `${config.baseUrl}/chat/completions`
  }

  protected buildChatBody(request: ChatRequest, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: toOpenAIMessages(request.messages)
    }
    if (stream) {
      body.stream = true
      body.stream_options = { include_usage: true }
    }
    if (request.temperature !== undefined) body.temperature = request.temperature
    if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens
    if (request.tools?.length) {
      body.tools = toOpenAITools(request.tools)
      if (request.toolChoice) body.tool_choice = toOpenAIToolChoice(request.toolChoice)
    }
    return body
  }

  protected parseChatResponse(json: unknown, request: ChatRequest): ChatResponse {
    const root = asRecord(json)
    const choice = asRecord(asArray(root.choices)[0])
    const message = asRecord(choice.message)
    const toolCalls: ToolCall[] = asArray(message.tool_calls).map((raw) => {
      const call = asRecord(raw)
      const fn = asRecord(call.function)
      return {
        id: asString(call.id) ?? generateId('call'),
        name: asString(fn.name) ?? '',
        arguments: asString(fn.arguments) ?? '{}'
      }
    })
    const usage = asRecord(root.usage)
    return {
      id: asString(root.id) ?? generateId('resp'),
      model: asString(root.model) ?? request.model,
      content: asString(message.content) ?? null,
      toolCalls,
      finishReason: mapOpenAIFinishReason(asString(choice.finish_reason)),
      usage:
        asNumber(usage.prompt_tokens) === undefined
          ? undefined
          : {
              promptTokens: firstNumber(usage.prompt_tokens) ?? 0,
              completionTokens: firstNumber(usage.completion_tokens) ?? 0,
              totalTokens: firstNumber(usage.total_tokens) ?? 0
            }
    }
  }

  protected parseStreamEvent(event: SSEEvent): StreamEvent[] {
    const data = event.data.trim()
    if (data === '' || data === '[DONE]') {
      return []
    }
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      return []
    }
    const root = asRecord(payload)
    const events: StreamEvent[] = []
    const choice = asRecord(asArray(root.choices)[0])
    const delta = asRecord(choice.delta)

    const text = asString(delta.content)
    if (text) events.push({ type: 'text', text })

    for (const raw of asArray(delta.tool_calls)) {
      const call = asRecord(raw)
      const fn = asRecord(call.function)
      events.push({
        type: 'tool_call',
        index: firstNumber(call.index) ?? 0,
        id: asString(call.id),
        name: asString(fn.name),
        argumentsDelta: asString(fn.arguments)
      })
    }

    const usage = asRecord(root.usage)
    if (Object.keys(usage).length > 0) {
      events.push({
        type: 'usage',
        usage: {
          promptTokens: firstNumber(usage.prompt_tokens) ?? 0,
          completionTokens: firstNumber(usage.completion_tokens) ?? 0,
          totalTokens: firstNumber(usage.total_tokens) ?? 0
        }
      })
    }

    const finish = asString(choice.finish_reason)
    if (finish) events.push({ type: 'done', finishReason: mapOpenAIFinishReason(finish) })

    return events
  }
}
