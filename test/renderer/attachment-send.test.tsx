// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { useStore } from '../../src/renderer/src/store'

/**
 * v2.9.0 (D) — "we cannot upload images or files".
 *
 * The renderer's whole job is to hand main the opaque ids. The old behaviour — gluing
 * `@<desktop path>` into the prompt text — is exactly what nothing ever parsed, so these
 * cases pin both halves: the ids reach `agent.run`, and the raw path never does.
 */
const seen: Array<Record<string, unknown>> = []
const run = vi.fn(async (request: Record<string, unknown>) => {
  seen.push(request)
})

beforeEach(() => {
  seen.length = 0
  run.mockClear()
  ;(window as unknown as { api: unknown }).api = {
    agent: { run, onEvent: vi.fn(() => () => undefined) },
    chats: { save: vi.fn(async () => undefined) }
  }
  useStore.setState({
    messages: [],
    running: false,
    error: null,
    sessionId: 's1',
    activeChatId: 'c1',
    selection: { provider: 'google', model: 'gemini-2.5-flash' }
  })
})

afterEach(cleanup)

describe('send() carries attachment ids, never desktop paths (v2.9.0)', () => {
  it('forwards the ids to agent.run', async () => {
    await useStore.getState().send('what is this?', ['att-1', 'att-2'])

    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ task: 'what is this?', attachments: ['att-1', 'att-2'] })
  })

  it('omits the field entirely when nothing was attached', async () => {
    await useStore.getState().send('just text')

    expect(seen[0]?.task).toBe('just text')
    expect(seen[0] && 'attachments' in seen[0]).toBe(false)
  })

  it('never puts a desktop path into the task', async () => {
    await useStore.getState().send('look', ['att-1'])

    const task = String(seen[0]?.task ?? '')
    expect(task).not.toContain('@')
    expect(task).not.toContain('C:\\')
  })

  it('allows a send with only an attachment and no text', async () => {
    await useStore.getState().send('', ['att-9'])

    expect(seen).toHaveLength(1)
    expect(seen[0]?.attachments).toEqual(['att-9'])
  })

  it('refuses an empty send', async () => {
    await useStore.getState().send('   ', [])
    expect(seen).toHaveLength(0)
  })

  it('names the attachment in the user transcript so it is honest about what was sent', async () => {
    await useStore.getState().send('look', ['att-1'])
    const message = useStore.getState().messages.at(-1)
    expect(message?.role).toBe('user')
    expect(message?.content).toContain('look')
    expect(message?.content).toMatch(/1/)
  })
})
