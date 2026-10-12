/**
 * v2.6.3 T3.2.1 - PreflightBroker.
 *
 * Mirrors ApprovalBroker/PlanBroker: emit a request, resolve with the user's
 * choice, and fail closed (cancel) on timeout or abort.
 */
import { describe, expect, it, vi } from 'vitest'
import { PreflightBroker } from '@main/preflight-broker'
import type { AgentAction } from '@shared/agent'
import type { AgentEvent } from '@shared/ui'
import type { PreflightCheck } from '@core/agent/preflight'

function action(name: string, args: Record<string, unknown> = {}): AgentAction {
  return {
    id: 'a1',
    name,
    arguments: args,
    rawArguments: JSON.stringify(args),
    valid: true,
    signature: name
  }
}

const failing: PreflightCheck[] = [
  { name: 'workspace', status: 'pass', message: 'Workspace exists' },
  { name: 'disk', status: 'fail', message: 'Disk 95% full' }
]

describe('PreflightBroker', () => {
  it('emits a request carrying the reason, checks and tier options', () => {
    const events: AgentEvent[] = []
    const broker = new PreflightBroker({ emit: (event) => events.push(event) })
    void broker.request('run-1', action('remote_write_file', { path: '/srv/app/x' }), {
      tier: 'block',
      checks: failing
    })

    const request = events[0]
    expect(request.type).toBe('preflight:request')
    if (request.type !== 'preflight:request') throw new Error('unreachable')
    expect(request.request.tool).toBe('remote_write_file')
    expect(request.request.reason).toBe('Disk 95% full')
    expect(request.request.path).toBe('/srv/app/x')
    expect(request.request.options.map((option) => option.id)).toEqual([
      'cleanup',
      'proceed',
      'cancel'
    ])
  })

  it('shows the command for a shell action', () => {
    const events: AgentEvent[] = []
    const broker = new PreflightBroker({ emit: (event) => events.push(event) })
    void broker.request('run-1', action('remote_shell', { command: 'npm run build' }), {
      tier: 'block',
      checks: failing
    })
    const request = events[0]
    if (request.type !== 'preflight:request') throw new Error('unreachable')
    expect(request.request.command).toBe('npm run build')
  })

  it('resolves with the user choice and emits resolved', async () => {
    const events: AgentEvent[] = []
    const broker = new PreflightBroker({ emit: (event) => events.push(event), now: () => 42 })
    const promise = broker.request('run-1', action('remote_write_file', {}), {
      tier: 'block',
      checks: failing
    })
    const request = events[0]
    if (request.type !== 'preflight:request') throw new Error('unreachable')

    expect(broker.resolve(request.request.id, 'proceed')).toBe(true)
    await expect(promise).resolves.toBe('proceed')
    expect(events.some((event) => event.type === 'preflight:resolved')).toBe(true)
  })

  it('fails closed with cancel on timeout', async () => {
    vi.useFakeTimers()
    try {
      const events: AgentEvent[] = []
      const broker = new PreflightBroker({
        emit: (event) => events.push(event),
        timeoutMs: 1000
      })
      const promise = broker.request('run-1', action('remote_write_file', {}), {
        tier: 'critical',
        checks: [{ name: 'workspace', status: 'fail', message: 'missing' }]
      })
      expect(broker.pendingCount()).toBe(1)
      vi.advanceTimersByTime(1000)
      await expect(promise).resolves.toBe('cancel')
      expect(broker.pendingCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels every outstanding request on abort', async () => {
    const events: AgentEvent[] = []
    const broker = new PreflightBroker({ emit: (event) => events.push(event), timeoutMs: 60_000 })
    const first = broker.request('run-1', action('remote_write_file', {}), {
      tier: 'block',
      checks: failing
    })
    broker.cancelAll()
    await expect(first).resolves.toBe('cancel')
  })

  it('ignores an answer for an unknown id', () => {
    const broker = new PreflightBroker({ emit: () => undefined })
    expect(broker.resolve('nope', 'proceed')).toBe(false)
  })
})
