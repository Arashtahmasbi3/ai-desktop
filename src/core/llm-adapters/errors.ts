import type { ProviderId } from '@shared/types'

export type LLMErrorCode =
  | 'auth'
  | 'rate_limit'
  | 'timeout'
  | 'network'
  | 'api'
  | 'parse'
  | 'aborted'
  | 'config'

export interface LLMErrorOptions {
  status?: number
  provider?: ProviderId
  retryable?: boolean
  retryAfterMs?: number
  cause?: unknown
}

export class LLMError extends Error {
  readonly code: LLMErrorCode
  readonly status?: number
  readonly provider?: ProviderId
  readonly retryable: boolean
  readonly retryAfterMs?: number

  constructor(message: string, code: LLMErrorCode, options: LLMErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = new.target.name
    this.code = code
    this.status = options.status
    this.provider = options.provider
    this.retryable = options.retryable ?? false
    this.retryAfterMs = options.retryAfterMs
  }
}

export class AuthError extends LLMError {
  constructor(message: string, options: LLMErrorOptions = {}) {
    super(message, 'auth', { retryable: false, ...options })
  }
}

export class RateLimitError extends LLMError {
  constructor(message: string, options: LLMErrorOptions = {}) {
    super(message, 'rate_limit', { retryable: true, ...options })
  }
}

export class TimeoutError extends LLMError {
  constructor(message: string, options: LLMErrorOptions = {}) {
    super(message, 'timeout', { retryable: true, ...options })
  }
}

export class NetworkError extends LLMError {
  constructor(message: string, options: LLMErrorOptions = {}) {
    super(message, 'network', { retryable: true, ...options })
  }
}

export class APIError extends LLMError {
  constructor(message: string, options: LLMErrorOptions = {}) {
    super(message, 'api', options)
  }
}

export class ParseError extends LLMError {
  constructor(message: string, options: LLMErrorOptions = {}) {
    super(message, 'parse', { retryable: false, ...options })
  }
}

export class AbortError extends LLMError {
  constructor(message: string, options: LLMErrorOptions = {}) {
    super(message, 'aborted', { retryable: false, ...options })
  }
}

export class ConfigError extends LLMError {
  constructor(message: string, options: LLMErrorOptions = {}) {
    super(message, 'config', { retryable: false, ...options })
  }
}

/** Parse an HTTP `Retry-After` header (seconds or HTTP-date) into milliseconds. */
export function parseRetryAfter(header: string | null | undefined): number | undefined {
  if (!header) return undefined
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(header)
  if (Number.isFinite(date)) return Math.max(0, date - Date.now())
  return undefined
}

/** Map a non-2xx HTTP response to the appropriate typed error. */
export function mapHttpStatusError(
  status: number,
  bodyText: string,
  provider: ProviderId,
  retryAfterHeader?: string | null
): LLMError {
  const message = `HTTP ${status}${bodyText ? `: ${bodyText.slice(0, 500)}` : ''}`
  if (status === 401 || status === 403) {
    return new AuthError(message, { status, provider })
  }
  if (status === 429) {
    return new RateLimitError(message, {
      status,
      provider,
      retryAfterMs: parseRetryAfter(retryAfterHeader)
    })
  }
  return new APIError(message, { status, provider, retryable: status >= 500 })
}
