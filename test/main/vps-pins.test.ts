/**
 * R3 — the idle reaper must not close a session something depends on.
 *
 * The failure this comes from: a second configured server was really disconnected after 30 minutes
 * (`setInterval(checkIdle, 60_000)` against a 30-minute timeout) while the UI still showed it, and
 * `vps:keepAlive` only ever refreshed the active project's server. A session is now **pinned** while
 * anything depends on it — an active run, an open remote project, or the UI's own claim — and a pin
 * is an explicit `(server, reason)` entry that is logged when taken and released, not a boolean guess.
 *
 * These cases inject the clock and the pin sources and never wait: the sweep is driven one virtual
 * minute at a time, exactly as the real watchdog would.
 */
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
import { remoteProjectPins, type PinChange, type ServerPin } from '../../src/main/ssh/pins'
import { keepAlivePass, VPS_KEEPALIVE_INTERVAL_MS } from '../../src/renderer/src/lib/vps-keepalive'
import type {
  SftpEntry,
  SshBackend,
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
  async connect(): Promise<SshConnection> {
    return new FakeConnection()
  }
}

let dir: string
let store: VpsServerStore
let audit: AuditLog
let backend: FakeBackend
/** Virtual clock: every case moves it explicitly, nothing sleeps. */
let now: number
/** Every pin take/release/expiry the manager reported, in order. */
let changes: PinChange[]
let manager: SshManager

interface TestOptions {
  pinSources?: () => readonly ServerPin[]
  manualLeaseMs?: number
}

function makeManager(options: TestOptions = {}): SshManager {
  return new SshManager({
    store,
    backend,
    audit,
    rateLimiter: new RateLimiter(100, 60_000, () => now),
    now: () => now,
    onPinChange: (change) => changes.push(change),
    // A real private key is required by the reader guard; the fake backend never uses it.
    readKeyFile: async () =>
      Buffer.from('-----BEGIN OPENSSH PRIVATE KEY-----\nfake-key-body\n-----END OPENSSH PRIVATE KEY-----'),
    ...options
  })
}

/** Save a server whose host key is already trusted, then open its session. */
async function connect(name: string): Promise<string> {
  const server = await store.save({
    name,
    host: `${name}.example.com`,
    username: 'root',
    authType: 'key',
    privateKeyPath: '/home/me/.ssh/id_ed25519',
    trustFingerprint: KEY_FINGERPRINT
  })
  const state = await manager.connect(server.id)
  expect(state.status).toBe('connected')
  return server.id
}

/** Drive the idle sweep the way the watchdog does: one minute of virtual time per sweep. */
async function advance(minutes: number): Promise<void> {
  for (let minute = 0; minute < minutes; minute += 1) {
    now += 60_000
    await manager.checkIdle()
  }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'vps-pins-'))
  store = new VpsServerStore({ file: join(dir, 'vps.json'), cipher })
  audit = new AuditLog({ file: join(dir, 'audit.json') })
  backend = new FakeBackend()
  now = 0
  changes = []
  manager = makeManager()
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('R3 — two connections stay alive while their projects depend on them', () => {
  it('advances 35 virtual minutes and both servers are still connected', async () => {
    // Main supplies the project dependencies on every sweep. The list is filled after the sessions
    // exist, which is the real order: a project points at a server that is already saved.
    const projects: ServerPin[] = []
    manager = makeManager({ pinSources: () => projects })

    const alpha = await connect('alpha')
    const bravo = await connect('bravo')
    projects.push(
      ...remoteProjectPins([
        { type: 'remote', vpsId: alpha, name: 'alpha-project' },
        { type: 'remote', vpsId: bravo, name: 'bravo-project' }
      ])
    )

    await advance(35)

    expect(now).toBe(35 * 60_000)
    expect(manager.connectedServers().sort()).toEqual([alpha, bravo].sort())
    expect(manager.isConnected(alpha)).toBe(true)
    expect(manager.isConnected(bravo)).toBe(true)
    // The reason is stated, per server, not implied by a timestamp.
    expect(manager.pinsFor(alpha)).toContain('remote-project')
    expect(manager.pinsFor(bravo)).toContain('remote-project')
    // Both pins were logged when they appeared.
    expect(
      changes.filter((change) => change.action === 'pinned' && change.reason === 'remote-project')
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ serverId: alpha, detail: 'alpha-project' }),
        expect.objectContaining({ serverId: bravo, detail: 'bravo-project' })
      ])
    )
  })
})

describe('R3 — a pinned server outlives the timeout, an unpinned one does not', () => {
  it('keeps the server with an active run and reaps the one nothing depends on', async () => {
    const busy = await connect('busy')
    const forgotten = await connect('forgotten')

    manager.pin(busy, 'active-run', 'run-7')

    await advance(35)

    expect(manager.isConnected(busy)).toBe(true)
    expect(manager.isConnected(forgotten)).toBe(false)
    expect(audit.entries().some((entry) => entry.detail === 'idle-timeout')).toBe(true)
    expect(changes).toEqual(
      expect.arrayContaining([
        { action: 'pinned', serverId: busy, reason: 'active-run', detail: 'run-7', at: 0 }
      ])
    )
  })

  it('still closes a server that genuinely idles, and logs the lease it let lapse', async () => {
    const idle = await connect('idle')

    // The 31st minute crosses the 30-minute cutoff; nothing ever claimed this session.
    await advance(31)

    expect(manager.isConnected(idle)).toBe(false)
    expect(audit.entries().some((entry) => entry.type === 'disconnect' && entry.serverId === idle)).toBe(
      true
    )
    // The UI's claim is a lease, not a permanent boolean: it lapses on its own.
    expect(
      changes.some(
        (change) => change.action === 'expired' && change.serverId === idle && change.reason === 'manual-session'
      )
    ).toBe(true)
  })
})

describe('R3 — releasing a pin lets the session close', () => {
  it('reaps a project-pinned server on the sweep after the project stops pointing at it', async () => {
    let projects: ServerPin[] = []
    manager = makeManager({ pinSources: () => projects })

    const alpha = await connect('alpha')
    projects = remoteProjectPins([{ type: 'remote', vpsId: alpha, name: 'alpha-project' }])

    await advance(35)
    expect(manager.isConnected(alpha)).toBe(true)

    // The project is closed / pointed elsewhere: main no longer supplies the dependency.
    projects = []
    now += 60_000
    await manager.checkIdle()

    expect(manager.isConnected(alpha)).toBe(false)
    expect(
      changes.some(
        (change) => change.action === 'released' && change.serverId === alpha && change.reason === 'remote-project'
      )
    ).toBe(true)
  })
})

describe('R3 — the keep-alive covers every connected server', () => {
  it('pings both connected ids, including one that is not the active project', async () => {
    const pinged: string[] = []
    const connected: string[] = []
    const projects = [{ type: 'remote', vpsId: 'alpha' }]

    const result = await keepAlivePass({
      projects,
      selectedVpsId: 'alpha',
      // Main's authoritative list: the UI is showing BOTH sessions as connected.
      connected: ['alpha', 'bravo'],
      ping: (id) => {
        pinged.push(id)
      },
      connect: (id) => {
        throw new Error('unexpected connect for ' + id)
      }
    })

    // The calls, not the intent: `vps:keepAlive` is what refreshes the stamp and the pin in main.
    expect(pinged).toEqual(['alpha', 'bravo'])
    expect(result.pinged).toEqual(['alpha', 'bravo'])
    expect(result.failed).toEqual([])
    expect(connected).toEqual([])
    // Well under the 30-minute idle timeout, so one missed pass cannot cost a session.
    expect(VPS_KEEPALIVE_INTERVAL_MS).toBeLessThan(2 * 60_000)
  })

  it('brings up a project host that is down, and pings the one that is up', async () => {
    const pinged: string[] = []
    const connected: string[] = []

    const result = await keepAlivePass({
      projects: [
        { type: 'remote', vpsId: 'alpha' },
        { type: 'remote', vpsId: 'charlie' }
      ],
      selectedVpsId: undefined,
      connected: ['alpha'],
      ping: (id) => {
        pinged.push(id)
      },
      connect: (id) => {
        connected.push(id)
      }
    })

    expect(pinged).toEqual(['alpha'])
    expect(connected).toEqual(['charlie'])
    expect(result).toEqual({ pinged: ['alpha'], reconnected: ['charlie'], failed: [] })
  })
})
