import { describe, it, expect } from 'vitest'
import { OpenAIAdapter } from '@core/llm-adapters/openai'
import {
  APIError,
  AbortError,
  AuthError,
  NetworkError,
  RateLimitError,
  TimeoutError,
  mapHttpStatusError,
  parseRetryAfter
} from '@core/llm-adapters/errors'
import type { ChatRequest, FetchLike, LLMConfig } from '@shared/types'
import { errorResponse, jsonResponse, mockFetch, hangingFetch } from '../helpers/mock-fetch'

const REQUEST: ChatRequest = { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] }

function config(fetchImpl: FetchLike, overrides: Partial<LLMConfig> = {}): LLMConfig {
  return { apiKey: 'sk-test', model: 'gpt-4o-mini', fetchImpl, ...overrides }
}

describe('error mapping helpers', () => {
  it('maps auth statuses', () => {
    expect(mapHttpStatusError(401, 'nope', 'openai')).toBeInstanceOf(AuthError)
    expect(mapHttpStatusError(403, 'nope', 'openai')).toBeInstanceOf(AuthError)
  })

  it('maps 429 to RateLimitError with retry-after', () => {
    const error = mapHttpStatusError(429, 'slow down', 'openai', '2')
    expect(error).toBeInstanceOf(RateLimitError)
    expect(error.retryAfterMs).toBe(2000)
    expect(error.retryable).toBe(true)
  })

  it('maps 5xx to a retryable APIError and 4xx to a non-retryable one', () => {
    expect(mapHttpStatusError(500, '', 'openai').retryable).toBe(true)
    expect(mapHttpStatusError(400, '', 'openai')).toBeInstanceOf(APIError)
    expect(mapHttpStatusError(400, '', 'openai').retryable).toBe(false)
  })

  it('parses Retry-After seconds and HTTP-dates', () => {
    expect(parseRetryAfter('3')).toBe(3000)
    expect(parseRetryAfter(null)).toBeUndefined()
    expect(parseRetryAfter('garbage')).toBeUndefined()
    expect(parseRetryAfter(new Date(Date.now() + 1000).toUTCString())).toBeGreaterThan(0)
  })
})

describe('adapter error handling', () => {
  it('throws AuthError without retrying on 401', async () => {
    const { fn, calls } = mockFetch([errorResponse(401, 'unauthorized')])
    await expect(
      new OpenAIAdapter().chat(REQUEST, config(fn))
    ).rejects.toBeInstanceOf(AuthError)
    expect(calls).toHaveLength(1)
  })

  it('retries on 429 and succeeds', async () => {
    const { fn, calls } = mockFetch([
      errorResponse(429, 'rate limited', { 'retry-after': '0' }),
      jsonResponse({ id: 'x', model: 'gpt-4o-mini', choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] })
    ])
    const response = await new OpenAIAdapter().chat(REQUEST, config(fn))
    expect(response.content).toBe('ok')
    expect(calls).toHaveLength(2)
  })

  it('throws a non-retryable APIError on 400', async () => {
    const { fn, calls } = mockFetch([errorResponse(400, 'bad request')])
    await expect(new OpenAIAdapter().chat(REQUEST, config(fn))).rejects.toBeInstanceOf(APIError)
    expect(calls).toHaveLength(1)
  })

  it('throws a retryable APIError on 500 (no retry when maxRetries=0)', async () => {
    const { fn, calls } = mockFetch([errorResponse(500, 'boom')])
    let caught: unknown
    try {
      await new OpenAIAdapter().chat(REQUEST, config(fn, { maxRetries: 0 }))
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(APIError)
    expect((caught as APIError).retryable).toBe(true)
    expect(calls).toHaveLength(1)
  })

  it('wraps transport failures in NetworkError', async () => {
    const failing: FetchLike = () => Promise.reject(new Error('ECONNREFUSED'))
    await expect(
      new OpenAIAdapter().chat(REQUEST, config(failing, { maxRetries: 0 }))
    ).rejects.toBeInstanceOf(NetworkError)
  })

  it('throws TimeoutError when the request exceeds timeoutMs', async () => {
    await expect(
      new OpenAIAdapter().chat(REQUEST, config(hangingFetch(), { timeoutMs: 10, maxRetries: 0 }))
    ).rejects.toBeInstanceOf(TimeoutError)
  })

  it('throws AbortError when the caller aborts', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      new OpenAIAdapter().chat(
        { ...REQUEST, signal: controller.signal },
        config(hangingFetch(), { maxRetries: 0 })
      )
    ).rejects.toBeInstanceOf(AbortError)
  })

  it('rejects invalid config with a config error', async () => {
    await expect(
      new OpenAIAdapter().chat(REQUEST, { apiKey: '', model: '' })
    ).rejects.toMatchObject({ code: 'config' })
  })
})
