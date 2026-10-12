// @vitest-environment jsdom
/**
 * v2.6.3 Topic 3.2 - interactive preflight override must reach the renderer.
 *
 * A blocked action used to be dropped silently. These tests pin the store
 * wiring (request -> pending, answer -> IPC call, resolved -> clear) and the
 * dialog's tier-aware choices, including the fail-closed auto-cancel.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import PreflightOverrideDialog from '../../src/renderer/src/components/PreflightOverrideDialog'
import { useStore } from '../../src/renderer/src/store'
import type { PreflightRequestView } from '@shared/preflight'

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

const respondPreflight = vi.fn().mockResolvedValue(true)

beforeEach(() => {
  respondPreflight.mockClear()
  ;(window as unknown as { api: unknown }).api = {
    agent: { respondPreflight }
  }
  useStore.setState({ pendingPreflight: null, messages: [], logs: [], decisions: [] })
})

afterEach(cleanup)

function request(overrides: Partial<PreflightRequestView> = {}): PreflightRequestView {
  return {
    id: 'preflight-1',
    runId: 'run-1',
    tool: 'remote_write_file',
    tier: 'block',
    reason: 'Disk 95% full',
    checks: [{ name: 'disk', status: 'fail', message: 'Disk 95% full' }],
    options: [
      { id: 'cleanup', labelKey: 'preflight.cleanup', tone: 'primary' },
      { id: 'proceed', labelKey: 'preflight.override', tone: 'danger' },
      { id: 'cancel', labelKey: 'common.cancel', tone: 'neutral' }
    ],
    timeoutMs: 5 * 60 * 1000,
    ...overrides
  }
}

describe('preflight override store wiring', () => {
  it('opens a prompt on preflight:request and answers via IPC', () => {
    useStore.getState().applyEvent({ type: 'preflight:request', request: request() })
    expect(useStore.getState().pendingPreflight?.id).toBe('preflight-1')

    useStore.getState().respondPreflight('proceed')
    expect(useStore.getState().pendingPreflight).toBeNull()
    expect(respondPreflight).toHaveBeenCalledWith('preflight-1', 'proceed')
  })

  it('ignores a resolved event for a different prompt', () => {
    useStore.getState().applyEvent({ type: 'preflight:request', request: request({ id: 'a' }) })
    useStore.getState().applyEvent({ type: 'preflight:resolved', id: 'b', choice: 'cancel', at: 1 })
    expect(useStore.getState().pendingPreflight?.id).toBe('a')
  })

  it('clears a matching prompt on preflight:resolved', () => {
    useStore.getState().applyEvent({ type: 'preflight:request', request: request({ id: 'a' }) })
    useStore
      .getState()
      .applyEvent({ type: 'preflight:resolved', id: 'a', choice: 'proceed', at: 1 })
    expect(useStore.getState().pendingPreflight).toBeNull()
  })

  it('clears the prompt when a new run starts', () => {
    useStore.getState().applyEvent({ type: 'preflight:request', request: request() })
    useStore.getState().applyEvent({ type: 'run:start', runId: 'run-2', task: 'next', at: 1 })
    expect(useStore.getState().pendingPreflight).toBeNull()
  })
})

describe('PreflightOverrideDialog', () => {
  it('shows the reason, checks and block-tier choices', () => {
    useStore.setState({ pendingPreflight: request() })
    render(<PreflightOverrideDialog />)

    expect(screen.getByTestId('preflight-reason').textContent).toContain('Disk 95% full')
    expect(screen.getByTestId('preflight-checks').textContent).toContain('disk')
    expect(screen.getByRole('button', { name: /Override anyway/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Cleanup and proceed/i })).toBeTruthy()
  })

  it('sends the chosen option and closes', () => {
    useStore.setState({ pendingPreflight: request() })
    render(<PreflightOverrideDialog />)

    fireEvent.click(screen.getByRole('button', { name: /Override anyway/i }))
    expect(respondPreflight).toHaveBeenCalledWith('preflight-1', 'proceed')
    expect(useStore.getState().pendingPreflight).toBeNull()
  })

  it('offers no override for a critical tier', () => {
    useStore.setState({
      pendingPreflight: request({
        tier: 'critical',
        options: [
          { id: 'retry', labelKey: 'preflight.retry', tone: 'primary' },
          { id: 'cancel', labelKey: 'common.cancel', tone: 'neutral' }
        ]
      })
    })
    render(<PreflightOverrideDialog />)

    expect(screen.getByRole('button', { name: /Retry check/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Override anyway/i })).toBeNull()
  })

  it('fails closed: auto-cancels when the timeout elapses', () => {
    vi.useFakeTimers()
    try {
      useStore.setState({ pendingPreflight: request({ timeoutMs: 1000 }) })
      render(<PreflightOverrideDialog />)

      act(() => {
        vi.advanceTimersByTime(1100)
      })
      expect(respondPreflight).toHaveBeenCalledWith('preflight-1', 'cancel')
    } finally {
      vi.useRealTimers()
    }
  })
})
