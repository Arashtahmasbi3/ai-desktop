import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuditLog } from '../../../src/core/agent/audit-log'
import { RateLimiter } from '../../../src/core/agent/rate-limiter'
import type { SecretCipher } from '../../../src/core/agent/persistence'
import { SshManager } from '../../../src/main/ssh/ssh-manager'
import { VpsServerStore } from '../../../src/main/ssh/server-store'
import { fingerprintFromKey } from '../../../src/main/ssh/host-key-verify'
import type {
  SftpEntry,
  SshBackend,
  SshConnection,
  SshExecResult,
  SshShell
} from '../../../src/main/ssh/backend'

/**
 * v4.3.17 — SSH-6.
 *
 * The app's own remote editor wrote straight over SFTP with no copy kept, while the agent's `remote_write_file` took a
 * `<path>.backup-<ts>` copy first and refused to write when the copy failed. One bad save from the editor therefore
 * lost the server-side file, and the Restore button had nothing to offer for it.
 */
const KEY = Buffer.from('fake-host-public-key')
const KEY_FINGERPRINT = fingerprintFromKey(KEY)

const cipher: SecretCipher = {
  encrypt: async (plaintext) => `enc:${Buffer.from(plaintext).toString('base64')}`,
  decrypt: async (ciphertext) => Buffer.from(ciphertext.replace(/^enc:/, ''), 'base64').toString()
}

class RecordingConnection implements SshConnection {
  commands: string[] = []
  writes: Array<{ path: string; content: string }> = []
  /** What the backup probe answers: found, missing, or a failing copy. */
  mode: 'found' | 'missing' | 'copy-fails' = 'found'

  async exec(command: string): Promise<SshExecResult> {
    this.commands.push(command)
    if (this.mode === 'missing') return { stdout: '', stderr: '', exitCode: 0 }
    if (this.mode === 'copy-fails') return { stdout: '', stderr: 'cp: permission denied', exitCode: 1 }
    return { stdout: 'ai-desktop-backup-ok\n', stderr: '', exitCode: 0 }
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
  async sftpWrite(path: string, content: string): Promise<void> {
    this.writes.push({ path, content })
  }
  end(): void {
    return undefined
  }
}

class RecordingBackend implements SshBackend {
  connection = new RecordingConnection()
  async connect(config: { hostVerifier: (key: Buffer) => boolean }): Promise<SshConnection> {
    if (!config.hostVerifier(KEY)) throw new Error('Host key verification failed')
    return this.connection
  }
}

let dir: string
let store: VpsServerStore
let backend: RecordingBackend
let manager: SshManager
let audit: AuditLog

async function connected(): Promise<string> {
  const server = await store.save({
    name: 'box',
    host: 'box.example.com',
    username: 'root',
    authType: 'password',
    password: 'secret',
    trustFingerprint: KEY_FINGERPRINT
  })
  await manager.connect(server.id)
  return server.id
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ai-desktop-save-backup-'))
  store = new VpsServerStore({ file: join(dir, 'vps.json'), cipher })
  backend = new RecordingBackend()
  audit = new AuditLog({ file: join(dir, 'ssh-audit.json') })
  manager = new SshManager({
    store,
    backend,
    audit,
    rateLimiter: new RateLimiter(100, 60_000),
    now: () => 7_000,
    readKeyFile: async () =>
      Buffer.from('-----BEGIN OPENSSH PRIVATE KEY-----\nfake-key-body\n-----END OPENSSH PRIVATE KEY-----')
  })
})

afterEach(async () => {
  for (const id of manager.connectedServers()) await manager.disconnect(id, 'user').catch(() => undefined)
  await rm(dir, { recursive: true, force: true }).catch(() => undefined)
})

describe('saving from the remote editor keeps a backup (v4.3.17)', () => {
  it('copies the file before the write and records it', async () => {
    const id = await connected()

    await manager.writeFile(id, '/srv/app/config.yml', 'new: true')

    expect(backend.connection.commands[0]).toContain('cp -p --')
    expect(backend.connection.commands[0]).toContain('/srv/app/config.yml.backup-7000')
    expect(backend.connection.writes).toEqual([{ path: '/srv/app/config.yml', content: 'new: true' }])

    const backup = audit.entries().find((entry) => entry.type === 'backup_created')
    expect(backup?.detail).toContain('/srv/app/config.yml.backup-7000')
  })

  it('writes without a copy when the file does not exist yet', async () => {
    const id = await connected()
    backend.connection.mode = 'missing'

    await manager.writeFile(id, '/srv/app/new.yml', 'hello')

    expect(backend.connection.writes).toHaveLength(1)
  })

  it('refuses to write when the backup itself fails', async () => {
    const id = await connected()
    backend.connection.mode = 'copy-fails'

    await expect(manager.writeFile(id, '/srv/app/config.yml', 'x')).rejects.toThrow(/back up/)
    expect(backend.connection.writes).toEqual([])
  })
})
