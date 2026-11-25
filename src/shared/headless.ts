/**
 * Headless protocol (T23).
 *
 * The app can be driven without a window: `AI Desktop --headless` reads one JSON object per line on stdin and writes one
 * per line on stdout. It is deliberately a *protocol*, not a second agent: the same `AgentService` runs the task, so a
 * headless run has the same tools, the same approval rules and the same diagnostics as a chat run.
 *
 * Methods are few on purpose. A headless surface that grows a method per feature is an SDK with no version story; `run`
 * plus `health` is enough to automate, and anything else can be added when someone asks for it.
 */
export interface HeadlessRequest {
  id?: number | string
  method: string
  params?: Record<string, unknown>
}

export interface HeadlessError {
  code: 'invalid_request' | 'unknown_method' | 'run_failed' | 'internal'
  message: string
}

export interface HeadlessSuccess {
  id: number | string | null
  result: Record<string, unknown>
}

export interface HeadlessFailure {
  id: number | string | null
  error: HeadlessError
}

export type HeadlessResponse = HeadlessSuccess | HeadlessFailure

/** Parse one line; returns null for a blank line, and an error response for anything that is not a request. */
export function decodeRequest(line: string): HeadlessRequest | HeadlessFailure | null {
  const trimmed = line.trim()
  if (trimmed === '') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return { id: null, error: { code: 'invalid_request', message: 'the line is not JSON' } }
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { id: null, error: { code: 'invalid_request', message: 'the request must be an object' } }
  }
  const record = parsed as Record<string, unknown>
  const id = typeof record.id === 'string' || typeof record.id === 'number' ? record.id : null
  if (typeof record.method !== 'string' || record.method === '') {
    return { id, error: { code: 'invalid_request', message: 'the request needs a "method"' } }
  }
  return {
    ...(id === null ? {} : { id }),
    method: record.method,
    ...(typeof record.params === 'object' && record.params !== null
      ? { params: record.params as Record<string, unknown> }
      : {})
  }
}

export function encodeResponse(response: HeadlessResponse): string {
  return `${JSON.stringify(response)}\n`
}

/** True when a response is a failure; a narrow helper so callers do not have to test both shapes everywhere. */
export function isHeadlessFailure(response: HeadlessResponse): response is HeadlessFailure {
  return 'error' in response
}
