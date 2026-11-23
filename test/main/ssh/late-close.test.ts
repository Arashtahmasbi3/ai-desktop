import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
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
 * v4.3.16 — SSH-3.
 *
 * The transport-close handler captured only `serverId`, so it acted on whatever entry the map held when the event
 * arrived. A replaced client emits 'close' on its own schedule: the late event closed the **new** terminal, deleted
 * the new entry and told the user the session had ended, while the new socket stayed open and untracked.
 */
const KEY = Buffer.from('fake-host-public-key')
const KEY_FINGERPRINT = fingerprintFromKey(KEY)

const cipher: SecretCipher = {
  encrypt: async (plaintext) => `enc:${Buffer.from(plaintext).toString('base64')}`,
  decrypt: async (ciphertext) => Buffer.from(ciphertext.replace(/^enc:/, ''), 'base64').toString()
}

class ClosingConnection implements SshConnection {
  ended = false
  terminalClosed = false
  private closeListeners: Array<() => void> = []

  onClose(listener: () => void): void {
    this.closeListeners.push(listener)
  }

  triggerClose(): void {
    for (const listener of [...this.closeListeners]) listener()
  }

  async exec(): Promise<SshExecResult> {
    return { stdout: '', stderr: '', exitCode: 0 }
  }
  async shell(): Promise<SshShell> {
    return {
      write: () => undefined,
      resize: () => undefined,
      close: () => {
        this.terminalClosed = true
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

class ClosingBackend implements SshBackend {
  connections: ClosingConnection[] = []

  async connect(config: { hostVerifier: (key: Buffer) => boolean }): Promise<SshConnection> {
    if (!config.hostVerifier(KEY)) throw new Error('Host key verification failed')
    const connection = new ClosingConnection()
    this.connections.push(connection)
    return connection
  }
}

let dir: string
let store: VpsServerStore
let backend: ClosingBackend
let manager: SshManager

const auditFile = (): string => join(dir, 'audit.json')

async function auditText(): Promise<string> {
  try {
    return await readFile(auditFile(), 'utf8')
  } catch {
    return ''
  }
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function connected(): Promise<string> {
  const server = await store.save({
    name: 'box',
    host: 'box.example.com',
    username: 'root',
    authType: 'password',
    password: 'secret',
    trustFingerprint: KEY_FINGERPRINT
  })
  expect((await manager.connect(server.id)).status).toBe('connected')
  return server.id
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ai-desktop-late-close-'))
  store = new VpsServerStore({ file: join(dir, 'vps.json'), cipher })
  backend = new ClosingBackend()
  manager = new SshManager({
    store,
    backend,
    audit: new AuditLog({ file: join(dir, 'audit.json') }),
    rateLimiter: new RateLimiter(100, 60_000),
    readKeyFile: async () =>
      Buffer.from('-----BEGIN OPENSSH PRIVATE KEY-----\nfake-key-body\n-----END OPENSSH PRIVATE KEY-----')
  })
})

afterEach(async () => {
  // End whatever the test left open so the audit file is not held while the temp directory is removed.
  for (const id of manager.connectedServers()) await manager.disconnect(id, 'user').catch(() => undefined)
  await rm(dir, { recursive: true, force: true }).catch(() => undefined)
})

describe('a late close from a replaced transport (v4.3.16)', () => {
  it('leaves the session that replaced it alone', async () => {
    const id = await connected()
    const stale = backend.connections[0]!
    await manager.disconnect(id, 'user')
    await manager.connect(id)
    const live = backend.connections[1]!
    expect(manager.connectedServers()).toContain(id)
    const before = (await auditText()).split('transport closed').length - 1

    // The replaced socket's 'close' arrives after the new session is established.
    stale.triggerClose()
    await settle()

    const after = (await auditText()).split('transport closed').length - 1
    expect(after).toBe(before)
    expect(manager.connectedServers()).toContain(id)
    expect(manager.stateFor(id).status).toBe('connected')
    expect(live.terminalClosed).toBe(false)
    expect(live.ended).toBe(false)
  })
})
