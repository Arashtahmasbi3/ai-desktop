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
import { asArray, asRecord, asString, generateId, safeJsonParse } from './util'

export function mapGoogleFinishReason(reason: string | undefined): FinishReason {
  switch (reason) {
    case 'STOP':
      return 'stop'
    case 'MAX_TOKENS':
      return 'length'
    case 'SAFETY':
    case 'RECITATION':
    case 'BLOCKLIST':
    case 'PROHIBITED_CONTENT':
      return 'content_filter'
    default:
      return 'unknown'
  }
}

interface GoogleBody {
  systemInstruction?: { parts: { text: string }[] }
  contents: Record<string, unknown>[]
}

export function toGoogleContents(messages: ChatMessage[]): GoogleBody {
  const systemParts: string[] = []
  const contents: Record<string, unknown>[] = []

  for (const message of messages) {
    if (message.role === 'system') {
      if (message.content) systemParts.push(message.content)
      continue
    }
    if (message.role === 'tool') {
      contents.push({
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: message.name ?? message.toolCallId ?? 'tool',
              response: { result: message.content ?? '' }
            }
          }
        ]
      })
      continue
    }
    const parts: Record<string, unknown>[] = []
    if (message.content) parts.push({ text: message.content })
    for (const call of message.toolCalls ?? []) {
      parts.push({
        functionCall: {
          name: call.name,
          args: safeJsonParse<Record<string, unknown>>(call.arguments, {})
        }
      })
    }
    contents.push({ role: message.role === 'assistant' ? 'model' : 'user', parts })
  }

  const body: GoogleBody = { contents }
  if (systemParts.length > 0) body.systemInstruction = { parts: [{ text: systemParts.join('\n\n') }] }
  return body
}

export function toGoogleTools(tools: ToolDefinition[]): Record<string, unknown>[] {
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }))
    }
  ]
}

export function toGoogleToolChoice(choice: ToolChoice): string | undefined {
  if (choice === 'auto') return 'AUTO'
  if (choice === 'none') return 'NONE'
  if (choice === 'required') return 'ANY'
  if (typeof choice === 'object') return 'ANY'
  return undefined
}

export class GoogleAdapter extends BaseAdapter {
  readonly provider: ProviderId = 'google'
  readonly defaultBaseUrl: string = 'https://generativelanguage.googleapis.com/v1beta'

  getCapabilities(model: string): ModelCapabilities {
    const isPro = /pro/.test(model)
    return {
      streaming: true,
      toolCalling: true,
      vision: true,
      jsonMode: true,
      contextWindow: /gemini-2|gemini-3/.test(model) ? 1_000_000 : 128_000,
      maxOutputTokens: isPro ? 8_192 : 65_536
    }
  }

  protected buildHeaders(config: ResolvedConfig): Record<string, string> {
    return {
      'content-type': 'application/json',
      'x-goog-api-key': config.apiKey,
      ...config.headers
    }
  }

  protected chatEndpoint(request: ChatRequest, config: ResolvedConfig, stream: boolean): string {
    const method = stream ? 'streamGenerateContent' : 'generateContent'
    const suffix = stream ? '?alt=sse' : ''
    return `${config.baseUrl}/models/${encodeURIComponent(request.model)}:${method}${suffix}`
  }

  protected buildChatBody(request: ChatRequest, stream: boolean): Record<string, unknown> {
    void stream
    const converted = toGoogleContents(request.messages)
    const body: Record<string, unknown> = { contents: converted.contents }
    if (converted.systemInstruction) body.systemInstruction = converted.systemInstruction

    const generationConfig: Record<string, unknown> = {}
    if (request.temperature !== undefined) generationConfig.temperature = request.temperature
    if (request.maxTokens !== undefined) generationConfig.maxOutputTokens = request.maxTokens
    if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig

    if (request.tools?.length && request.toolChoice !== 'none') {
      body.tools = toGoogleTools(request.tools)
      const mode = request.toolChoice ? toGoogleToolChoice(request.toolChoice) : undefined
      if (mode) body.toolConfig = { functionCallingConfig: { mode } }
    }
    return body
  }

  protected parseChatResponse(json: unknown, _request: ChatRequest): ChatResponse {
    const root = asRecord(json)
    const candidate = asRecord(asArray(root.candidates)[0])
    const { content, toolCalls } = parseParts(candidate)
    const usage = asRecord(root.usageMetadata)
    const prompt = firstNumber(usage.promptTokenCount)
    const completion = firstNumber(usage.candidatesTokenCount)
    return {
      id: generateId('resp'),
      model: asString(root.modelVersion) ?? _request.model,
      content: content.length > 0 ? content : null,
      toolCalls,
      finishReason: mapGoogleFinishReason(asString(candidate.finishReason)),
      usage:
        prompt === undefined && completion === undefined
          ? undefined
          : {
              promptTokens: prompt ?? 0,
              completionTokens: completion ?? 0,
              totalTokens: firstNumber(usage.totalTokenCount) ?? (prompt ?? 0) + (completion ?? 0)
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

    const candidate = asRecord(asArray(root.candidates)[0])
    const parts = asArray(asRecord(candidate.content).parts)
    let offset = 0
    for (const raw of parts) {
      const part = asRecord(raw)
      const text = asString(part.text)
      if (text) events.push({ type: 'text', text })
      const call = asRecord(part.functionCall)
      if (Object.keys(call).length > 0) {
        events.push({
          type: 'tool_call',
          index: offset,
          id: generateId('call'),
          name: asString(call.name),
          argumentsDelta: JSON.stringify(call.args ?? {})
        })
        offset += 1
      }
    }

    const usage = asRecord(root.usageMetadata)
    if (Object.keys(usage).length > 0) {
      events.push({
        type: 'usage',
        usage: {
          promptTokens: firstNumber(usage.promptTokenCount) ?? 0,
          completionTokens: firstNumber(usage.candidatesTokenCount) ?? 0,
          totalTokens: firstNumber(usage.totalTokenCount) ?? 0
        }
      })
    }

    const finish = asString(candidate.finishReason)
    if (finish) events.push({ type: 'done', finishReason: mapGoogleFinishReason(finish) })

    return events
  }
}

function parseParts(candidate: Record<string, unknown>): { content: string; toolCalls: ToolCall[] } {
  const parts = asArray(asRecord(candidate.content).parts)
  let content = ''
  const toolCalls: ToolCall[] = []
  parts.forEach((raw, index) => {
    const part = asRecord(raw)
    const text = asString(part.text)
    if (text) content += text
    const call = asRecord(part.functionCall)
    if (Object.keys(call).length > 0) {
      toolCalls.push({
        id: generateId(`call_${index}`),
        name: asString(call.name) ?? '',
        arguments: JSON.stringify(call.args ?? {})
      })
    }
  })
  return { content, toolCalls }
}
