// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, ApprovalRequest } from '@shared/ui'
import { useStore, type ChatMessage } from '../../src/renderer/src/store'

/**
 * U-5: a decision gate is only cleared once main has accepted the answer; a
 * failed reply keeps the gate open and surfaces the error.
 * U-10: the in-memory message list is capped, but never for the in-flight run.
 * U-13: an error toast stays until it is dismissed.
 */

function approval(): ApprovalRequest {
  return {
    id: 'ap-1',
    runId: 'r1',
    tool: 'run_command',
    summary: 'run ls',
    arguments: {},
    kind: 'shell'
  }
}

function toolResult(runId: string): AgentEvent {
  return {
    type: 'tool:result',
    runId,
    at: Date.now(),
    result: { actionId: 'a1', name: 'read_file', ok: true, durationMs: 1, attempts: 1 }
  }
}

function toolMessage(id: string, runId: string): ChatMessage {
  return { id, role: 'tool', content: 'read_file', at: 1, runId }
}

beforeEach(() => {
  useStore.setState({ toasts: [], messages: [], running: false, currentRunId: null })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('decision gates wait for main (U-5)', () => {
  it('keeps the approval dialog open and toasts when the reply fails', async () => {
    ;(window as unknown as { api: unknown }).api = {
      agent: { respondApproval: vi.fn(async () => Promise.reject(new Error('ipc down'))) }
    }
    useStore.setState({ pendingApproval: approval(), toasts: [] })

    await useStore.getState().respondApproval(true)

    expect(useStore.getState().pendingApproval).not.toBeNull()
    expect(useStore.getState().toasts).toHaveLength(1)
    expect(useStore.getState().toasts[0].kind).toBe('error')
    expect(useStore.getState().toasts[0].message).toContain('ipc down')
  })

  it('clears the approval dialog only after the reply succeeds', async () => {
    const respond = vi.fn(async () => true)
    ;(window as unknown as { api: unknown }).api = { agent: { respondApproval: respond } }
    useStore.setState({ pendingApproval: approval(), toasts: [] })

    await useStore.getState().respondApproval({ approved: false })
    expect(respond).toHaveBeenCalledWith('ap-1', { approved: false })

    expect(useStore.getState().pendingApproval).toBeNull()
    expect(useStore.getState().toasts).toHaveLength(0)
  })

  it('keeps the plan dialog open when the reply fails', async () => {
    ;(window as unknown as { api: unknown }).api = {
      agent: { respondPlan: vi.fn(async () => Promise.reject(new Error('nope'))) }
    }
    useStore.setState({ pendingPlan: { id: 'p1' } as never, toasts: [] })

    await useStore.getState().respondPlan({ type: 'approve' } as never)

    expect(useStore.getState().pendingPlan).not.toBeNull()
  })

  /**
   * v2.8.0: the broker had no `approval:resolved`, so a fail-closed timeout (2 minutes)
   * denied the action while the modal stayed on screen offering Approve — a button that
   * could no longer do anything, until `run:end` happened to clear it.
   */
  it('closes the approval dialog when main reports it was settled', () => {
    useStore.setState({ pendingApproval: approval() })

    useStore.getState().applyEvent({
      type: 'approval:resolved',
      id: 'ap-1',
      approved: false,
      at: 1
    })

    expect(useStore.getState().pendingApproval).toBeNull()
  })

  it('ignores a resolution for a different request', () => {
    useStore.setState({ pendingApproval: approval() })

    useStore.getState().applyEvent({
      type: 'approval:resolved',
      id: 'someone-elses-id',
      approved: true,
      at: 1
    })

    expect(useStore.getState().pendingApproval).not.toBeNull()
  })

  it('keeps the preflight dialog open when the reply fails', async () => {
    ;(window as unknown as { api: unknown }).api = {
      agent: { respondPreflight: vi.fn(async () => Promise.reject(new Error('nope'))) }
    }
    useStore.setState({ pendingPreflight: { id: 'f1' } as never, toasts: [] })

    await useStore.getState().respondPreflight('cancel' as never)

    expect(useStore.getState().pendingPreflight).not.toBeNull()
  })
})

describe('message history cap (U-10)', () => {
  it('drops the oldest messages once the cap is exceeded', () => {
    const history = Array.from({ length: 500 }, (_, index) => toolMessage(`m${index}`, 'old'))
    useStore.setState({ messages: history, currentRunId: null })

    useStore.getState().applyEvent(toolResult('new'))

    const messages = useStore.getState().messages
    expect(messages).toHaveLength(500)
    expect(messages[0].id).toBe('m1')
    expect(messages[messages.length - 1].runId).toBe('new')
  })

  it('never drops a message belonging to the in-flight run', () => {
    // A long run that started before the cap was reached: its early messages are
    // older than the tail we would otherwise keep.
    const history = [
      ...Array.from({ length: 5 }, (_, index) => toolMessage(`live${index}`, 'live')),
      ...Array.from({ length: 595 }, (_, index) => toolMessage(`m${index}`, 'old'))
    ]
    useStore.setState({ messages: history, currentRunId: 'live' })

    useStore.getState().applyEvent(toolResult('live'))

    const messages = useStore.getState().messages
    expect(messages.filter((message) => message.runId === 'live')).toHaveLength(6)
    expect(messages[0].runId).toBe('live')
  })
})

describe('error toasts require dismissal (U-13)', () => {
  it('keeps an error toast past the auto-dismiss window', () => {
    vi.useFakeTimers()
    useStore.getState().pushToast('error', 'the run failed')

    vi.advanceTimersByTime(30_000)

    expect(useStore.getState().toasts).toHaveLength(1)
  })

  it('still auto-dismisses a success toast', () => {
    vi.useFakeTimers()
    useStore.getState().pushToast('success', 'saved')

    vi.advanceTimersByTime(3_500)

    expect(useStore.getState().toasts).toHaveLength(0)
  })
})
