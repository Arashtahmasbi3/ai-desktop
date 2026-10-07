import { describe, it, expect } from 'vitest'
import { AnthropicAdapter } from '@core/llm-adapters/anthropic'
import { collectStream } from '@core/llm-adapters/base'
import type { LLMConfig } from '@shared/types'
import { jsonResponse, mockFetch, sseEvent, sseResponse } from '../helpers/mock-fetch'

function config(
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>
): LLMConfig {
  return { apiKey: 'sk-ant', model: 'claude-3-5-sonnet-latest', fetchImpl }
}

describe('AnthropicAdapter', () => {
  it('posts to /messages with x-api-key and lifts system into its own field', async () => {
    const { fn, calls } = mockFetch([
      jsonResponse({
        id: 'msg_1',
        model: 'claude-3-5-sonnet-latest',
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Let me check' },
          { type: 'tool_use', id: 'tu_1', name: 'bash', input: { command: 'ls' } }
        ],
        usage: { input_tokens: 10, output_tokens: 5 }
      })
    ])

    const adapter = new AnthropicAdapter()
    const response = await adapter.chat(
      {
        model: 'claude-3-5-sonnet-latest',
        messages: [
          { role: 'system', content: 'be helpful' },
          { role: 'user', content: 'list files' },
          { role: 'tool', toolCallId: 'tu_1', content: 'file.txt' }
        ],
        tools: [{ name: 'bash', description: 'run a command', parameters: { type: 'object' } }],
        toolChoice: { name: 'bash' }
      },
      config(fn)
    )

    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages')
    expect(calls[0].headers['x-api-key']).toBe('sk-ant')
    expect(calls[0].headers['anthropic-version']).toBe('2023-06-01')

    const body = calls[0].body as Record<string, any>
    expect(body.system).toBe('be helpful')
    expect(body.messages[0]).toMatchObject({ role: 'user' })
    expect(body.messages[1].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_1' })
    expect(body.tools[0]).toMatchObject({ name: 'bash', input_schema: { type: 'object' } })
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'bash' })
    expect(body.max_tokens).toBeGreaterThan(0)

    expect(response.content).toBe('Let me check')
    expect(response.finishReason).toBe('tool_calls')
    expect(response.toolCalls).toEqual([{ id: 'tu_1', name: 'bash', arguments: '{"command":"ls"}' }])
    expect(response.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 })
  })

  it('omits tools when toolChoice is none', async () => {
    const { fn, calls } = mockFetch([jsonResponse({ content: [{ type: 'text', text: 'ok' }] })])
    await new AnthropicAdapter().chat(
      {
        model: 'claude-3-5-sonnet-latest',
        messages: [{ role: 'user', content: 'hi' }],
        tools: [{ name: 'bash', description: 'd', parameters: {} }],
        toolChoice: 'none'
      },
      config(fn)
    )
    expect((calls[0].body as Record<string, any>).tools).toBeUndefined()
  })

  it('streams text and tool_use blocks', async () => {
    const { fn } = mockFetch([
      sseResponse([
        sseEvent('message_start', { type: 'message_start', message: { usage: { input_tokens: 10 } } }),
        sseEvent('content_block_start', {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' }
        }),
        sseEvent('content_block_delta', {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Hi' }
        }),
        sseEvent('content_block_start', {
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'tool_use', id: 'tu_1', name: 'bash' }
        }),
        sseEvent('content_block_delta', {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '{"command":' }
        }),
        sseEvent('content_block_delta', {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '"ls"}' }
        }),
        sseEvent('message_delta', {
          type: 'message_delta',
          delta: { stop_reason: 'tool_use' },
          usage: { output_tokens: 5 }
        }),
        sseEvent('message_stop', { type: 'message_stop' })
      ])
    ])

    const response = await collectStream(
      new AnthropicAdapter().streamChat(
        { model: 'claude-3-5-sonnet-latest', messages: [{ role: 'user', content: 'go' }] },
        config(fn)
      ),
      'claude-3-5-sonnet-latest'
    )

    expect(response.content).toBe('Hi')
    expect(response.finishReason).toBe('tool_calls')
    expect(response.toolCalls).toEqual([
      { id: 'tu_1', name: 'bash', arguments: '{"command":"ls"}' }
    ])
    expect(response.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 })
  })

  it('reports capabilities', () => {
    const adapter = new AnthropicAdapter()
    expect(adapter.getCapabilities('claude-3-5-sonnet-latest').vision).toBe(true)
    expect(adapter.getCapabilities('claude-3-5-sonnet-latest').jsonMode).toBe(false)
    expect(adapter.getCapabilities('claude-3-5-sonnet-latest').contextWindow).toBe(200_000)
  })
})
