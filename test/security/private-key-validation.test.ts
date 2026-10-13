import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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

/**
 * N-8 (v2.6.5): `privateKeyPath` is a renderer-supplied string that used to be fed
 * straight to `fs.readFile` and then to ssh2 as key material, so any readable file
 * could be pointed at. These cover the guard added at the connect chokepoint.
 */
const KEY = Buffer.from('fake-host-public-key')
const KEY_FINGERPRINT = fingerprintFromKey(KEY)
const VALID_KEY = '-----BEGIN OPENSSH PRIVATE KEY-----\nfake-key-body\n-----END OPENSSH PRIVATE KEY-----'

const cipher: SecretCipher = {
  encrypt: async (plaintext) => `enc:${Buffer.from(plaintext).toString('base64')}`,
  decrypt: async (ciphertext) => Buffer.from(ciphertext.replace(/^enc:/, ''), 'base64').toString()
}

class NoopConnection implements SshConnection {
  async exec(): Promise<SshExecResult> {
    return { stdout: '', stderr: '', exitCode: 0 }
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

class StubBackend implements SshBackend {
  connects = 0
  async connect(config: SshConnectConfig): Promise<SshConnection> {
    if (!config.hostVerifier(KEY)) throw new Error('Host key verification failed')
    this.connects += 1
    return new NoopConnection()
  }
}

let dir: string
let store: VpsServerStore
let manager: SshManager
let backend: StubBackend
let keyContent: Buffer
let keyError: Error | undefined

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ssh-keyguard-'))
  store = new VpsServerStore({ file: join(dir, 'vps.json'), cipher })
  backend = new StubBackend()
  keyContent = Buffer.from(VALID_KEY)
  keyError = undefined
  manager = new SshManager({
    store,
    backend,
    audit: new AuditLog({ file: join(dir, 'audit.json') }),
    rateLimiter: new RateLimiter(1000, 60_000),
    readKeyFile: async () => {
      if (keyError) throw keyError
      return keyContent
    }
  })
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function keyServer(privateKeyPath: string): Promise<string> {
  const server = await store.save({
    name: 'key-host',
    host: 'example.com',
    username: 'deploy',
    authType: 'key',
    privateKeyPath,
    trustFingerprint: KEY_FINGERPRINT
  })
  return server.id
}

describe('N-8: the private key path cannot point at an arbitrary file', () => {
  it('connects when the file really is a private key', async () => {
    const id = await keyServer('/home/me/.ssh/id_ed25519')
    const state = await manager.connect(id)
    expect(state.status).toBe('connected')
    expect(backend.connects).toBe(1)
  })

  it('refuses a file that is not key-shaped', async () => {
    keyContent = Buffer.from('{"apiKey":"this is somebody elses secret store"}')
    const id = await keyServer('/home/me/.ssh/not-a-key')
    const state = await manager.connect(id)
    expect(state.status).toBe('error')
    expect(state.error).toMatch(/not an SSH private key/)
    expect(backend.connects).toBe(0)
  })

  it('refuses an empty key file', async () => {
    keyContent = Buffer.alloc(0)
    const id = await keyServer('/home/me/.ssh/empty')
    const state = await manager.connect(id)
    expect(state.status).toBe('error')
    expect(state.error).toMatch(/empty or too large/)
    expect(backend.connects).toBe(0)
  })

  it('refuses a file larger than any real key', async () => {
    keyContent = Buffer.concat([Buffer.from(VALID_KEY), Buffer.alloc(300 * 1024, 0x41)])
    const id = await keyServer('/home/me/.ssh/huge')
    const state = await manager.connect(id)
    expect(state.status).toBe('error')
    expect(state.error).toMatch(/empty or too large/)
  })

  it.each(['relative/id_ed25519', './id_ed25519', 'id_ed25519'])(
    'refuses the relative path %s',
    async (path) => {
      const id = await keyServer(path)
      const state = await manager.connect(id)
      expect(state.status).toBe('error')
      expect(state.error).toMatch(/must be absolute/)
      expect(backend.connects).toBe(0)
    }
  )

  it('accepts a Windows absolute path', async () => {
    const id = await keyServer('C:\\Users\\me\\.ssh\\id_ed25519')
    expect((await manager.connect(id)).status).toBe('connected')
  })

  it('still reports a genuinely missing key as not found', async () => {
    keyError = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    const id = await keyServer('/home/me/.ssh/gone')
    const state = await manager.connect(id)
    expect(state.error).toMatch(/Private key not found/)
  })
})
