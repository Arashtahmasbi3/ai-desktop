import { describe, expect, it } from 'vitest'
import { KeyPool } from '../../src/core/llm-adapters/key-pool'
import { retryAfterOf, withKeyHealth } from '../../src/core/llm-adapters/key-health'
import { NetworkError, RateLimitError } from '../../src/core/llm-adapters/errors'
import type {
  BaseLLMAdapter,
  ChatRequest,
  ChatResponse,
  LLMConfig,
  ModelCapabilities,
  StreamEvent,
  ValidationResult
} from '../../src/shared/types'

/**
 * Key health reporting (v3.1).
 *
 * The pool can park and rotate credentials, but it is only as good as what it is told. This
 * decorator is that link, and it has exactly two jobs: report the outcome, and stay invisible.
 * The failure mode worth fearing is a decorator that *swallows* an error — the orchestrator's
 * recovery (retry, switch provider, honour Retry-After) reads the error object, so it must travel
 * up unchanged. Streaming is covered too, because that is the path the chat UI actually uses.
 */
const NOW = Date.UTC(2026, 9, 16, 12, 0, 0)

const CONFIG = { provider: 'deepseek', apiKey: 'sk-test', model: 'deepseek-chat' } as LLMConfig
const REQUEST = { messages: [{ role: 'user', content: 'hi' }] } as ChatRequest

function makePool(): KeyPool {
  return new KeyPool(
    [
      { id: 'deepseek:1', apiKey: 'sk-one' },
      { id: 'deepseek:2', apiKey: 'sk-two' }
    ],
    { now: () => NOW, failureThreshold: 2, cooldownMs: 10_000 }
  )
}

/** A minimal adapter whose two call paths can be scripted to fail. */
function fakeAdapter(behaviour: {
  chat?: () => Promise<ChatResponse>
  stream?: () => AsyncIterable<StreamEvent>
}): BaseLLMAdapter {
  return {
    provider: 'deepseek',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    chat: behaviour.chat ?? (async () => ({ id: '1', model: 'm', content: 'ok', toolCalls: [], finishReason: 'stop' })),
    streamChat: behaviour.stream ?? (async function* () {}),
    getCapabilities: (): ModelCapabilities => ({
      streaming: true,
      toolCalling: true,
      vision: false,
      jsonMode: true,
      contextWindow: 64_000
    }),
    validateConfig: (): ValidationResult => ({ valid: true, errors: [] })
  }
}

describe('the decorator reports without interfering (v3.1)', () => {
  it('returns the response untouched and marks the key healthy', async () => {
    const pool = makePool()
    const wrapped = withKeyHealth(fakeAdapter({}), pool, 'deepseek:1')

    await wrapped.chat(REQUEST, CONFIG)
    wrapped.getCapabilities('m')
    wrapped.validateConfig(CONFIG)

    // Nothing failed, so the key is ready and carries no failure history.
    expect(pool.snapshot().find((entry) => entry.id === 'deepseek:1')).toMatchObject({
      state: 'ready',
      failures: 0
    })
    expect(wrapped.provider).toBe('deepseek')
    expect(wrapped.defaultBaseUrl).toBe('https://api.deepseek.com/v1')
  })

  it('rethrows the SAME error object, so recovery can still read its code', async () => {
    const pool = makePool()
    const original = new RateLimitError('429 from provider', { retryAfterMs: 20_000 })
    const wrapped = withKeyHealth(
      fakeAdapter({
        chat: async () => {
          throw original
        }
      }),
      pool,
      'deepseek:1'
    )

    await expect(wrapped.chat(REQUEST, CONFIG)).rejects.toBe(original)
  })

  it('parks the key when the failure carries Retry-After', async () => {
    const pool = makePool()
    const wrapped = withKeyHealth(
      fakeAdapter({
        chat: async () => {
          throw new RateLimitError('429', { retryAfterMs: 20_000 })
        }
      }),
      pool,
      'deepseek:1'
    )

    await expect(wrapped.chat(REQUEST, CONFIG)).rejects.toThrow()

    const entry = pool.snapshot().find((item) => item.id === 'deepseek:1')!
    expect(entry.state).toBe('cooling')
    expect(entry.cooldownUntil).toBe(NOW + 20_000)
  })

  it('counts an ordinary failure towards the circuit breaker', async () => {
    const pool = makePool()
    const wrapped = withKeyHealth(
      fakeAdapter({
        chat: async () => {
          throw new NetworkError('socket hang up')
        }
      }),
      pool,
      'deepseek:1'
    )

    await expect(wrapped.chat(REQUEST, CONFIG)).rejects.toThrow()
    expect(pool.snapshot().find((entry) => entry.id === 'deepseek:1')!.state).toBe('ready')

    await expect(wrapped.chat(REQUEST, CONFIG)).rejects.toThrow()
    // Threshold reached: this key stops being handed out.
    expect(pool.snapshot().find((entry) => entry.id === 'deepseek:1')!.state).toBe('cooling')
  })
})

describe('the streaming path is covered too (v3.1)', () => {
  it('passes events through and reports success at the end', async () => {
    const pool = makePool()
    const events: StreamEvent[] = [{ type: 'text', text: 'he' } as StreamEvent, { type: 'text', text: 'llo' } as StreamEvent]
    const wrapped = withKeyHealth(
      fakeAdapter({
        stream: async function* () {
          for (const event of events) yield event
        }
      }),
      pool,
      'deepseek:1'
    )

    const seen: StreamEvent[] = []
    for await (const event of wrapped.streamChat(REQUEST, CONFIG)) seen.push(event)

    expect(seen).toEqual(events)
    expect(pool.snapshot().find((entry) => entry.id === 'deepseek:1')!.failures).toBe(0)
  })

  it('parks the key when the stream fails before any event', async () => {
    const pool = makePool()
    const wrapped = withKeyHealth(
      fakeAdapter({
        stream: async function* () {
          throw new RateLimitError('429', { retryAfterMs: 30_000 })
        }
      }),
      pool,
      'deepseek:1'
    )

    await expect(async () => {
      for await (const _event of wrapped.streamChat(REQUEST, CONFIG)) void _event
    }).rejects.toThrow(/429/)

    expect(pool.snapshot().find((entry) => entry.id === 'deepseek:1')!.state).toBe('cooling')
  })

  it('parks the key when the stream dies mid-way, after events were already yielded', async () => {
    const pool = makePool()
    const wrapped = withKeyHealth(
      fakeAdapter({
        stream: async function* () {
          yield { type: 'text', text: 'partial answer' } as StreamEvent
          throw new RateLimitError('429 mid-stream', { retryAfterMs: 5_000 })
        }
      }),
      pool,
      'deepseek:1'
    )

    const seen: StreamEvent[] = []
    await expect(async () => {
      for await (const event of wrapped.streamChat(REQUEST, CONFIG)) seen.push(event)
    }).rejects.toThrow(/mid-stream/)

    // The partial output was delivered, and the key is still held accountable.
    expect(seen).toHaveLength(1)
    expect(pool.snapshot().find((entry) => entry.id === 'deepseek:1')!.state).toBe('cooling')
  })
})

describe('retryAfterOf (v3.1)', () => {
  it('reads only a positive wait from an LLM error', () => {
    expect(retryAfterOf(new RateLimitError('429', { retryAfterMs: 3_000 }))).toBe(3_000)
    expect(retryAfterOf(new RateLimitError('429'))).toBeUndefined()
    expect(retryAfterOf(new NetworkError('down'))).toBeUndefined()
    expect(retryAfterOf(new Error('plain'))).toBeUndefined()
    expect(retryAfterOf('a string')).toBeUndefined()
  })
})
