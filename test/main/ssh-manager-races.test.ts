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
import type {
  SftpEntry,
  SshBackend,
  SshConnectConfig,
  SshConnection,
  SshExecResult,
  SshShell
} from '../../src/main/ssh/backend'

const KEY = Buffer.from('fake-host-public-key')
const KEY_FINGERPRINT = fingerprintFromKey(KEY)

const cipher: SecretCipher = {
  encrypt: async (plaintext) => `enc:${Buffer.from(plaintext).toString('base64')}`,
  decrypt: async (ciphertext) => Buffer.from(ciphertext.replace(/^enc:/, ''), 'base64').toString()
}

class CountingConnection implements SshConnection {
  readonly shells: Array<{ closed: boolean }> = []
  ended = false
  constructor(private readonly onShell?: () => void) {}
  async exec(): Promise<SshExecResult> {
    return { stdout: 'ok', stderr: '', exitCode: 0 }
  }
  async shell(): Promise<SshShell> {
    const record = { closed: false }
    this.shells.push(record)
    this.onShell?.()
    return {
      write: () => undefined,
      resize: () => undefined,
      close: () => {
        record.closed = true
      },
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

class CountingBackend implements SshBackend {
  connectCalls = 0
  lastConnection?: CountingConnection
  /** Resolve the connect promise manually so two callers can race. */
  gate?: Promise<void>

  async connect(config: SshConnectConfig): Promise<SshConnection> {
    this.connectCalls += 1
    const accepted = config.hostVerifier(KEY)
    if (!accepted) throw new Error('Host key verification failed')
    if (this.gate) await this.gate
    this.lastConnection = new CountingConnection()
    return this.lastConnection
  }
}

let dir: string
let store: VpsServerStore
let audit: AuditLog
let backend: CountingBackend
let now: number
let manager: SshManager

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ssh-races-'))
  store = new VpsServerStore({ file: join(dir, 'vps.json'), cipher })
  audit = new AuditLog({ file: join(dir, 'audit.json') })
  backend = new CountingBackend()
  now = 0
  manager = new SshManager({
    store,
    backend,
    audit,
    rateLimiter: new RateLimiter(1000, 60_000, () => now),
    now: () => now,
    readKeyFile: async () =>
      Buffer.from('-----BEGIN OPENSSH PRIVATE KEY-----\nfake-key-body\n-----END OPENSSH PRIVATE KEY-----')
  })
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function trustedServer(): Promise<string> {
  const server = await store.save({
    name: 'host',
    host: 'example.com',
    username: 'deploy',
    authType: 'password',
    password: 'secret'
  })
  // First attempt is refused: the host key is unseen. Approve, then connect.
  const first = await manager.connect(server.id)
  expect(first.pendingFingerprint).toBe(KEY_FINGERPRINT)
  await manager.approveFingerprint(server.id)
  const second = await manager.connect(server.id)
  expect(second.status).toBe('connected')
  return server.id
}

describe('N-4: concurrent connects are coalesced', () => {
  it('opens exactly one SSH client for two simultaneous calls', async () => {
    // Pre-trusted but not yet connected, so both callers really do try to connect.
    const server = await store.save({
      name: 'race',
      host: 'example.com',
      username: 'deploy',
      authType: 'password',
      password: 'secret',
      trustFingerprint: KEY_FINGERPRINT
    })
    const before = backend.connectCalls

    let release: () => void = () => undefined
    backend.gate = new Promise((resolve) => {
      release = resolve
    })

    const first = manager.connect(server.id)
    const second = manager.connect(server.id)
    release()
    const [a, b] = await Promise.all([first, second])

    // Two callers, one handshake: the second used to open a second client and
    // orphan the first without ever ending it.
    expect(backend.connectCalls - before).toBe(1)
    expect(a.status).toBe('connected')
    expect(b.status).toBe('connected')
  })

  it('returns the existing state instead of reconnecting', async () => {
    const id = await trustedServer()
    const before = backend.connectCalls
    const state = await manager.connect(id)
    expect(state.status).toBe('connected')
    expect(backend.connectCalls).toBe(before)
  })

  it('reports a per-server state rather than whichever changed last', async () => {
    const id = await trustedServer()
    expect(manager.stateFor(id).status).toBe('connected')
    expect(manager.stateFor('never-seen').status).toBe('disconnected')
    expect(manager.states()[id]?.status).toBe('connected')
  })
})

describe('N-5: re-opening a terminal closes the previous shell', () => {
  it('does not leak the previous shell channel', async () => {
    const id = await trustedServer()
    const connection = backend.lastConnection!
    await manager.openTerminal(id)
    await manager.openTerminal(id)
    expect(connection.shells).toHaveLength(2)
    expect(connection.shells[0]!.closed).toBe(true)
    expect(connection.shells[1]!.closed).toBe(false)
  })
})

describe('N-7: markActive keeps an in-use host off the idle watchdog', () => {
  it('refreshes the idle stamp so a long-idle open project survives', async () => {
    const id = await trustedServer()
    now += 60 * 60 * 1000
    manager.markActive(id)
    // The connection is still usable: exec does not need a reconnect.
    const result = await manager.exec(id, 'pwd')
    expect(result.ok).toBe(true)
  })
})
