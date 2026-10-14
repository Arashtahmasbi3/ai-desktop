import { ParseError } from './errors'

/** A decoded Server-Sent Event. */
export interface SSEEvent {
  data: string
  event?: string
  id?: string
}

interface SSEState {
  dataLines: string[]
  eventName?: string
  eventId?: string
}

function makeEvent(state: SSEState): SSEEvent | undefined {
  if (state.dataLines.length === 0) {
    state.eventName = undefined
    state.eventId = undefined
    return undefined
  }
  const event: SSEEvent = { data: state.dataLines.join('\n') }
  if (state.eventName !== undefined) event.event = state.eventName
  if (state.eventId !== undefined) event.id = state.eventId
  state.dataLines = []
  state.eventName = undefined
  state.eventId = undefined
  return event
}

function applyLine(line: string, state: SSEState): SSEEvent | undefined {
  if (line === '') return makeEvent(state)
  if (line.startsWith(':')) return undefined // comment / keep-alive
  const colon = line.indexOf(':')
  const field = colon === -1 ? line : line.slice(0, colon)
  let value = colon === -1 ? '' : line.slice(colon + 1)
  if (value.startsWith(' ')) value = value.slice(1)
  if (field === 'data') state.dataLines.push(value)
  else if (field === 'event') state.eventName = value
  else if (field === 'id') state.eventId = value
  return undefined
}

/**
 * Parse an SSE `Response` body into discrete events.
 * Works with both Node (undici) and browser ReadableStream bodies.
 */
export async function* iterateSSE(response: Response): AsyncGenerator<SSEEvent> {
  const body = response.body
  if (!body) throw new ParseError('Response has no body to read as SSE')

  const reader = body.getReader()
  const decoder = new TextDecoder()
  const state: SSEState = { dataLines: [] }
  let buffer = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline: number
      while ((newline = buffer.indexOf('\n')) !== -1) {
        let line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        if (line.endsWith('\r')) line = line.slice(0, -1)
        const event = applyLine(line, state)
        if (event) yield event
      }
    }
    buffer += decoder.decode()
    if (buffer.length > 0) {
      const line = buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer
      const event = applyLine(line, state)
      if (event) yield event
    }
    const trailing = makeEvent(state)
    if (trailing) yield trailing
  } finally {
    // v2.6.5: `releaseLock()` alone leaves the body (and its socket) undrained
    // when the consumer stops early — e.g. an adapter that returns on `[DONE]`.
    // Cancel first so the connection is actually released.
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
