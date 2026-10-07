import { describe, it, expect } from 'vitest'
import { DeepSeekAdapter } from '@core/llm-adapters/deepseek'
import { OpenAIAdapter } from '@core/llm-adapters/openai'
import type { LLMConfig } from '@shared/types'
import { jsonResponse, mockFetch } from '../helpers/mock-fetch'

function config(
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>
): LLMConfig {
  return { apiKey: 'ds-key', model: 'deepseek-chat', fetchImpl }
}

describe('DeepSeekAdapter', () => {
  it('is an OpenAI-compatible adapter with the DeepSeek base URL', () => {
    const adapter = new DeepSeekAdapter()
    expect(adapter).toBeInstanceOf(OpenAIAdapter)
    expect(adapter.provider).toBe('deepseek')
    expect(adapter.defaultBaseUrl).toBe('https://api.deepseek.com/v1')
  })

  it('posts to the DeepSeek /chat/completions endpoint', async () => {
    const { fn, calls } = mockFetch([
      jsonResponse({
        id: 'ds-1',
        model: 'deepseek-chat',
        choices: [{ message: { role: 'assistant', content: 'salam' }, finish_reason: 'stop' }]
      })
    ])

    const response = await new DeepSeekAdapter().chat(
      { model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }] },
      config(fn)
    )

    expect(calls[0].url).toBe('https://api.deepseek.com/v1/chat/completions')
    expect(response.content).toBe('salam')
    expect(response.finishReason).toBe('stop')
  })

  it('reports DeepSeek capabilities', () => {
    const adapter = new DeepSeekAdapter()
    expect(adapter.getCapabilities('deepseek-chat')).toEqual({
      streaming: true,
      toolCalling: true,
      vision: false,
      jsonMode: true,
      contextWindow: 64_000,
      maxOutputTokens: 8_192
    })
    expect(adapter.getCapabilities('deepseek-reasoner').maxOutputTokens).toBe(32_768)
  })
})
