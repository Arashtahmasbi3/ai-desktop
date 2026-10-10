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

class FakeConnection implements SshConnection {
  lastTimeoutMs?: number
  constructor(private readonly respond?: (command: string, timeoutMs?: number) => SshExecResult) {}
  async exec(command: string, timeoutMs?: number): Promise<SshExecResult> {
    this.lastTimeoutMs = timeoutMs
    if (this.respond) return this.respond(command, timeoutMs)
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
    return [{ name: 'app.log', type: 'file', size: 12, modifiedAt: 1 }]
  }
  async sftpRead(): Promise<string> {
    return 'remote-content'
  }
  async sftpWrite(): Promise<void> {
    return undefined
  }
  end(): void {
    return undefined
  }
}

class FakeBackend implements SshBackend {
  lastConfig?: SshConnectConfig
  lastConnection?: FakeConnection
  respond?: (command: string, timeoutMs?: number) => SshExecResult
  failWith?: Error

  async connect(config: SshConnectConfig): Promise<SshConnection> {
    this.lastConfig = config
    const accepted = config.hostVerifier(KEY)
    if (!accepted) throw new Error('Host key verification failed')
    if (this.failWith) throw this.failWith
    this.lastConnection = new FakeConnection(this.respond)
    return this.lastConnection
  }
}

let dir: string
let store: VpsServerStore
let audit: AuditLog
let backend: FakeBackend
let now: number
let manager: SshManager

async function makeManager(rateLimit = 100): Promise<void> {
  store = new VpsServerStore({ file: join(dir, 'vps.json'), cipher })
  audit = new AuditLog({ file: join(dir, 'audit.json') })
  backend = new FakeBackend()
  now = 0
  manager = new SshManager({
    store,
    backend,
    audit,
    rateLimiter: new RateLimiter(rateLimit, 60_000, () => now),
    now: () => now,
    readKeyFile: async () => Buffer.from('PRIVATE KEY')
  })
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ssh-manager-'))
  await makeManager()
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('ssh manager', () => {
  it('blocks a server with no stored credential', async () => {
    const server = await store.save({
      name: 'no-secret',
      host: 'example.com',
      username: 'root',
      authType: 'password'
    })
    const state = await manager.connect(server.id)
    expect(state.status).toBe('error')
    expect(state.error).toMatch(/No password stored/)
    expect(backend.lastConfig).toBeUndefined()
  })

  it('requires explicit approval for an unseen host key, then connects', async () => {
    const server = await store.save({
      name: 'new-host',
      host: 'example.com',
      username: 'root',
      authType: 'key',
      privateKeyPath: '/home/me/.ssh/id_ed25519'
    })
    const first = await manager.connect(server.id)
    expect(first.status).toBe('error')
    expect(first.pendingFingerprint).toBe(KEY_FINGERPRINT)

    await manager.approveFingerprint(server.id)
    const second = await manager.connect(server.id)
    expect(second.status).toBe('connected')
    expect(second.fingerprint).toBe(KEY_FINGERPRINT)
    expect(manager.isConnected(server.id)).toBe(true)
  })

  it('rejects a changed host key', async () => {
    const server = await store.save({
      name: 'pinned',
      host: 'example.com',
      username: 'root',
      authType: 'key',
      privateKeyPath: '/k',
      trustFingerprint: 'SHA256:some-other-fingerprint'
    })
    const state = await manager.connect(server.id)
    expect(state.status).toBe('error')
    expect(state.error).toMatch(/Host key changed/)
    expect(state.pendingFingerprint).toBeUndefined()
  })

  it('never sends a denied command to the connection', async () => {
    const server = await store.save({
      name: 'srv',
      host: 'h',
      username: 'u',
      authType: 'password',
      password: 'secret',
      trustFingerprint: KEY_FINGERPRINT
    })
    expect((await manager.connect(server.id)).status).toBe('connected')
    const result = await manager.exec(server.id, 'rm -rf /')
    expect(result.blocked).toBe(true)
    expect(result.ok).toBe(false)
    expect(audit.entries().some((entry) => entry.type === 'blocked')).toBe(true)
  })

  it('enforces the rate limit and audits it', async () => {
    await makeManager(2)
    const server = await store.save({
      name: 'srv',
      host: 'h',
      username: 'u',
      authType: 'password',
      password: 'secret',
      trustFingerprint: KEY_FINGERPRINT
    })
    await manager.connect(server.id)
    expect((await manager.exec(server.id, 'ls')).ok).toBe(true)
    expect((await manager.exec(server.id, 'pwd')).ok).toBe(true)
    const third = await manager.exec(server.id, 'whoami')
    expect(third.rateLimited).toBe(true)
    expect(audit.entries().some((entry) => entry.type === 'rate_limited')).toBe(true)
  })

  it('disconnects after the idle timeout', async () => {
    const server = await store.save({
      name: 'srv',
      host: 'h',
      username: 'u',
      authType: 'password',
      password: 'secret',
      trustFingerprint: KEY_FINGERPRINT
    })
    await manager.connect(server.id)
    now = 31 * 60 * 1000
    const idle = await manager.checkIdle()
    expect(idle).toEqual([server.id])
    expect(manager.isConnected(server.id)).toBe(false)
    expect(audit.entries().some((entry) => entry.detail === 'idle-timeout')).toBe(true)
  })

  it('runs remote file operations over sftp', async () => {
    const server = await store.save({
      name: 'srv',
      host: 'h',
      username: 'u',
      authType: 'password',
      password: 'secret',
      trustFingerprint: KEY_FINGERPRINT
    })
    await manager.connect(server.id)
    const files = await manager.listFiles(server.id, '/var/log')
    expect(files[0].path).toBe('/var/log/app.log')
    expect(await manager.readFile(server.id, '/var/log/app.log')).toBe('remote-content')
    await manager.writeFile(server.id, '/tmp/x', 'data')
    expect(audit.entries().some((entry) => entry.command === 'sftp:write /tmp/x')).toBe(true)
    await manager.disconnect(server.id)
    expect(manager.isConnected(server.id)).toBe(false)
  })

  it('encrypts secrets at rest', async () => {
    await store.save({
      name: 'srv',
      host: 'h',
      username: 'u',
      authType: 'password',
      password: 'top-secret'
    })
    const raw = await import('node:fs').then((fs) => fs.promises.readFile(join(dir, 'vps.json'), 'utf8'))
    expect(raw).not.toContain('top-secret')
    expect(raw).toContain('enc:')
  })

  it('enforces a read-only host policy on exec (B.3)', async () => {
    const server = await store.save({
      name: 'prod',
      host: 'example.com',
      username: 'root',
      authType: 'key',
      privateKeyPath: '/k',
      trustFingerprint: KEY_FINGERPRINT,
      policy: { vpsId: '', mode: 'read-only', allowCommands: [], denyCommands: [], requireApproval: 'never', allowedPaths: [] }
    })
    await manager.connect(server.id)
    const read = await manager.exec(server.id, 'ls /srv')
    expect(read.ok).toBe(true)
    const write = await manager.exec(server.id, 'mkdir /srv/x')
    expect(write.blocked).toBe(true)
    expect(write.reason).toMatch(/read-only/)
    expect(audit.entries().some((entry) => entry.type === 'blocked' && /policy/.test(entry.detail ?? ''))).toBe(true)
  })

  it('passes the per-command timeout and surfaces a timed-out exec (A.4)', async () => {
    backend.respond = () => ({ stdout: '', stderr: 'killed', exitCode: 124, timedOut: true })
    const server = await store.save({
      name: 'slow',
      host: 'h',
      username: 'u',
      authType: 'password',
      password: 'secret',
      trustFingerprint: KEY_FINGERPRINT
    })
    await manager.connect(server.id)
    const result = await manager.exec(server.id, 'npm install')
    expect(result.timedOut).toBe(true)
    expect(result.ok).toBe(false)
    expect(result.exitCode).toBe(124)
    expect(backend.lastConnection?.lastTimeoutMs).toBe(300_000)
    expect(audit.entries().some((entry) => /timed out/i.test(entry.detail ?? ''))).toBe(true)
  })

  it('persists a host policy across store reloads (B.3)', async () => {
    const created = await store.save({
      name: 'stg',
      host: 'h',
      username: 'u',
      authType: 'key',
      privateKeyPath: '/k',
      policy: { vpsId: '', mode: 'staging', allowCommands: ['deploy'], denyCommands: [], requireApproval: 'destructive', allowedPaths: [] }
    })
    const reloaded = new VpsServerStore({ file: join(dir, 'vps.json'), cipher })
    expect(await reloaded.policyFor(created.id)).toMatchObject({ mode: 'staging', requireApproval: 'destructive' })
  })
})