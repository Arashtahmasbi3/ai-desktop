import type {
  BaseLLMAdapter,
  ChatRequest,
  ChatResponse,
  LLMConfig,
  ModelCapabilities,
  ProviderId,
  StreamEvent,
  ToolCall,
  ValidationResult
} from '@shared/types'

/** One scripted reply the adapter should return (or throw) for a `chat` call. */
export interface ScriptedTurn {
  content?: string | null
  toolCalls?: ToolCall[]
  usage?: ChatResponse['usage']
  /** When set, the adapter throws this instead of returning a response. */
  error?: unknown
}

let callCounter = 0

export function toolCall(name: string, args: Record<string, unknown>, id?: string): ToolCall {
  return { id: id ?? `call-${++callCounter}`, name, arguments: JSON.stringify(args) }
}

/** A tool call whose arguments string is emitted verbatim (for malformed JSON). */
export function rawToolCall(name: string, rawArguments: string, id?: string): ToolCall {
  return { id: id ?? `call-${++callCounter}`, name, arguments: rawArguments }
}

/**
 * A deterministic `BaseLLMAdapter` that replays a queue of scripted turns and
 * records every request. It is the LLM boundary, so orchestrator logic is
 * exercised end to end without any network.
 */
export class ScriptedAdapter implements BaseLLMAdapter {
  readonly calls: ChatRequest[] = []
  private readonly queue: ScriptedTurn[]

  constructor(
    readonly provider: ProviderId,
    turns: ScriptedTurn[],
    readonly defaultBaseUrl = 'https://example.test/v1'
  ) {
    this.queue = [...turns]
  }

  get remaining(): number {
    return this.queue.length
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    this.calls.push(request)
    const turn = this.queue.shift()
    if (!turn) throw new Error(`ScriptedAdapter(${this.provider}): no scripted turn left`)
    if (turn.error) throw turn.error
    const toolCalls = turn.toolCalls ?? []
    return {
      id: `${this.provider}-${this.calls.length}`,
      model: request.model,
      content: turn.content ?? null,
      toolCalls,
      finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
      ...(turn.usage ? { usage: turn.usage } : {})
    }
  }

  async *streamChat(_request: ChatRequest, _config: LLMConfig): AsyncIterable<StreamEvent> {
    // The orchestrator calls chat(); streaming is not exercised here.
  }

  getCapabilities(_model: string): ModelCapabilities {
    return {
      streaming: true,
      toolCalling: true,
      vision: false,
      jsonMode: false,
      contextWindow: 64_000
    }
  }

  validateConfig(_config: LLMConfig): ValidationResult {
    return { valid: true, errors: [] }
  }
}
