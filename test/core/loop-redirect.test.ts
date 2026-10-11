import { describe, it, expect } from 'vitest'
import { LoopDetector } from '@core/agent/loop-detector'
import { findAlternatives } from '@core/agent/strategies'
import type { AgentToolResult } from '@shared/agent'

function detector(): LoopDetector {
  return new LoopDetector(
    {},
    { findAlternative: (toolName, args, error) => findAlternatives(toolName, args, error) }
  )
}

function ok(output = 'ok'): AgentToolResult {
  return { actionId: 'a', name: 't', ok: true, output, attempts: 1, durationMs: 1 }
}

/**
 * Task 4.5 - loop detection redirects to an alternative instead of stopping.
 * The original call is never executed; the model is handed a concrete alternative.
 */
describe('Task 4.5 - loop redirect', () => {
  it('1. a failing loop returns a redirect with an alternative', () => {
    const loop = detector()
    const args = { command: 'pm2 list' }
    for (let i = 0; i < 2; i += 1) {
      expect(loop.beforeToolCall('remote_shell', args).allow).toBe(true)
      loop.afterToolCall('remote_shell', { ok: false, error: 'pm2: command not found' }, args)
    }
    const decision = loop.beforeToolCall('remote_shell', args)
    expect(decision.allow).toBe(false)
    expect(decision.action).toBe('redirect')
    expect(decision.alternative?.args.command).toContain('systemctl')
    // A redirect is recoverable: the run is not marked stopped.
    expect(loop.isStopped).toBe(false)
  })

  it('2. the suggested alternative executes and recovers the run', async () => {
    const loop = detector()
    const args = { command: 'pm2 list' }
    for (let i = 0; i < 2; i += 1) {
      loop.beforeToolCall('remote_shell', args)
      loop.afterToolCall('remote_shell', { ok: false, error: 'pm2: command not found' }, args)
    }
    const decision = loop.beforeToolCall('remote_shell', args)
    expect(decision.action).toBe('redirect')

    // "Try alternative": run the suggested call through the real executor path.
    const executed: Array<{ tool: string; args: unknown }> = []
    const execute = async (tool: string, callArgs: unknown): Promise<AgentToolResult> => {
      executed.push({ tool, args: callArgs })
      return ok('systemd units')
    }
    const alternative = decision.alternative!
    const result = await execute(alternative.toolName, alternative.args)
    expect(result.ok).toBe(true)
    expect(executed[0].tool).toBe('remote_shell')
    expect(executed[0].args).toEqual(alternative.args)
    // A successful alternative clears the failure streak, so the run continues.
    loop.afterToolCall(alternative.toolName, { ok: true }, alternative.args)
    expect(loop.isStopped).toBe(false)
  })

  it('3. a blocked path is redirected to a whitelisted command', () => {
    const loop = detector()
    const args = { command: 'cat /etc/os-release' }
    loop.beforeToolCall('remote_shell', args)
    loop.afterToolCall(
      'remote_shell',
      { ok: false, blocked: true, error: 'Blocked: path is outside project root' },
      args
    )
    const decision = loop.beforeToolCall('remote_shell', args)
    expect(decision.action).toBe('redirect')
    expect(decision.alternative?.args.command).toBe('uname -a')
  })

  it('4. ignoring the redirect stops the run on the next repeat', () => {
    const loop = detector()
    const args = { command: 'pm2 list' }
    for (let i = 0; i < 2; i += 1) {
      loop.beforeToolCall('remote_shell', args)
      loop.afterToolCall('remote_shell', { ok: false, error: 'pm2: command not found' }, args)
    }
    const first = loop.beforeToolCall('remote_shell', args)
    expect(first.action).toBe('redirect')

    // The model repeats the same failing call: now it is a hard stop.
    const second = loop.beforeToolCall('remote_shell', args)
    expect(second.allow).toBe(false)
    expect(second.action).toBe('stop')
  })

  it('5. without a matching strategy the detector still stops as before', () => {
    const loop = detector()
    for (let i = 0; i < 5; i += 1) {
      loop.beforeToolCall('remote_shell', { command: 'ls -la' })
      loop.afterToolCall('remote_shell', { ok: true }, { command: 'ls -la' })
    }
    const decision = loop.beforeToolCall('remote_shell', { command: 'ls -la' })
    expect(decision.action).toBe('stop')
    expect(loop.isStopped).toBe(true)
  })
})
