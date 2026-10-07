import { vi } from 'vitest'

export interface RecordedCall {
  url: string
  init: RequestInit | undefined
  headers: Record<string, string>
  body: unknown
}

export type MockResponseFactory = () => Response | Promise<Response>
export type MockResponseItem = Response | MockResponseFactory

/**
 * Build a fake `fetch` that replays a queue of canned responses and records
 * every call. This is the HTTP boundary, so mocking here keeps the adapters'
 * own logic (serialization, parsing, error mapping) fully exercised.
 */
export function mockFetch(items: MockResponseItem[]): {
  fn: (url: string, init?: RequestInit) => Promise<Response>
  calls: RecordedCall[]
} {
  const queue = [...items]
  const calls: RecordedCall[] = []
  const fn = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    const headers = (init?.headers ?? {}) as Record<string, string>
    let body: unknown
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body)
      } catch {
        body = init.body
      }
    }
    calls.push({ url, init, headers, body })
    const next = queue.shift()
    if (!next) throw new Error(`Unexpected fetch call: ${url}`)
    return typeof next === 'function' ? await next() : next
  })
  return { fn, calls }
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

export function errorResponse(
  status: number,
  body = 'error',
  headers: Record<string, string> = {}
): Response {
  return new Response(body, { status, headers })
}

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    }
  })
}

/** An SSE response whose body is fed in the given chunks (verbatim). */
export function sseResponse(chunks: string[]): Response {
  return new Response(streamOf(chunks), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' }
  })
}

/** `data: {json}\n\n` */
export function sse(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`
}

/** `event: name\ndata: {json}\n\n` */
export function sseEvent(name: string, obj: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(obj)}\n\n`
}

/** A fetch that only settles when its abort signal fires. */
export function hangingFetch(): (url: string, init?: RequestInit) => Promise<Response> {
  return (_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal
      if (signal?.aborted) {
        reject(new Error('aborted'))
        return
      }
      signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    })
}
