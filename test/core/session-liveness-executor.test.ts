import { describe, expect, it } from 'vitest'
import type { AgentAction, AgentToolResult } from '../../src/shared/agent'
import type { VpsReconnectOutcome } from '../../src/shared/vps'
import { SessionLivenessExecutor } from '../../src/core/tools/session-liveness-executor'

/**
 * R1 - the one-reconnect wrapper around a remote tool.
 *
 * The wrapper must ask for exactly one reconnect, report that outcome with the failure, and never
 * silently re-run the failed call: the next tool invocation runs on the live session. It must also
 * refuse to tear down a healthy connection just because a command printed "not connected".
 */

function action(serverId?: string): AgentAction {
  const args: Record<string, unknown> = serverId ? { server_id: serverId, command: 'pwd' } : { command: 'pwd' }
  return {
    id: 'call-1',
    name: 'remote_shell',
    arguments: args,
    rawArguments: JSON.stringify(args),
    valid: true,
    signature: 'remote_shell:pwd'
  }
}

function failure(text: string, output = ''): AgentToolResult {
  return {
    actionId: 'call-1',
    name: 'remote_shell',
    ok: false,
    output,
    error: text,
    attempts: 1,
    durationMs: 1
  }
}

function success(text: string): AgentToolResult {
  return {
    actionId: 'call-1',
    name: 'remote_shell',
    ok: true,
    output: text,
    attempts: 1,
    durationMs: 1
  }
}

/** An executor whose answers are scripted in order, and which counts its runs. */
class ScriptedExecutor {
  calls = 0
  constructor(private readonly results: AgentToolResult[]) {}
  async execute(): Promise<AgentToolResult> {
    const result = this.results[Math.min(this.calls, this.results.length - 1)]!
    this.calls += 1
    return result
  }
}

interface ReconnectCall {
  serverId: string
  reason: string
}

function harness(options: {
  results: AgentToolResult[]
  connected: boolean
  /** What the held handle answers when asked. Defaults to the cached belief. */
  alive?: boolean
  outcome: VpsReconnectOutcome
  fallbackServerId?: string
}) {
  const inner = new ScriptedExecutor(options.results)
  const calls: ReconnectCall[] = []
  const probes: string[] = []
  const executor = new SessionLivenessExecutor(inner, {
    isConnected: () => options.connected,
    probe: async (serverId) => {
      probes.push(serverId)
      return options.alive ?? options.connected
    },
    reconnect: async (serverId, reason) => {
      calls.push({ serverId, reason })
      return options.outcome
    },
    ...(options.fallbackServerId ? { fallbackServerId: options.fallbackServerId } : {})
  })
  return { inner, calls, probes, executor }
}

const FAILED_RECONNECT: VpsReconnectOutcome = {
  ok: false,
  state: { status: 'disconnected', serverId: 'srv-1', error: 'ECONNRESET' },
  reason: 'remote_shell: Not connected'
}

const WORKED_RECONNECT: VpsReconnectOutcome = {
  ok: true,
  state: { status: 'connected', serverId: 'srv-1' },
  reason: 'remote_shell: Not connected'
}

describe('R1 - one reconnect, then report the outcome', () => {
  it('attempts exactly once, reports the failure, and never re-runs the failed call', async () => {
    const { inner, calls, probes, executor } = harness({
      results: [failure('Not connected')],
      connected: false,
      outcome: FAILED_RECONNECT
    })

    const result = await executor.execute(action('srv-1'))

    expect(calls).toHaveLength(1)
    expect(calls[0]?.serverId).toBe('srv-1')
    // The audit reason is the tool's own words, so the log says what triggered the attempt.
    expect(calls[0]?.reason).toContain('remote_shell')
    expect(calls[0]?.reason).toContain('Not connected')
    // A session the app already knows is gone has no handle to ask: no probe, only the reconnect.
    expect(probes).toHaveLength(0)
    // One run of the tool: the reconnect is not a second silent retry of the same call.
    expect(inner.calls).toBe(1)
    expect(result.ok).toBe(false)
    expect(result.output).toContain('one reconnect attempt failed')
    expect(result.output).toContain('ECONNRESET')
    expect(result.error).toContain('one reconnect attempt failed')
  })

  it('a successful reconnect is reported, and the next tool call runs', async () => {
    const { calls, executor } = harness({
      results: [failure('Server srv-1 is not connected.'), success('ran:pwd')],
      connected: false,
      outcome: WORKED_RECONNECT,
      fallbackServerId: 'srv-1'
    })

    const first = await executor.execute(action('srv-1'))
    expect(calls).toHaveLength(1)
    expect(first.ok).toBe(false)
    expect(first.output).toContain('one reconnect attempt succeeded')

    const next = await executor.execute(action('srv-1'))
    expect(next.ok).toBe(true)
    expect(next.output).toBe('ran:pwd')
    // Only the failed call reconnected; the live one did not ask again.
    expect(calls).toHaveLength(1)
  })

  /*
   * R6a: the note is appended to the failure the user reads. It used to say
   * `... the SSH session to server 34c80099-... is gone` — the same shape of leak as the
   * diagnostics sentence. It now names the machine; the id stays on the tool result.
   */
  it('names the server in the note instead of printing its id (R6)', async () => {
    const uuid = '34c80099-2868-40a1-bef4-9b23d865db0b'
    const executor = new SessionLivenessExecutor(
      new ScriptedExecutor([failure('Server spmotor is not connected.')]),
      {
        isConnected: () => false,
        probe: async () => false,
        reconnect: async () => FAILED_RECONNECT,
        serverName: async (serverId: string) => (serverId === uuid ? 'spmotor' : undefined)
      }
    )

    const result = await executor.execute(action(uuid))

    expect(result.output).toContain('spmotor')
    expect(result.output).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
    )
  })

  it('uses the pinned server when the action names none', async () => {
    const { calls, executor } = harness({
      results: [failure('Not connected')],
      connected: false,
      outcome: FAILED_RECONNECT,
      fallbackServerId: 'srv-pinned'
    })
    await executor.execute(action())
    expect(calls.map((call) => call.serverId)).toEqual(['srv-pinned'])
  })
})

describe('the stale belief: a half-open session is checked, not assumed', () => {
  /*
   * The gap 4.3.1 shipped with. The manager held a dead handle, so `isConnected` answered true; the
   * tool's words were `Not connected`, which is the *other* branch's vocabulary; and the transport
   * regex deliberately does not contain it. Nothing fired: no probe, no transition, no reconnect,
   * and the dot stayed green. These cases put the observation in charge of the belief.
   */
  it('probes the held handle and attempts exactly one reconnect when it answers nothing', async () => {
    const { calls, probes, executor } = harness({
      results: [failure('Not connected')],
      connected: true,
      alive: false,
      outcome: FAILED_RECONNECT
    })

    const result = await executor.execute(action('srv-1'))

    // The handle — not the cached map — decided.
    expect(probes).toEqual(['srv-1'])
    expect(calls).toHaveLength(1)
    expect(calls[0]?.serverId).toBe('srv-1')
    // The card says which evidence found the session gone, and what the attempt did.
    expect(result.output).toContain('a liveness probe on the held connection found no session')
    expect(result.output).toContain('one reconnect attempt failed')
    expect(result.output).toContain('ECONNRESET')
    expect(result.error).toContain('one reconnect attempt failed')
  })

  it('reports a successful reconnect after the probe finds the handle dead', async () => {
    const { calls, probes, executor } = harness({
      results: [failure('Not connected')],
      connected: true,
      alive: false,
      outcome: WORKED_RECONNECT
    })

    const result = await executor.execute(action('srv-1'))

    expect(probes).toEqual(['srv-1'])
    expect(calls).toHaveLength(1)
    expect(result.output).toContain('one reconnect attempt succeeded')
    expect(result.output).toContain('a liveness probe on the held connection found no session')
  })

  it('leaves the session alone when the probe says it is alive', async () => {
    const { calls, probes, executor } = harness({
      results: [failure('exit status 1', 'VPN is not connected')],
      connected: true,
      alive: true,
      outcome: WORKED_RECONNECT
    })

    const result = await executor.execute(action('srv-1'))

    // The probe ran, answered, and that answer is the short circuit: no reconnect, no note.
    expect(probes).toEqual(['srv-1'])
    expect(calls).toHaveLength(0)
    expect(result.ok).toBe(false)
    expect(result.output).toBe('VPN is not connected')
    expect(result.error).toBe('exit status 1')
  })

  it('still reconnects on transport words without waiting for a probe', async () => {
    const { calls, probes, executor } = harness({
      results: [failure('channel closed by the remote host')],
      connected: true,
      alive: true,
      outcome: WORKED_RECONNECT
    })
    await executor.execute(action('srv-1'))
    // The handle itself reported the death: there is nothing left to ask.
    expect(probes).toHaveLength(0)
    expect(calls).toHaveLength(1)
  })
})

describe('R1 - a live session is not torn down by a command that says "not connected"', () => {
  it('still reconnects when a live handle reports transport words', async () => {
    const { calls, probes, executor } = harness({
      results: [failure('remote_shell failed: Client not connected')],
      connected: true,
      outcome: WORKED_RECONNECT
    })
    await executor.execute(action('srv-1'))
    expect(probes).toHaveLength(0)
    expect(calls).toHaveLength(1)
  })

  it('does not reconnect a failure that is not about the session', async () => {
    const { calls, executor } = harness({
      results: [failure('Permission denied (publickey)')],
      connected: false,
      outcome: FAILED_RECONNECT
    })
    await executor.execute(action('srv-1'))
    expect(calls).toHaveLength(0)
  })

  it('does nothing when there is no server to reconnect', async () => {
    const { calls, executor } = harness({
      results: [failure('Not connected')],
      connected: false,
      outcome: FAILED_RECONNECT
    })
    await executor.execute(action())
    expect(calls).toHaveLength(0)
  })
})
