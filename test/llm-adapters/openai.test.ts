import { describe, it, expect } from 'vitest'
import { OpenAIAdapter } from '@core/llm-adapters/openai'
import { collectStream } from '@core/llm-adapters/base'
import type { LLMConfig } from '@shared/types'
import { jsonResponse, mockFetch, sse, sseResponse } from '../helpers/mock-fetch'

function config(
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>
): LLMConfig {
  return { apiKey: 'sk-test', model: 'gpt-4o-mini', fetchImpl }
}

describe('OpenAIAdapter', () => {
  it('posts to /chat/completions with auth and maps messages + tools', async () => {
    const { fn, calls } = mockFetch([
      jsonResponse({
        id: 'chatcmpl-1',
        model: 'gpt-4o-mini',
        choices: [{ message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 }
      })
    ])

    const adapter = new OpenAIAdapter()
    const response = await adapter.chat(
      {
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'be nice' },
          { role: 'user', content: 'hi' },
          {
            role: 'assistant',
            content: null,
            toolCalls: [{ id: 'c1', name: 'read_file', arguments: '{"path":"a"}' }]
          },
          { role: 'tool', toolCallId: 'c1', content: 'file data' }
        ],
        tools: [{ name: 'read_file', description: 'read a file', parameters: { type: 'object' } }],
        toolChoice: 'auto'
      },
      config(fn)
    )

    expect(calls[0].url).toBe('https://api.openai.com/v1/chat/completions')
    expect(calls[0].headers.authorization).toBe('Bearer sk-test')
    const body = calls[0].body as Record<string, any>
    expect(body.messages[2].tool_calls[0].function.name).toBe('read_file')
    expect(body.messages[3]).toMatchObject({ role: 'tool', tool_call_id: 'c1' })
    expect(body.tools[0].type).toBe('function')
    expect(body.tool_choice).toBe('auto')
    expect(body.stream).toBeUndefined()

    expect(response.content).toBe('hello')
    expect(response.finishReason).toBe('stop')
    expect(response.usage).toEqual({ promptTokens: 5, completionTokens: 2, totalTokens: 7 })
  })

  it('parses tool calls from a non-streaming response', async () => {
    const { fn } = mockFetch([
      jsonResponse({
        id: 'x',
        model: 'gpt-4o-mini',
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                { id: 'c1', type: 'function', function: { name: 'bash', arguments: '{"command":"ls"}' } }
              ]
            },
            finish_reason: 'tool_calls'
          }
        ]
      })
    ])

    const response = await new OpenAIAdapter().chat(
      { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'run ls' }] },
      config(fn)
    )
    expect(response.finishReason).toBe('tool_calls')
    expect(response.toolCalls).toEqual([
      { id: 'c1', name: 'bash', arguments: '{"command":"ls"}' }
    ])
  })

  it('streams text, tool call fragments and usage', async () => {
    const { fn } = mockFetch([
      sseResponse([
        sse({ choices: [{ delta: { content: 'He' } }] }),
        sse({ choices: [{ delta: { content: 'llo' } }] }),
        sse({
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: 'call_1', function: { name: 'read_file', arguments: '{"pa' } }
                ]
              }
            }
          ]
        }),
        sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"a"}' } }] } }] }),
        sse({ choices: [{ finish_reason: 'tool_calls' }] }),
        sse({ usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } }),
        'data: [DONE]\n\n'
      ])
    ])

    const stream = new OpenAIAdapter().streamChat(
      { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] },
      config(fn)
    )
    const response = await collectStream(stream, 'gpt-4o-mini')

    expect(response.content).toBe('Hello')
    expect(response.finishReason).toBe('tool_calls')
    expect(response.toolCalls).toEqual([
      { id: 'call_1', name: 'read_file', arguments: '{"path":"a"}' }
    ])
    expect(response.usage).toEqual({ promptTokens: 3, completionTokens: 4, totalTokens: 7 })
  })

  it('reports capabilities per model', () => {
    const adapter = new OpenAIAdapter()
    expect(adapter.getCapabilities('gpt-4o').vision).toBe(true)
    expect(adapter.getCapabilities('gpt-3.5-turbo').vision).toBe(false)
    expect(adapter.getCapabilities('gpt-4o').toolCalling).toBe(true)
  })

  /**
   * v2.8.0 — "show thinking, processing, etc. like you and Codex do."
   *
   * The adapters read only `content`, so a reasoning model's thinking was fetched over
   * the wire and then thrown away. It is now surfaced separately, and must never leak
   * into `content`: that field is the answer, and an assistant message built from it is
   * replayed to the provider on the next turn.
   */
  describe('reasoning (v2.8.0)', () => {
    it('reads reasoning_content from a non-streaming response without touching content', async () => {
      const { fn } = mockFetch([
        jsonResponse({
          id: 'chatcmpl-r1',
          model: 'deepseek-reasoner',
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'the answer',
                reasoning_content: 'step 1: think\nstep 2: answer'
              },
              finish_reason: 'stop'
            }
          ]
        })
      ])

      const response = await new OpenAIAdapter().chat(
        { model: 'deepseek-reasoner', messages: [{ role: 'user', content: 'hi' }] },
        config(fn)
      )

      expect(response.reasoning).toBe('step 1: think\nstep 2: answer')
      expect(response.content).toBe('the answer')
    })

    it('accepts the OpenAI-compatible `reasoning` field too', async () => {
      const { fn } = mockFetch([
        jsonResponse({
          id: 'r2',
          model: 'm',
          choices: [{ message: { role: 'assistant', content: 'ok', reasoning: 'because' } }]
        })
      ])

      const response = await new OpenAIAdapter().chat(
        { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
        config(fn)
      )
      expect(response.reasoning).toBe('because')
    })

    it('omits the field entirely when the provider sends no reasoning', async () => {
      const { fn } = mockFetch([
        jsonResponse({
          id: 'r3',
          model: 'm',
          choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }]
        })
      ])

      const response = await new OpenAIAdapter().chat(
        { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
        config(fn)
      )
      expect(response.reasoning).toBeUndefined()
      // Not `reasoning: ''` — an empty string would render an empty thinking panel.
      expect('reasoning' in response).toBe(false)
    })

    it('accumulates streamed reasoning separately from the answer', async () => {
      const { fn } = mockFetch([
        sseResponse([
          sse({ choices: [{ delta: { reasoning_content: 'thinking' } }] }),
          sse({ choices: [{ delta: { reasoning_content: ' harder' } }] }),
          sse({ choices: [{ delta: { content: 'Answer' } }] }),
          sse({ choices: [{ finish_reason: 'stop' }] }),
          'data: [DONE]\n\n'
        ])
      ])

      const response = await collectStream(
        new OpenAIAdapter().streamChat(
          { model: 'deepseek-reasoner', messages: [{ role: 'user', content: 'hi' }] },
          config(fn)
        ),
        'deepseek-reasoner'
      )

      expect(response.reasoning).toBe('thinking harder')
      expect(response.content).toBe('Answer')
    })
  })

  it('validates config', () => {
    const adapter = new OpenAIAdapter()
    expect(adapter.validateConfig({ apiKey: '', model: '' }).valid).toBe(false)
    expect(adapter.validateConfig({ apiKey: 'k', model: 'm' }).valid).toBe(true)
    expect(
      adapter.validateConfig({ apiKey: 'k', model: 'm', baseUrl: 'not a url' }).errors
    ).toContain('baseUrl is not a valid URL: not a url')
  })
})
