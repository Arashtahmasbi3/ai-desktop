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
  SshConnection,
  SshExecResult,
  SshShell
} from '../../src/main/ssh/backend'

/**
 * R8 - a successful connect clears the previous attempt's error.
 *
 * The screenshot: at 15:05 the same screen read `connected` *and* `Timed out while waiting for
 * handshake`. That sentence belongs to an attempt that failed; the connection beside it belongs to
 * a later one that worked. Two rules keep the two facts apart:
 *
 *  - the manager never publishes `connected` together with an `error` (a success is a new fact, not
 *    a patch of the old one), and
 *  - a connected state can never carry an error, so no chip that renders one can show both.
 *
 * The second case below is the reachable way the first rule was broken: a transport that came up and
 * a post-connect bookkeeping step that threw left `error` on the cached state while the handle was
 * live, and the next `connect()` reused that cached state.
 */
const KEY = Buffer.from('fake-host-public-key')
const KEY_FINGERPRINT = fingerprintFromKey(KEY)
const TIMEOUT = 'Timed out while waiting for handshake'

const cipher: SecretCipher = {
  encrypt: async (plaintext) => `enc:${Buffer.from(plaintext).toString('base64')}`,
  decrypt: async (ciphertext) => Buffer.from(ciphertext.replace(/^enc:/, ''), 'base64').toString()
}

class FakeConnection implements SshConnection {
  async exec(): Promise<SshExecResult> {
    return { stdout: 'ok', stderr: '', exitCode: 0 }
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
    return undefined
  }
}

class FakeBackend implements SshBackend {
  connectCalls = 0
  failWith?: Error

  async connect(config: { hostVerifier: (key: Buffer) => boolean }): Promise<SshConnection> {
    this.connectCalls += 1
    if (!config.hostVerifier(KEY)) throw new Error('Host key verification failed')
    if (this.failWith) throw this.failWith
    return new FakeConnection()
  }
}

/** The one bookkeeping step after a live handle that can fail, injected as a real store. */
class FlakyStore extends VpsServerStore {
  private failuresLeft = 0

  failNextBookkeeping(): void {
    this.failuresLeft += 1
  }

  override async touchConnected(id: string): Promise<void> {
    if (this.failuresLeft > 0) {
      this.failuresLeft -= 1
      throw new Error(TIMEOUT)
    }
    return super.touchConnected(id)
  }
}

let dir: string
let cipherStore: VpsServerStore
let audit: AuditLog
let backend: FakeBackend
let now: number

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ssh-error-reset-'))
  cipherStore = new VpsServerStore({ file: join(dir, 'vps.json'), cipher })
  audit = new AuditLog({ file: join(dir, 'audit.json') })
  backend = new FakeBackend()
  now = 0
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function makeManager(store: VpsServerStore): SshManager {
  return new SshManager({
    store,
    backend,
    audit,
    rateLimiter: new RateLimiter(1000, 60_000, () => now),
    now: () => now,
    readKeyFile: async () =>
      Buffer.from('-----BEGIN OPENSSH PRIVATE KEY-----\nfake-key-body\n-----END OPENSSH PRIVATE KEY-----')
  })
}

async function saved(store: VpsServerStore, name: string): Promise<string> {
  const server = await store.save({
    name,
    host: `${name}.example.com`,
    username: 'root',
    authType: 'password',
    password: 'secret',
    trustFingerprint: KEY_FINGERPRINT
  })
  return server.id
}

describe('R8 - a success does not carry the previous attempt\'s error', () => {
  it('a timed-out attempt followed by a successful one leaves no error on the state', async () => {
    const manager = makeManager(cipherStore)
    const id = await saved(cipherStore, 'alpha')

    backend.failWith = new Error(TIMEOUT)
    const failed = await manager.connect(id)
    expect(failed.status).toBe('error')
    expect(failed.error).toContain(TIMEOUT)
    expect(manager.stateFor(id).error).toContain(TIMEOUT)

    backend.failWith = undefined
    const ok = await manager.connect(id)
    expect(ok.status).toBe('connected')
    expect(ok.error).toBeUndefined()
    expect(manager.stateFor(id).error).toBeUndefined()
    expect(manager.getState().error).toBeUndefined()
    expect('error' in manager.stateFor(id)).toBe(false)
  })

  it('a success after a failed post-connect step does not inherit the error from the cached state', async () => {
    // The reachable shape of the bug: the socket came up, the bookkeeping after it threw, so the
    // cached state says `error` while the manager is holding a live handle. The next connect used
    // to reuse that cached state as `{ ...known, status: 'connected' }` — connected *and* errored.
    const flaky = new FlakyStore({ file: join(dir, 'vps-flaky.json'), cipher })
    const manager = makeManager(flaky)
    const id = await saved(flaky, 'alpha')

    flaky.failNextBookkeeping()
    const failed = await manager.connect(id)
    expect(failed.status).toBe('error')
    expect(failed.error).toContain(TIMEOUT)
    expect(manager.isConnected(id)).toBe(true)

    const ok = await manager.connect(id)
    expect(ok.status).toBe('connected')
    expect(ok.error).toBeUndefined()
    expect(manager.stateFor(id).error).toBeUndefined()
    expect('error' in manager.stateFor(id)).toBe(false)
  })
})
