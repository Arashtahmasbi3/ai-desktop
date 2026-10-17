/**
 * "Can this computer reach that server?" (v4.1, checklist item 16)
 *
 * The agent used to answer this itself, by writing a port scan with bash's `/dev/tcp`. That is how a
 * six-port sweep ended up inside a plan the user had to approve, and how a firewall problem looked like a
 * broken agent. Asking the network a question is the app's job.
 *
 * The probe is injected, so every branch is exercised without opening a socket and without `vi.mock`.
 */
import { describe, expect, it } from 'vitest'
import { testServerConnection, type TcpProbe } from '../../src/main/server-connection-test'

const ok = (latencyMs: number): TcpProbe => async () => ({ connected: true, latencyMs })
const fails = (code: string, message: string): TcpProbe => async () => ({ connected: false, code, message })

describe('testServerConnection', () => {
  it('reports an open port with its latency', async () => {
    const result = await testServerConnection({ host: '10.0.0.5', port: 22 }, ok(82))
    expect(result).toMatchObject({ ok: true, outcome: 'open', latencyMs: 82, host: '10.0.0.5', port: 22 })
  })

  it('reports a timeout as a timeout, not as "down"', async () => {
    const result = await testServerConnection({ host: '10.0.0.5', port: 22 }, fails('ETIMEDOUT', 'timed out'))
    expect(result.ok).toBe(false)
    expect(result.outcome).toBe('timeout')
    expect(result.message).toBe('timed out')
  })

  it('separates "refused" from "unreachable", because the fixes differ', async () => {
    const refused = await testServerConnection(
      { host: '10.0.0.5', port: 22 },
      fails('ECONNREFUSED', 'connect ECONNREFUSED')
    )
    const unreachable = await testServerConnection(
      { host: 'nope.invalid', port: 22 },
      fails('ENOTFOUND', 'getaddrinfo ENOTFOUND')
    )
    expect(refused.outcome).toBe('refused')
    expect(unreachable.outcome).toBe('unreachable')
  })

  it('always says where the test ran from', async () => {
    const result = await testServerConnection({ host: '10.0.0.5', port: 22 }, ok(1))
    expect(result.from).toBe('this-machine')
  })

  it('refuses to test a server with no usable host or port', async () => {
    const neverCalled: TcpProbe = async () => {
      throw new Error('the probe must not run for an invalid target')
    }
    expect((await testServerConnection({ host: '', port: 22 }, neverCalled)).outcome).toBe('invalid')
    expect((await testServerConnection({ host: 'h', port: 0 }, neverCalled)).outcome).toBe('invalid')
    expect((await testServerConnection({ host: 'h', port: 70000 }, neverCalled)).outcome).toBe('invalid')
  })

  it('passes the timeout through to the probe', async () => {
    let seen = 0
    const probe: TcpProbe = async (_host, _port, timeoutMs) => {
      seen = timeoutMs
      return { connected: true, latencyMs: 1 }
    }
    await testServerConnection({ host: '10.0.0.5', port: 22 }, probe, 1234)
    expect(seen).toBe(1234)
  })
})
