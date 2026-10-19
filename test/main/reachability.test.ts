import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearReachabilityCache,
  observeServerReachability,
  type ReachabilityHost
} from '../../src/main/reachability'
import type { TcpProbe } from '../../src/main/server-connection-test'
import type { VpsExecResult } from '../../src/shared/vps'

/**
 * X4 — the real probes, without a socket and without SSH.
 *
 * `observeServerReachability` is the only place that opens a connection or runs a command, so this
 * file pins what it asks, of whom, and what it does when a probe is refused. The TCP probe is
 * injected (`probe(port)`-style, no `vi.mock`), the SSH layer is a fake host, and nothing here
 * touches the network.
 */

const TARGET = { id: 'tgt', name: 'yoserver-spmotor', host: '212.16.86.23', port: 22 }

interface FakeHost extends ReachabilityHost {
  calls: Array<{ serverId: string; command: string }>
}

function fakeHost(options: {
  connected: string[]
  exec?: (serverId: string, command: string) => VpsExecResult
  roster?: Array<{ id: string; name: string }>
}): FakeHost {
  const calls: Array<{ serverId: string; command: string }> = []
  return {
    calls,
    connectedServers: () => options.connected,
    exec: async (serverId, command) => {
      calls.push({ serverId, command })
      return options.exec?.(serverId, command) ?? { ok: true, stdout: '', stderr: '', exitCode: 0 }
    },
    listServers: async () =>
      options.roster ?? [
        { id: 'src', name: 'spmotor' },
        { id: 'tgt', name: 'yoserver-spmotor' }
      ]
  }
}

/** A `/dev/tcp` probe that says what the shell would say. */
const portProbe = (stdout: string) => (serverId: string, command: string): VpsExecResult =>
  command.includes('/dev/tcp') || command.includes('PROBE_EXIT')
    ? { ok: true, stdout, stderr: '', exitCode: 0 }
    : serverId === 'tgt' && command.startsWith('ss ')
      ? { ok: true, stdout: 'LISTEN 0 4096 0.0.0.0:22 0.0.0.0:*', stderr: '', exitCode: 0 }
      : { ok: true, stdout: '', stderr: '', exitCode: 0 }

const connects: TcpProbe = async () => ({ connected: true, latencyMs: 7 })
const timesOut: TcpProbe = async () => ({
  connected: false,
  code: 'ETIMEDOUT',
  message: 'timed out'
})

beforeEach(() => {
  clearReachabilityCache()
})

describe('the preflight asks all three paths', () => {
  it('asks this computer, a connected source server and the target itself', async () => {
    const host = fakeHost({
      connected: ['src', 'tgt'],
      exec: portProbe('PROBE_EXIT:0')
    })

    const observed = await observeServerReachability(host, TARGET, { probe: connects, now: () => 1_000 })

    expect(observed.local).toMatchObject({ ok: true, outcome: 'open', from: 'this-machine' })
    expect(observed.report.local.open).toBe(true)
    expect(observed.report.source.open).toBe(true)
    expect(observed.report.target.open).toBe(true)
    expect(observed.report.agreement).toBe('all-open')
    // The source is a *different* server, and the command names the target.
    expect(host.calls).toHaveLength(2)
    expect(host.calls[0]).toMatchObject({ serverId: 'src' })
    expect(host.calls[0]?.command).toContain('/dev/tcp/212.16.86.23/22')
    expect(host.calls[1]?.serverId).toBe('tgt')
    expect(host.calls[1]?.command).toMatch(/^ss -lnt/)
    // The source server is named in the sentence, not a uuid.
    expect(observed.report.summary).toContain('spmotor')
  })

  it('never runs the source probe without a session — the path is unknown', async () => {
    const host = fakeHost({ connected: [] })

    const observed = await observeServerReachability(host, TARGET, { probe: connects, now: () => 1_000 })

    expect(host.calls).toEqual([])
    expect(observed.report.source.open).toBeNull()
    expect(observed.report.source.detail).toMatch(/no SSH session/)
    expect(observed.report.summary).toContain('was not tested')
    expect(observed.report.summary).not.toMatch(/offline|is down/i)
  })

  it("reads the target's own listener table only when the target has a session", async () => {
    const host = fakeHost({ connected: ['src'], exec: portProbe('PROBE_EXIT:0') })

    const observed = await observeServerReachability(host, TARGET, { probe: connects, now: () => 1_000 })

    expect(observed.report.target.open).toBeNull()
    expect(observed.report.target.detail).toMatch(/no session to the target/)
    expect(host.calls.map((call) => call.serverId)).toEqual(['src'])
  })

  it('does not probe itself as the source when the target is the only session', async () => {
    const host = fakeHost({
      connected: ['tgt'],
      exec: (_serverId, command) =>
        command.startsWith('ss ')
          ? { ok: true, stdout: 'LISTEN 0 4096 0.0.0.0:22 0.0.0.0:*', stderr: '', exitCode: 0 }
          : { ok: true, stdout: 'PROBE_EXIT:0', stderr: '', exitCode: 0 }
    })

    const observed = await observeServerReachability(host, TARGET, { probe: connects, now: () => 1_000 })

    // "source → target" from the target itself would prove nothing, so it is honestly unknown.
    expect(observed.report.source.open).toBeNull()
    expect(observed.report.target.open).toBe(true)
    expect(host.calls).toHaveLength(1)
    expect(host.calls[0]?.command).toMatch(/^ss -lnt/)
  })
})

describe('a probe that could not run is not a negative fact', () => {
  it('turns a policy block into unknown with the reason', async () => {
    const host = fakeHost({
      connected: ['src'],
      exec: () => ({ ok: false, stdout: '', stderr: '', exitCode: 1, blocked: true, reason: 'read-only host' })
    })

    const observed = await observeServerReachability(host, TARGET, { probe: connects, now: () => 1_000 })

    expect(observed.report.source.open).toBeNull()
    expect(observed.report.source.detail).toContain("blocked by this host's policy")
    expect(observed.report.source.detail).toContain('read-only host')
  })

  it('turns a thrown command into unknown instead of failing the observation', async () => {
    const host: ReachabilityHost = {
      connectedServers: () => ['src'],
      exec: async () => {
        throw new Error('connection closed')
      }
    }

    const observed = await observeServerReachability(host, TARGET, { probe: connects, now: () => 1_000 })
    expect(observed.report.source.open).toBeNull()
    expect(observed.report.source.detail).toContain('could not be run')
  })

  it('does not read a missing ss/netstat on the target as "nothing listens"', async () => {
    const host = fakeHost({
      connected: ['tgt'],
      exec: (_serverId, command) =>
        command.startsWith('ss ')
          ? { ok: false, stdout: '', stderr: '', exitCode: 127 }
          : { ok: true, stdout: 'PROBE_EXIT:0', stderr: '', exitCode: 0 }
    })

    const observed = await observeServerReachability(host, TARGET, { probe: connects, now: () => 1_000 })
    expect(observed.report.target.open).toBeNull()
    expect(observed.report.target.detail).toMatch(/neither ss nor netstat/)
  })
})

describe('the two-path disagreement from the log', () => {
  it('reports "local open, source closed" and offers both ways forward', async () => {
    const refused = fakeHost({
      connected: ['src'],
      exec: () => ({
        ok: true,
        stdout: 'bash: connect: Connection refused\nPROBE_EXIT:1',
        stderr: '',
        exitCode: 0
      })
    })

    const report = (
      await observeServerReachability(refused, TARGET, { probe: connects, now: () => 1_000 })
    ).report

    expect(report.source.open).toBe(false)
    expect(report.local.open).toBe(true)
    expect(report.recommendation).toBe('through-this-computer')
    expect(report.summary).toContain('open from this computer and closed from spmotor')
    expect(report.nextSteps[0]).toContain('Transfer through this computer')
    expect(report.nextSteps[1]).toContain('Ask the provider to open TCP 22')
  })

  it('keeps the local timeout in the local answer, not as a verdict about the server', async () => {
    const host = fakeHost({ connected: [] })

    const observed = await observeServerReachability(host, TARGET, { probe: timesOut, now: () => 1_000 })

    expect(observed.local).toMatchObject({ ok: false, outcome: 'timeout', message: 'timed out' })
    expect(observed.report.local).toMatchObject({ from: 'local', open: false, detail: 'timed out' })
    expect(observed.report.source.open).toBeNull()
  })
})

describe('one observation per window', () => {
  it('reuses a fresh observation and probes again once it is stale', async () => {
    let clock = 1_000
    const host = fakeHost({ connected: ['src'], exec: portProbe('PROBE_EXIT:0') })
    let dials = 0
    const probe: TcpProbe = async () => {
      dials += 1
      return { connected: true, latencyMs: 3 }
    }
    const options = { probe, now: () => clock, maxAgeMs: 20_000 }

    await observeServerReachability(host, TARGET, options)
    await observeServerReachability(host, TARGET, options)
    expect(dials).toBe(1)
    // One source probe: the target has no session, so its listener table is unknown.
    expect(host.calls).toHaveLength(1)

    clock += 30_000
    await observeServerReachability(host, TARGET, options)
    expect(dials).toBe(2)
    expect(host.calls).toHaveLength(2)
  })

  it('observes again immediately when reuse is disabled', async () => {
    const host = fakeHost({ connected: [] })
    let dials = 0
    const probe: TcpProbe = async () => {
      dials += 1
      return { connected: true, latencyMs: 3 }
    }
    await observeServerReachability(host, TARGET, { probe, now: () => 1_000, maxAgeMs: 0 })
    await observeServerReachability(host, TARGET, { probe, now: () => 1_001, maxAgeMs: 0 })
    expect(dials).toBe(2)
  })
})
