import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { AuditLog } from '../../src/core/agent/audit-log'
import { RateLimiter } from '../../src/core/agent/rate-limiter'
import type { SecretCipher } from '../../src/core/agent/persistence'
import { SshManager } from '../../src/main/ssh/ssh-manager'
import { VpsServerStore } from '../../src/main/ssh/server-store'
import { fingerprintFromKey } from '../../src/main/ssh/host-key-verify'
import { planRemoteRuntime } from '../../src/main/agent-service'
import type { AgentAction } from '../../src/shared/agent'
import type {
  SftpEntry,
  SshBackend,
  SshConnection,
  SshExecResult,
  SshShell
} from '../../src/main/ssh/backend'
import type { VpsLivenessEvent } from '../../src/shared/vps'

/**
 * R1 - liveness is a per-server fact, and a dropped session gets exactly one reconnect.
 *
 * Main already tracked one state per server; what was missing was a transition event that names
 * the server (so the renderer can update one fact instead of re-reading the last-writer-wins
 * snapshot) and the bounded reconnect that turns "Not connected" into an action with an outcome.
 */
const KEY = Buffer.from('fake-host-public-key')
const KEY_FINGERPRINT = fingerprintFromKey(KEY)

const cipher: SecretCipher = {
  encrypt: async (plaintext) => `enc:${Buffer.from(plaintext).toString('base64')}`,
  decrypt: async (ciphertext) => Buffer.from(ciphertext.replace(/^enc:/, ''), 'base64').toString()
}

class FakeConnection implements SshConnection {
  ended = false
  async exec(command: string): Promise<SshExecResult> {
    return { stdout: `ran:${command}`, stderr: '', exitCode: 0 }
  }
  async shell(): Promise<SshShell> {
    return {
      write: () => undefined,
      resize: () => undefined,
      close: () => undefined,
      onData: () => undefined,
      onClose: () => undefined
    }
  }
  async sftpList(): Promise<SftpEntry[]> {
    return []
  }
  async sftpRead(): Promise<string> {
    return ''
  }
  async sftpWrite(): Promise<void> {
    return undefined
  }
  end(): void {
    this.ended = true
  }
}

class FakeBackend implements SshBackend {
  connectCalls = 0
  failWith?: Error
  lastConnection?: FakeConnection

  async connect(config: { hostVerifier: (key: Buffer) => boolean }): Promise<SshConnection> {
    this.connectCalls += 1
    const accepted = config.hostVerifier(KEY)
    if (!accepted) throw new Error('Host key verification failed')
    if (this.failWith) throw this.failWith
    this.lastConnection = new FakeConnection()
    return this.lastConnection
  }
}

let dir: string
let store: VpsServerStore
let audit: AuditLog
let backend: FakeBackend
let now: number
let manager: SshManager
let events: VpsLivenessEvent[]

async function makeManager(): Promise<void> {
  store = new VpsServerStore({ file: join(dir, 'vps.json'), cipher })
  audit = new AuditLog({ file: join(dir, 'audit.json') })
  backend = new FakeBackend()
  now = 0
  events = []
  manager = new SshManager({
    store,
    backend,
    audit,
    rateLimiter: new RateLimiter(100, 60_000, () => now),
    now: () => now,
    onLiveness: (event) => events.push(event),
    readKeyFile: async () =>
      Buffer.from('-----BEGIN OPENSSH PRIVATE KEY-----\nfake-key-body\n-----END OPENSSH PRIVATE KEY-----')
  })
}

async function trusted(name: string): Promise<string> {
  const server = await store.save({
    name,
    host: `${name}.example.com`,
    username: 'root',
    authType: 'password',
    password: 'secret',
    trustFingerprint: KEY_FINGERPRINT
  })
  expect((await manager.connect(server.id)).status).toBe('connected')
  return server.id
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ssh-liveness-'))
  await makeManager()
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('R1 - a liveness event on every transition, naming the server', () => {
  it('publishes connecting then connected for each server, and only for that server', async () => {
    const a = await trusted('alpha')
    const b = await trusted('bravo')

    expect(events.filter((event) => event.serverId === a).map((event) => event.state.status)).toEqual([
      'connecting',
      'connected'
    ])
    expect(events.filter((event) => event.serverId === b).map((event) => event.state.status)).toEqual([
      'connecting',
      'connected'
    ])
    // The event's own server field and the state it carries agree, which is what lets the
    // renderer key its map without guessing.
    for (const event of events) expect(event.state.serverId).toBe(event.serverId)

    const forA = events.filter((event) => event.serverId === a).length
    await manager.disconnect(b)

    expect(manager.stateFor(b).status).toBe('disconnected')
    expect(manager.stateFor(a).status).toBe('connected')
    // A's history is untouched by B's transition.
    expect(events.filter((event) => event.serverId === a)).toHaveLength(forA)
    expect(events.at(-1)).toMatchObject({
      serverId: b,
      state: { status: 'disconnected', serverId: b }
    })
  })
})

describe('R1 - one reconnect attempt, with its outcome reported', () => {
  it('tries exactly once and reports the server as disconnected when the attempt fails', async () => {
    const a = await trusted('alpha')
    const b = await trusted('bravo')
    const attempts = backend.connectCalls

    await manager.disconnect(a)
    backend.failWith = new Error('ECONNRESET')
    const outcome = await manager.reconnectOnce(a, 'remote_shell: Not connected')

    expect(outcome.ok).toBe(false)
    expect(backend.connectCalls - attempts).toBe(1)
    expect(manager.stateFor(a).status).toBe('disconnected')
    expect(manager.stateFor(a).error).toMatch(/ECONNRESET/)
    // The other server's state is untouched.
    expect(manager.stateFor(b).status).toBe('connected')
    expect(manager.connectedServers()).toEqual([b])
    // The attempt is logged with the reason it was triggered, and only once.
    const logged = audit
      .entries()
      .filter((entry) => /one reconnect attempt/.test(entry.detail ?? ''))
    expect(logged).toHaveLength(1)
    expect(logged[0]?.detail).toContain('Not connected')
    expect(logged[0]?.serverId).toBe(a)
    // And the renderer hears that this server is gone.
    expect(events.at(-1)).toMatchObject({ serverId: a, state: { status: 'disconnected' } })
  })

  it('a successful reconnect makes the next tool run, and drops the stale handle first', async () => {
    const a = await trusted('alpha')
    // A handle that is still in the manager's map while the session behind it is dead: that is
    // the regression, and `connect()` alone would answer "already connected" instead of opening
    // a new session.
    const stale = backend.lastConnection
    const b = await trusted('bravo')
    const attempts = backend.connectCalls

    const outcome = await manager.reconnectOnce(a, 'remote_shell: Client not connected')

    expect(outcome.ok).toBe(true)
    expect(backend.connectCalls - attempts).toBe(1)
    expect(stale?.ended).toBe(true)
    expect(manager.stateFor(a).status).toBe('connected')

    const next = await manager.exec(a, 'pwd')
    expect(next.ok).toBe(true)
    expect(next.stdout).toBe('ran:pwd')
    expect(manager.stateFor(b).status).toBe('connected')
    expect(manager.connectedServers().sort()).toEqual([a, b].sort())
  })
})

describe('R1 - the wiring the agent actually gets', () => {
  /** A remote_shell call the orchestrator would make for this run. */
  function shellAction(serverId: string): AgentAction {
    const args = { server_id: serverId, command: 'pwd' }
    return {
      id: 'call-1',
      name: 'remote_shell',
      arguments: args,
      rawArguments: JSON.stringify(args),
      valid: true,
      signature: 'remote_shell:pwd'
    }
  }

  it('a session that dies mid-run gets one logged reconnect, and the failure says so', async () => {
    const a = await trusted('alpha')
    const b = await trusted('bravo')
    // The tools are planned while the session is up — that is how the screenshots got the tools.
    const runtime = planRemoteRuntime('deploy over ssh on my vps', a, manager)
    expect(runtime.extraTools?.some((tool) => tool.name === 'remote_shell')).toBe(true)

    // ...and then the session is gone before the first tool runs.
    await manager.disconnect(a)
    backend.failWith = new Error('ECONNRESET')
    const attempts = backend.connectCalls

    const result = await runtime.extraExecutor!.execute(shellAction(a))

    expect(result.ok).toBe(false)
    expect(backend.connectCalls - attempts).toBe(1)
    const text = `${result.output}${result.error ?? ''}`
    expect(text).toContain('one reconnect attempt failed')
    expect(text).toContain('ECONNRESET')
    expect(manager.stateFor(a).status).toBe('disconnected')
    expect(manager.stateFor(b).status).toBe('connected')
  })

  it('a successful reconnect means the next tool call runs', async () => {
    const a = await trusted('alpha')
    const runtime = planRemoteRuntime('deploy over ssh on my vps', a, manager)
    await manager.disconnect(a)
    const second = await trusted('bravo')

    const first = await runtime.extraExecutor!.execute(shellAction(a))
    expect(first.ok).toBe(false)
    expect(`${first.output}${first.error ?? ''}`).toContain('one reconnect attempt succeeded')
    expect(manager.stateFor(a).status).toBe('connected')

    const next = await runtime.extraExecutor!.execute(shellAction(a))
    expect(next.ok).toBe(true)
    expect(next.output).toContain('ran:pwd')
    expect(manager.stateFor(second).status).toBe('connected')
  })
})
