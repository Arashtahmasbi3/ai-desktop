import { describe, expect, it } from 'vitest'
import type { FetchLike } from '@shared/types'
import { httpStream } from '@core/llm-adapters/http'
import { redact } from '@core/agent/redact'

const baseOptions = (fetchImpl: FetchLike, timeoutMs = 120) => ({
  provider: 'openai' as const,
  timeoutMs,
  maxRetries: 0,
  fetchImpl
})

/** Read the whole body, failing loudly instead of hanging the suite. */
async function drain(response: Response, budgetMs = 2000): Promise<void> {
  return drainReader(response.body!.getReader(), budgetMs)
}

async function drainReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  budgetMs = 2000
): Promise<void> {
  const work = (async () => {
    for (;;) {
      const { done } = await reader.read()
      if (done) return
    }
  })()
  await Promise.race([
    work.catch(() => undefined),
    new Promise((_resolve, reject) =>
      setTimeout(() => reject(new Error('body read hung past the budget')), budgetMs)
    )
  ])
}

describe('httpStream keeps the timeout alive for the whole body', () => {
  it('fails a body that stalls after the headers arrive', async () => {
    const fetchImpl: FetchLike = async (_url, init) => {
      const signal = (init as RequestInit | undefined)?.signal
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          signal?.addEventListener('abort', () => controller.error(new Error('aborted')))
        }
      })
      return new Response(body, { status: 200 })
    }

    const started = Date.now()
    const response = await httpStream('https://api.example/v1', {}, baseOptions(fetchImpl))
    // Headers resolved, so the old code had already cleared its timer here.
    expect(response.status).toBe(200)
    await drain(response)
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('propagates the caller abort into the stream', async () => {
    const controller = new AbortController()
    const fetchImpl: FetchLike = async (_url, init) => {
      const signal = (init as RequestInit | undefined)?.signal
      const body = new ReadableStream<Uint8Array>({
        start(inner) {
          inner.enqueue(new TextEncoder().encode('data: {}\n\n'))
          signal?.addEventListener('abort', () => inner.error(new Error('aborted')))
        }
      })
      return new Response(body, { status: 200 })
    }

    const response = await httpStream(
      'https://api.example/v1',
      {},
      { ...baseOptions(fetchImpl, 30_000), signal: controller.signal }
    )
    const reader = response.body!.getReader()
    await reader.read()
    controller.abort()
    await drainReader(reader)
    expect(controller.signal.aborted).toBe(true)
    await reader.cancel().catch(() => undefined)
  })

  it('still returns a normal stream unchanged', async () => {
    const fetchImpl: FetchLike = async () =>
      new Response(new TextEncoder().encode('data: hello\n\n'), { status: 200 })
    const response = await httpStream('https://api.example/v1', {}, baseOptions(fetchImpl))
    expect(await response.text()).toBe('data: hello\n\n')
  })
})

describe('B-4: redaction covers the prefixed key shapes', () => {
  it('redacts modern OpenAI project and service-account keys', () => {
    expect(redact('key=sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345')).toBe('key=[REDACTED]')
    expect(redact('key=sk-svcacct-ABCDEFGHIJKLMNOPQRSTUV')).toBe('key=[REDACTED]')
  })

  it('redacts Google, Groq, HuggingFace and xAI keys', () => {
    expect(redact(`AIza${'a'.repeat(35)}`)).toBe('[REDACTED]')
    expect(redact(`gsk_${'a'.repeat(24)}`)).toBe('[REDACTED]')
    expect(redact(`hf_${'a'.repeat(24)}`)).toBe('[REDACTED]')
    expect(redact(`xai-${'a'.repeat(24)}`)).toBe('[REDACTED]')
  })

  it('leaves ordinary text alone', () => {
    const text = 'the sk- prefix discussion and a normal sentence'
    expect(redact(text)).toBe(text)
  })
})
