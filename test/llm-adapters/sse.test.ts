import { describe, it, expect } from 'vitest'
import { iterateSSE } from '@core/llm-adapters/sse'
import { sseResponse } from '../helpers/mock-fetch'

async function collect(chunks: string[]): Promise<{ data: string; event?: string }[]> {
  const out: { data: string; event?: string }[] = []
  for await (const event of iterateSSE(sseResponse(chunks))) {
    out.push({ data: event.data, event: event.event })
  }
  return out
}

describe('iterateSSE', () => {
  it('splits events on blank lines and strips the data prefix', async () => {
    const events = await collect(['data: one\n\ndata: two\n\n'])
    expect(events.map((e) => e.data)).toEqual(['one', 'two'])
  })

  it('reassembles events split across chunks', async () => {
    const events = await collect(['data: par', 'tial\n\n'])
    expect(events).toHaveLength(1)
    expect(events[0].data).toBe('partial')
  })

  it('handles CRLF line endings', async () => {
    const events = await collect(['data: hello\r\n\r\n'])
    expect(events[0].data).toBe('hello')
  })

  it('captures the event name and joins multi-line data', async () => {
    const events = await collect(['event: message_delta\ndata: {"a":1}\ndata: {"b":2}\n\n'])
    expect(events[0].event).toBe('message_delta')
    expect(events[0].data).toBe('{"a":1}\n{"b":2}')
  })

  it('ignores comment / keep-alive lines', async () => {
    const events = await collect([': ping\n\ndata: real\n\n'])
    expect(events.map((e) => e.data)).toEqual(['real'])
  })

  it('parses a realistic OpenAI-style stream', async () => {
    const events = await collect([
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
      'data: [DONE]\n\n'
    ])
    expect(events.map((e) => e.data)).toEqual([
      '{"choices":[{"delta":{"content":"Hi"}}]}',
      '[DONE]'
    ])
  })
})
