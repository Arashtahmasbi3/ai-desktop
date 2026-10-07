import { describe, it, expect } from 'vitest'
import { GoogleAdapter } from '@core/llm-adapters/google'
import { collectStream } from '@core/llm-adapters/base'
import type { LLMConfig } from '@shared/types'
import { jsonResponse, mockFetch, sse, sseResponse } from '../helpers/mock-fetch'

function config(
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>
): LLMConfig {
  return { apiKey: 'goog-key', model: 'gemini-2.0-flash', fetchImpl }
}

describe('GoogleAdapter', () => {
  it('posts to generateContent with systemInstruction and converts messages', async () => {
    const { fn, calls } = mockFetch([
      jsonResponse({
        candidates: [
          {
            content: {
              parts: [{ text: 'Hi there' }, { functionCall: { name: 'list_dir', args: { path: '/tmp' } } }]
            },
            finishReason: 'STOP'
          }
        ],
        usageMetadata: {
          promptTokenCount: 8,
          candidatesTokenCount: 4,
          totalTokenCount: 12
        },
        modelVersion: 'gemini-2.0-flash'
      })
    ])

    const adapter = new GoogleAdapter()
    const response = await adapter.chat(
      {
        model: 'gemini-2.0-flash',
        messages: [
          { role: 'system', content: 'be terse' },
          { role: 'user', content: 'list /tmp' },
          { role: 'tool', name: 'list_dir', content: 'a.txt' }
        ],
        tools: [{ name: 'list_dir', description: 'list a dir', parameters: { type: 'object' } }],
        toolChoice: 'auto'
      },
      config(fn)
    )

    expect(calls[0].url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent'
    )
    expect(calls[0].headers['x-goog-api-key']).toBe('goog-key')

    const body = calls[0].body as Record<string, any>
    expect(body.systemInstruction.parts[0].text).toBe('be terse')
    expect(body.contents[0]).toMatchObject({ role: 'user' })
    expect(body.contents[1].parts[0].functionResponse).toMatchObject({ name: 'list_dir' })
    expect(body.tools[0].functionDeclarations[0].name).toBe('list_dir')
    expect(body.toolConfig.functionCallingConfig.mode).toBe('AUTO')

    expect(response.content).toBe('Hi there')
    expect(response.finishReason).toBe('stop')
    expect(response.toolCalls[0].name).toBe('list_dir')
    expect(response.toolCalls[0].arguments).toBe('{"path":"/tmp"}')
    expect(response.usage).toEqual({ promptTokens: 8, completionTokens: 4, totalTokens: 12 })
  })

  it('uses streamGenerateContent?alt=sse when streaming', async () => {
    const { fn, calls } = mockFetch([
      sseResponse([
        sse({ candidates: [{ content: { parts: [{ text: 'Hel' }] } }] }),
        sse({ candidates: [{ content: { parts: [{ text: 'lo' }] }, finishReason: 'STOP' }] }),
        'data: [DONE]\n\n'
      ])
    ])

    const response = await collectStream(
      new GoogleAdapter().streamChat(
        { model: 'gemini-2.0-flash', messages: [{ role: 'user', content: 'hi' }] },
        config(fn)
      ),
      'gemini-2.0-flash'
    )

    expect(calls[0].url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse'
    )
    expect(response.content).toBe('Hello')
    expect(response.finishReason).toBe('stop')
  })

  it('reports capabilities', () => {
    const adapter = new GoogleAdapter()
    expect(adapter.getCapabilities('gemini-2.0-flash').vision).toBe(true)
    expect(adapter.getCapabilities('gemini-2.5-pro').maxOutputTokens).toBe(8_192)
    expect(adapter.getCapabilities('gemini-2.0-flash').contextWindow).toBe(1_000_000)
  })
})
