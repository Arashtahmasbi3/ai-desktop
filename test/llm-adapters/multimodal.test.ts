import { describe, expect, it } from 'vitest'
import { OpenAIAdapter } from '@core/llm-adapters/openai'
import { AnthropicAdapter } from '@core/llm-adapters/anthropic'
import { GoogleAdapter } from '@core/llm-adapters/google'
import { collectStream } from '@core/llm-adapters/base'
import { modelSupportsVision } from '@shared/attachments'
import type { ChatMessage, LLMConfig } from '@shared/types'
import { jsonResponse, mockFetch } from '../helpers/mock-fetch'

/**
 * v2.9.0 (D) — images for vision models.
 *
 * Verified cause RC5: there was no multimodal path at all. `ChatMessage.content` is
 * `string | null`, every adapter emitted text-only blocks, and `ModelCapabilities.vision`
 * had no consumer — so an attached image could never reach a vision model. The parts path
 * is additive: a message WITHOUT `parts` must produce a byte-identical request body.
 */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function config(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>): LLMConfig {
  return { apiKey: 'sk-test', model: 'test-model', fetchImpl }
}

const imageMessage: ChatMessage = {
  role: 'user',
  content: null,
  parts: [
    { type: 'text', text: 'what is in this screenshot?' },
    { type: 'image', mediaType: 'image/png', base64: PNG_BASE64 }
  ]
}
const textMessage: ChatMessage = { role: 'user', content: 'plain question' }

/** The first message of the body the adapter actually posted. */
function firstMessage(body: Record<string, any>): Record<string, any> {
  return body.messages?.[0] ?? body.contents?.[0]
}

describe('multimodal requests (v2.9.0)', () => {
  it('OpenAI sends image parts as data URLs', async () => {
    const { fn, calls } = mockFetch([
      jsonResponse({
        id: 'r1',
        model: 'gpt-4o',
        choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }]
      })
    ])

    await new OpenAIAdapter().chat({ model: 'gpt-4o', messages: [imageMessage] }, config(fn))

    const content = firstMessage(calls[0].body as Record<string, any>).content
    expect(Array.isArray(content)).toBe(true)
    expect(content[0]).toEqual({ type: 'text', text: 'what is in this screenshot?' })
    expect(content[1]).toEqual({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${PNG_BASE64}` }
    })
  })

  it('Anthropic sends image parts as base64 source blocks', async () => {
    const { fn, calls } = mockFetch([
      jsonResponse({
        id: 'm1',
        model: 'claude-3-5-sonnet-latest',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'ok' }]
      })
    ])

    await new AnthropicAdapter().chat(
      { model: 'claude-3-5-sonnet-latest', messages: [imageMessage] },
      config(fn)
    )

    const content = firstMessage(calls[0].body as Record<string, any>).content
    expect(content[0]).toEqual({ type: 'text', text: 'what is in this screenshot?' })
    expect(content[1]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: PNG_BASE64 }
    })
  })

  it('Google sends image parts as inlineData', async () => {
    const { fn, calls } = mockFetch([
      jsonResponse({
        candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }]
      })
    ])

    await new GoogleAdapter().chat(
      { model: 'gemini-2.5-flash', messages: [imageMessage] },
      config(fn)
    )

    const parts = firstMessage(calls[0].body as Record<string, any>).parts
    expect(parts[0]).toEqual({ text: 'what is in this screenshot?' })
    expect(parts[1]).toEqual({ inlineData: { mimeType: 'image/png', data: PNG_BASE64 } })
  })

  it('leaves a text-only request body exactly as it was', async () => {
    // The regression guard: the parts path must not perturb the ordinary shape.
    const { fn, calls } = mockFetch([
      jsonResponse({
        id: 'r2',
        model: 'gpt-4o',
        choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }]
      })
    ])

    await new OpenAIAdapter().chat({ model: 'gpt-4o', messages: [textMessage] }, config(fn))

    expect(firstMessage(calls[0].body as Record<string, any>).content).toBe('plain question')
  })

  it('a streamed response still accumulates only the answer text', async () => {
    // Guards against `parts` leaking into the streamed path.
    const { fn } = mockFetch([
      jsonResponse({ id: 'x', model: 'gpt-4o', choices: [{ message: { content: 'ok' } }] })
    ])
    const adapter = new OpenAIAdapter()
    const response = await collectStream(
      (async function* () {
        yield { type: 'text' as const, text: 'hi' }
      })(),
      'gpt-4o'
    )
    expect(response.content).toBe('hi')
    expect(fn).toBeDefined()
    expect(adapter.getCapabilities('gpt-4o').vision).toBe(true)
  })

  it('agrees with the shared vision table the renderer uses', () => {
    // `modelSupportsVision` mirrors getCapabilities().vision; a drifted copy would let a
    // chip promise vision the adapter cannot deliver.
    expect(modelSupportsVision('openai', 'gpt-4o')).toBe(
      new OpenAIAdapter().getCapabilities('gpt-4o').vision
    )
    expect(modelSupportsVision('anthropic', 'claude-3-5-sonnet-latest')).toBe(
      new AnthropicAdapter().getCapabilities('claude-3-5-sonnet-latest').vision
    )
    expect(modelSupportsVision('google', 'gemini-2.5-flash')).toBe(
      new GoogleAdapter().getCapabilities('gemini-2.5-flash').vision
    )
  })
})
