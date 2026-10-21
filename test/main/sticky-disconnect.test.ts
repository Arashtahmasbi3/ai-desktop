import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { AuditLog } from '../../src/core/agent/audit-log'
import { RateLimiter } from '../../src/core/agent/rate-limiter'
import type { SecretCipher } from '../../src/core/agent/persistence'
import { SshManager } from '../../src/main/ssh/ssh-manager'
import { VpsServerStore } from '../../src/main/ssh/server-store'
import { remoteProjectPins, type ServerPin } from '../../src/main/ssh/pins'
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

/**
 * R7 - a manual Disconnect is sticky.
 *
 * The report: the user disconnected the server at 15:04 ("disconnected", a Connect button, a red
 * dot) and one minute later it read `connected` again without a click. `reconnectOnce` is the only
 * automatic connect path, and nothing checked who asked for the disconnect. The pins make it worse:
 * an open remote project keeps a *session* alive, but the renderer's keep-alive also used to ask for
 * that project's host to be opened again whenever it was down.
 *
 * These cases pin the fact itself ("the user asked for this to be down") on the automatic paths
 * only: the reaper and the liveness probe still disconnect freely, because they report what they
 * observed, not what the user wants.
 */
const KEY = Buffer.from('fake-host-public-key')
const KEY_FINGERPRINT = fingerprintFromKey(KEY)

const cipher: SecretCipher = {
  encrypt: async (plaintext) => `enc:${Buffer.from(plaintext).toString('base64')}`,
  decrypt: async (ciphertext) => Buffer.from(ciphertext.replace(/^enc:/, ''), 'base64').toString()
}

class FakeConnection implements SshConnection {
  ended = false
  /** The socket behind a live handle is gone: ssh2 answers `Not connected` for every call. */
  dead = false
  commands: string[] = []

  async exec(command: string): Promise<SshExecResult> {
    this.commands.push(command)
    if (this.dead) throw new Error('Not connected')
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
/** The dependency pins main supplies on each sweep; an open remote project sets one. */
let pins: ServerPin[]

async function makeManager(): Promise<void> {
  store = new VpsServerStore({ file: join(dir, 'vps.json'), cipher })
  audit = new AuditLog({ file: join(dir, 'audit.json') })
  backend = new FakeBackend()
  now = 0
  pins = []
  manager = new SshManager({
    store,
    backend,
    audit,
    rateLimiter: new RateLimiter(1000, 60_000, () => now),
    now: () => now,
    pinSources: () => pins,
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

/** A remote_shell call the orchestrator would make for this run. */
function shellAction(serverId: string, command = 'pwd'): AgentAction {
  const args = { server_id: serverId, command }
  return {
    id: 'call-1',
    name: 'remote_shell',
    arguments: args,
    rawArguments: JSON.stringify(args),
    valid: true,
    signature: `remote_shell:${command}`
  }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ssh-sticky-'))
  await makeManager()
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('R7 - a user disconnect is refused by the one automatic reconnect', () => {
  it('makes no connect attempt at all and tells the model the user disconnected it', async () => {
    const a = await trusted('alpha')
    // The tools are planned while the session is up, exactly as in the report.
    const runtime = planRemoteRuntime('deploy over ssh on my vps', a, manager)

    await manager.disconnect(a) // the user's own click: reason defaults to 'user'
    expect(manager.isUserDisconnected(a)).toBe(true)
    expect(manager.stateFor(a).userDisconnected).toBe(true)
    expect(manager.stateFor(a).status).toBe('disconnected')

    const attempts = backend.connectCalls
    const result = await runtime.extraExecutor!.execute(shellAction(a))

    // The regression: this used to open a session one step after the user closed one.
    expect(backend.connectCalls - attempts).toBe(0)
    expect(manager.connectedServers()).toEqual([])
    expect(manager.stateFor(a).status).toBe('disconnected')

    const text = `${result.output}${result.error ?? ''}`
    expect(text).toContain('disconnected by the user')
    expect(text).toContain('No reconnect was attempted')
    // It must not read like a failed attempt, or the model retries instead of asking.
    expect(text).not.toContain('one reconnect attempt')

    // The refusal is in the audit trail, so "why did the run stop?" has an answer.
    const refused = audit.entries().filter((entry) => /user disconnected this server/.test(entry.detail ?? ''))
    expect(refused).toHaveLength(1)
    expect(refused[0]?.serverId).toBe(a)
    expect(refused[0]?.ok).toBe(false)

    // And the raw outcome says who decided and why nothing was tried.
    const outcome = await manager.reconnectOnce(a, 'remote_shell: Not connected')
    expect(outcome.ok).toBe(false)
    expect(outcome.refused).toBe('user-disconnected')
    expect(backend.connectCalls - attempts).toBe(0)
  })

  it('is cleared by a manual connect, after which a drop reconnects exactly once', async () => {
    const a = await trusted('alpha')
    const opened = backend.connectCalls

    await manager.disconnect(a)
    expect(manager.isUserDisconnected(a)).toBe(true)
    // A manual Connect: only this path may clear the fact, and it does it by opening a session.
    expect((await manager.connect(a)).status).toBe('connected')
    expect(backend.connectCalls).toBe(opened + 1)
    expect(manager.isUserDisconnected(a)).toBe(false)
    expect(manager.stateFor(a).userDisconnected).toBeUndefined()

    // The session then dies on its own (a transport failure, not the user), so the R1 behaviour
    // must still be intact: one attempt, and it succeeds.
    const held = backend.lastConnection!
    held.dead = true
    const attempts = backend.connectCalls
    const outcome = await manager.reconnectOnce(a, 'remote_shell: Not connected')

    expect(outcome.ok).toBe(true)
    expect(backend.connectCalls - attempts).toBe(1)
    expect(manager.stateFor(a).status).toBe('connected')
    expect((await manager.exec(a, 'pwd')).ok).toBe(true)
  })
})

describe('R7 - an observed drop is not a user decision', () => {
  it('the idle reaper disconnects without making the server sticky', async () => {
    const a = await trusted('alpha')

    now += 31 * 60 * 1000
    expect(await manager.checkIdle()).toContain(a)

    expect(manager.stateFor(a).status).toBe('disconnected')
    expect(manager.isUserDisconnected(a)).toBe(false)
    expect(manager.stateFor(a).userDisconnected).toBeUndefined()

    const attempts = backend.connectCalls
    expect((await manager.reconnectOnce(a, 'remote_shell: Not connected')).ok).toBe(true)
    expect(backend.connectCalls - attempts).toBe(1)
  })

  it('the liveness probe disconnects without making the server sticky', async () => {
    const a = await trusted('alpha')
    const held = backend.lastConnection!
    held.dead = true

    expect(await manager.probeLiveness(a)).toBe(false)
    expect(manager.stateFor(a).status).toBe('disconnected')
    expect(manager.isUserDisconnected(a)).toBe(false)

    const attempts = backend.connectCalls
    expect((await manager.reconnectOnce(a, 'remote_shell: Client not connected')).ok).toBe(true)
    expect(backend.connectCalls - attempts).toBe(1)
  })
})

describe('R7 - the R3 pins keep a session, they do not open one', () => {
  it('an open remote project with a user-disconnected server stays down', async () => {
    const a = await trusted('alpha')
    const runtime = planRemoteRuntime('deploy over ssh on my vps', a, manager)
    // The project is open and points at this server: main derives the pin on every sweep.
    pins = remoteProjectPins([{ type: 'remote', vpsId: a, name: 'app' }])
    expect(manager.pinsFor(a)).toContain('remote-project')

    await manager.disconnect(a)
    const attempts = backend.connectCalls

    // An hour later the reaper runs: the pin is honoured (it is not even a candidate), and a pin
    // is a reason to keep an existing session, never a reason to open a new one.
    now += 60 * 60 * 1000
    expect(await manager.checkIdle()).not.toContain(a)
    expect(backend.connectCalls - attempts).toBe(0)
    expect(manager.stateFor(a).status).toBe('disconnected')
    expect(manager.isUserDisconnected(a)).toBe(true)

    // The renderer's dependency keep-alive asks main to bring a project's host up. That is an
    // automatic request, so it is refused while the user's decision stands.
    const auto = await manager.connectAutomatically(a)
    expect(auto.status).toBe('disconnected')
    expect(auto.userDisconnected).toBe(true)
    expect(backend.connectCalls - attempts).toBe(0)

    // Even a tool that names the pinned server must not reopen it.
    const result = await runtime.extraExecutor!.execute(shellAction(a))
    expect(backend.connectCalls - attempts).toBe(0)
    expect(`${result.output}${result.error ?? ''}`).toContain('disconnected by the user')
  })
})
