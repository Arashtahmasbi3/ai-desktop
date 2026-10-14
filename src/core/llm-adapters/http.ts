import type { FetchLike, ProviderId } from '@shared/types'
import { AbortError, LLMError, NetworkError, TimeoutError, mapHttpStatusError } from './errors'

export const DEFAULT_TIMEOUT_MS = 60_000
export const DEFAULT_MAX_RETRIES = 2
const MAX_BACKOFF_MS = 8_000

export interface HttpCallOptions {
  provider: ProviderId
  timeoutMs: number
  maxRetries: number
  fetchImpl: FetchLike
  signal?: AbortSignal
}

export function getGlobalFetch(): FetchLike {
  const impl = (globalThis as { fetch?: FetchLike }).fetch
  if (!impl) throw new Error('No global fetch available; pass config.fetchImpl')
  return impl
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AbortError('Aborted before delay'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new AbortError('Aborted during delay'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

interface TimeoutHandle {
  signal: AbortSignal
  cleanup: () => void
  didTimeout: () => boolean
}

function withTimeout(timeoutMs: number, external?: AbortSignal): TimeoutHandle {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const onAbort = (): void => controller.abort()
  if (external) {
    if (external.aborted) controller.abort()
    else external.addEventListener('abort', onAbort, { once: true })
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer)
      external?.removeEventListener('abort', onAbort)
    },
    didTimeout: () => timedOut
  }
}

/** Translate a low-level fetch failure into a typed adapter error. */
function translateFetchError(
  error: unknown,
  options: HttpCallOptions,
  handle: TimeoutHandle
): Error {
  if (options.signal?.aborted) {
    return new AbortError(`${options.provider} request aborted`, { provider: options.provider })
  }
  if (handle.didTimeout()) {
    return new TimeoutError(`${options.provider} request timed out after ${options.timeoutMs}ms`, {
      provider: options.provider
    })
  }
  const message = error instanceof Error ? error.message : String(error)
  return new NetworkError(`${options.provider} network error: ${message}`, {
    provider: options.provider,
    cause: error
  })
}

/** Perform a fetch, translating low-level failures into typed errors. */
async function doFetch(
  url: string,
  init: RequestInit,
  options: HttpCallOptions
): Promise<Response> {
  const handle = withTimeout(options.timeoutMs, options.signal)
  try {
    return await options.fetchImpl(url, { ...init, signal: handle.signal })
  } catch (error) {
    throw translateFetchError(error, options, handle)
  } finally {
    handle.cleanup()
  }
}

async function throwForBadStatus(response: Response, provider: ProviderId): Promise<void> {
  if (response.ok) return
  let bodyText = ''
  try {
    bodyText = await response.text()
  } catch {
    bodyText = ''
  }
  throw mapHttpStatusError(
    response.status,
    bodyText,
    provider,
    response.headers?.get?.('retry-after') ?? null
  )
}

function backoffMs(attempt: number, error: LLMError): number {
  if (error.retryAfterMs !== undefined) return error.retryAfterMs
  return Math.min(500 * 2 ** attempt, MAX_BACKOFF_MS)
}

/** POST JSON and return the parsed body, retrying transient failures. */
export async function httpJson(
  url: string,
  init: RequestInit,
  options: HttpCallOptions
): Promise<unknown> {
  const totalAttempts = Math.max(1, options.maxRetries + 1)
  let lastError: unknown

  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    try {
      const response = await doFetch(url, init, options)
      await throwForBadStatus(response, options.provider)
      return (await response.json()) as unknown
    } catch (error) {
      lastError = error
      const retryable = error instanceof LLMError && error.retryable
      const isLast = attempt === totalAttempts - 1
      if (!retryable || isLast || options.signal?.aborted) throw error
      await sleep(backoffMs(attempt, error as LLMError), options.signal)
    }
  }
  throw lastError
}

/**
 * Open a streaming response (no retry — the caller owns the stream lifetime).
 *
 * v2.6.5: the timeout and the caller's abort signal used to be detached as soon
 * as the response *headers* arrived (`doFetch`'s `finally { cleanup() }`), so a
 * provider that sent headers and then stalled hung the agent run forever, and the
 * Stop button could not cancel an in-flight stream — tokens kept arriving and
 * being billed. Both stay wired for the whole body lifetime now, and the body is
 * wrapped so the timer is always cleared and a cancel aborts the underlying
 * request.
 */
export async function httpStream(
  url: string,
  init: RequestInit,
  options: HttpCallOptions
): Promise<Response> {
  const handle = withTimeout(options.timeoutMs, options.signal)
  let response: Response
  try {
    response = await options.fetchImpl(url, { ...init, signal: handle.signal })
  } catch (error) {
    handle.cleanup()
    throw translateFetchError(error, options, handle)
  }
  try {
    await throwForBadStatus(response, options.provider)
  } catch (error) {
    handle.cleanup()
    throw error
  }
  if (!response.body) {
    handle.cleanup()
    return response
  }

  const reader = response.body.getReader()
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          handle.cleanup()
          controller.close()
          return
        }
        controller.enqueue(value)
      } catch (error) {
        handle.cleanup()
        controller.error(error)
      }
    },
    async cancel(reason) {
      // The consumer (or an abort) stopped early: release the timer and the
      // underlying connection so the request is really cancelled.
      handle.cleanup()
      await reader.cancel(reason).catch(() => undefined)
    }
  })
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  })
}
