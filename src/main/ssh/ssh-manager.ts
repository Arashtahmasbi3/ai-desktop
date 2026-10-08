import { promises as fs } from 'node:fs'
import { AuditLog, type AuditEntry } from '@core/agent/audit-log'
import { checkDenyList } from '@core/agent/deny-list'
import { RateLimiter } from '@core/agent/rate-limiter'
import type { RemoteFileEntry, VpsConnectionState, VpsExecResult } from '@shared/vps'
import { evaluateHostKey, fingerprintFromKey } from './host-key-verify'
import type { SftpEntry, SshBackend, SshConnection } from './backend'
import { TerminalSession } from './terminal-session'
import type { VpsServerStore } from './server-store'

export const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000
export const DEFAULT_COMMANDS_PER_MINUTE = 100

interface ConnectionEntry {
  connection: SshConnection
  terminal?: TerminalSession
  lastActivity: number
}

export interface SshManagerOptions {
  store: VpsServerStore
  backend: SshBackend
  audit: AuditLog
  rateLimiter?: RateLimiter
  idleTimeoutMs?: number
  now?: () => number
  onStatus?: (state: VpsConnectionState) => void
  onData?: (sessionId: string, chunk: string) => void
  readKeyFile?: (path: string) => Promise<Buffer>
}

/**
 * Owns every SSH connection and enforces the Sprint 4 security rules:
 * mandatory host-key verification, a private key (or password) that must exist,
 * a command deny list, a 100/min rate limit, a JSON audit log and 30-minute
 * idle disconnect. All of it is deterministic and unit-testable via the
 * injectable {@link SshBackend}, clock and rate limiter.
 */
export class SshManager {
  private readonly store: VpsServerStore
  private readonly backend: SshBackend
  private readonly audit: AuditLog
  private readonly rateLimiter: RateLimiter
  private readonly idleTimeoutMs: number
  private readonly now: () => number
  private readonly onStatus?: (state: VpsConnectionState) => void
  private readonly onData?: (sessionId: string, chunk: string) => void
  private readonly readKeyFile: (path: string) => Promise<Buffer>
  private connections = new Map<string, ConnectionEntry>()
  private pendingFingerprints = new Map<string, string>()
  private state: VpsConnectionState = { status: 'disconnected' }
  private watchdog?: ReturnType<typeof setInterval>

  constructor(options: SshManagerOptions) {
    this.store = options.store
    this.backend = options.backend
    this.audit = options.audit
    this.rateLimiter =
      options.rateLimiter ?? new RateLimiter(DEFAULT_COMMANDS_PER_MINUTE, 60_000, options.now)
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
    this.now = options.now ?? (() => Date.now())
    if (options.onStatus) this.onStatus = options.onStatus
    if (options.onData) this.onData = options.onData
    this.readKeyFile = options.readKeyFile ?? ((path) => fs.readFile(path))
  }

  getState(): VpsConnectionState {
    return { ...this.state }
  }

  connectedServers(): string[] {
    return [...this.connections.keys()]
  }

  isConnected(serverId: string): boolean {
    return this.connections.has(serverId)
  }

  auditEntries(): AuditEntry[] {
    return this.audit.entries()
  }

  private setState(next: VpsConnectionState): VpsConnectionState {
    this.state = next
    this.onStatus?.(this.getState())
    return this.getState()
  }

  private touch(serverId: string): void {
    const entry = this.connections.get(serverId)
    if (entry) entry.lastActivity = this.now()
  }

  async connect(serverId: string): Promise<VpsConnectionState> {
    await this.store.load()
    const decrypted = await this.store.getDecrypted(serverId)
    if (!decrypted) return this.setState({ status: 'error', error: `Unknown server: ${serverId}` })
    const { server, password, passphrase } = decrypted

    let privateKey: Buffer | undefined
    if (server.authType === 'key') {
      if (!server.privateKeyPath) {
        return this.blocked(serverId, 'No private key configured — connection blocked.')
      }
      try {
        privateKey = await this.readKeyFile(server.privateKeyPath)
      } catch {
        return this.blocked(serverId, `Private key not found: ${server.privateKeyPath}`)
      }
    } else if (!password) {
      return this.blocked(serverId, 'No password stored — connection blocked.')
    }

    this.setState({ status: 'connecting', serverId })
    let presented = ''
    let hostKeyReason: string | undefined
    const hostVerifier = (key: Buffer): boolean => {
      presented = fingerprintFromKey(key)
      const decision = evaluateHostKey({ presented, known: server.trustedFingerprint })
      if (!decision.trusted) {
        hostKeyReason = decision.reason
        if (decision.firstUse) this.pendingFingerprints.set(serverId, presented)
      }
      return decision.trusted
    }

    try {
      const connection = await this.backend.connect({
        host: server.host,
        port: server.port,
        username: server.username,
        ...(privateKey ? { privateKey } : {}),
        ...(passphrase ? { passphrase } : {}),
        ...(password ? { password } : {}),
        hostVerifier
      })
      this.connections.set(serverId, { connection, lastActivity: this.now() })
      this.pendingFingerprints.delete(serverId)
      await this.store.touchConnected(serverId)
      await this.audit.record({
        type: 'connect',
        ok: true,
        serverId,
        detail: `${server.username}@${server.host}:${server.port}`
      })
      this.ensureWatchdog()
      return this.setState({ status: 'connected', serverId, fingerprint: presented })
    } catch (error) {
      const pending = this.pendingFingerprints.get(serverId)
      if (pending) {
        await this.audit.record({
          type: 'host_key',
          ok: false,
          serverId,
          detail: `unverified fingerprint ${pending}`
        })
        return this.setState({
          status: 'error',
          serverId,
          pendingFingerprint: pending,
          error: 'Host key not verified. Confirm the fingerprint to trust this server.'
        })
      }
      if (hostKeyReason) {
        await this.audit.record({ type: 'host_key', ok: false, serverId, detail: hostKeyReason })
        return this.setState({ status: 'error', serverId, error: hostKeyReason })
      }
      const message = error instanceof Error ? error.message : String(error)
      await this.audit.record({ type: 'connect', ok: false, serverId, detail: message })
      return this.setState({ status: 'error', serverId, error: message })
    }
  }

  private blocked(serverId: string, reason: string): VpsConnectionState {
    return this.setState({ status: 'error', serverId, error: reason })
  }

  /** Called after the user confirms the fingerprint shown during connect. */
  async approveFingerprint(serverId: string): Promise<VpsConnectionState> {
    const fingerprint = this.pendingFingerprints.get(serverId)
    if (!fingerprint) {
      return this.setState({ status: 'error', serverId, error: 'No fingerprint is awaiting approval.' })
    }
    await this.store.setTrustedFingerprint(serverId, fingerprint)
    this.pendingFingerprints.delete(serverId)
    await this.audit.record({ type: 'host_key', ok: true, serverId, detail: fingerprint })
    return this.setState({ status: 'disconnected', serverId })
  }

  async disconnect(serverId: string, reason = 'user'): Promise<VpsConnectionState> {
    const entry = this.connections.get(serverId)
    if (entry) {
      entry.terminal?.close()
      entry.connection.end()
      this.connections.delete(serverId)
      await this.audit.record({ type: 'disconnect', ok: true, serverId, detail: reason })
    }
    if (this.connections.size === 0 && this.watchdog) {
      clearInterval(this.watchdog)
      this.watchdog = undefined
    }
    return this.setState({ status: 'disconnected', serverId })
  }

  async disconnectAll(): Promise<void> {
    for (const serverId of [...this.connections.keys()]) await this.disconnect(serverId)
  }

  async exec(serverId: string, command: string): Promise<VpsExecResult> {
    const entry = this.connections.get(serverId)
    if (!entry) {
      return { ok: false, stdout: '', stderr: '', exitCode: -1, reason: 'Not connected' }
    }
    const denied = checkDenyList(command)
    if (denied.blocked) {
      await this.audit.record({
        type: 'blocked',
        ok: false,
        serverId,
        command: denied.command,
        detail: denied.reason
      })
      return {
        ok: false,
        stdout: '',
        stderr: '',
        exitCode: 126,
        blocked: true,
        reason: denied.reason
      }
    }
    const limit = this.rateLimiter.tryAcquire()
    if (!limit.allowed) {
      const reason = `Rate limit exceeded (${DEFAULT_COMMANDS_PER_MINUTE}/min).`
      await this.audit.record({ type: 'rate_limited', ok: false, serverId, command: denied.command, detail: reason })
      return { ok: false, stdout: '', stderr: '', exitCode: 429, rateLimited: true, reason }
    }
    this.touch(serverId)
    try {
      const result = await entry.connection.exec(command)
      await this.audit.record({
        type: 'exec',
        ok: result.exitCode === 0,
        serverId,
        command: denied.command,
        detail: `exit ${result.exitCode}`
      })
      return { ok: result.exitCode === 0, ...result }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.audit.record({ type: 'exec', ok: false, serverId, command: denied.command, detail: message })
      return { ok: false, stdout: '', stderr: message, exitCode: -1, reason: message }
    }
  }

  async openTerminal(serverId: string, cols = 80, rows = 24): Promise<string> {
    const entry = this.connections.get(serverId)
    if (!entry) throw new Error('Not connected')
    const shell = await entry.connection.shell(cols, rows)
    const session = new TerminalSession(shell, {
      now: this.now,
      onData: (sessionId, chunk) => {
        this.touch(serverId)
        this.onData?.(sessionId, chunk)
      },
      onClose: (sessionId) => {
        const current = this.connections.get(serverId)
        if (current?.terminal?.id === sessionId) current.terminal = undefined
      }
    })
    entry.terminal = session
    return session.id
  }

  writeTerminal(serverId: string, data: string): void {
    this.connections.get(serverId)?.terminal?.write(data)
    this.touch(serverId)
  }

  resizeTerminal(serverId: string, cols: number, rows: number): void {
    this.connections.get(serverId)?.terminal?.resize(cols, rows)
  }

  async listFiles(serverId: string, path: string): Promise<RemoteFileEntry[]> {
    const entry = this.connections.get(serverId)
    if (!entry) throw new Error('Not connected')
    this.touch(serverId)
    const entries = await entry.connection.sftpList(path)
    return entries.map((file: SftpEntry) => ({
      name: file.name,
      path: path === '/' ? `/${file.name}` : `${path.replace(/\/$/, '')}/${file.name}`,
      type: file.type,
      size: file.size,
      modifiedAt: file.modifiedAt
    }))
  }

  async readFile(serverId: string, path: string): Promise<string> {
    const entry = this.connections.get(serverId)
    if (!entry) throw new Error('Not connected')
    this.touch(serverId)
    return entry.connection.sftpRead(path)
  }

  async writeFile(serverId: string, path: string, content: string): Promise<void> {
    const entry = this.connections.get(serverId)
    if (!entry) throw new Error('Not connected')
    this.touch(serverId)
    await entry.connection.sftpWrite(path, content)
    await this.audit.record({ type: 'exec', ok: true, serverId, command: `sftp:write ${path}` })
  }

  /** Exposed for tests / a manual sweep; also driven by the watchdog timer. */
  async checkIdle(): Promise<string[]> {
    const cutoff = this.now() - this.idleTimeoutMs
    const idle: string[] = []
    for (const [serverId, entry] of this.connections) {
      if (entry.lastActivity <= cutoff) idle.push(serverId)
    }
    for (const serverId of idle) await this.disconnect(serverId, 'idle-timeout')
    return idle
  }

  private ensureWatchdog(): void {
    if (this.watchdog) return
    this.watchdog = setInterval(() => void this.checkIdle(), 60_000)
    this.watchdog.unref?.()
  }
}
