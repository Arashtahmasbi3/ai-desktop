import { promises as fs } from 'node:fs'
import { AuditLog, type AuditEntry } from '@core/agent/audit-log'
import { checkDenyList } from '@core/agent/deny-list'
import { RateLimiter } from '@core/agent/rate-limiter'
import { evaluateHostPolicy } from '@core/remote/host-policy'
import { parseBackupPath, restoreCommandFor } from '@core/remote/backup'
import { runHealthCheck } from '@core/remote/health-check'
import { shellQuote } from '@shared/shell-quote'
import { getCommandTimeout } from '@core/tools/remote-shell-tool'
import type { ServerSummary } from '@core/tools/server-tools'
import type {
  HealthCheckConfig,
  HealthCheckOutcome,
  ReachabilityReport,
  RemoteFileEntry,
  VpsConnectionState,
  VpsExecResult,
  VpsLivenessEvent,
  VpsReconnectOutcome
} from '@shared/vps'
import { observeServerReachability } from '../reachability'
import { evaluateHostKey, fingerprintFromKey } from './host-key-verify'
import type { SftpEntry, SshBackend, SshConnection } from './backend'
import {
  DEFAULT_MANUAL_LEASE_MS,
  PinRegistry,
  type PinChange,
  type ServerPin,
  type ServerPinReason
} from './pins'
import { TerminalSession } from './terminal-session'
import type { VpsServerStore } from './server-store'

export const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000
export const DEFAULT_COMMANDS_PER_MINUTE = 100

/**
 * How long the liveness probe may wait for a round trip before the handle is called dead.
 *
 * Short on purpose: a half-open socket does not answer at all, and the user is waiting inside a
 * tool call. A real server answers `true` in milliseconds, so this is two orders of magnitude of
 * headroom over the case that works.
 */
export const DEFAULT_LIVENESS_PROBE_TIMEOUT_MS = 2_000

interface ConnectionEntry {
  connection: SshConnection
  terminal?: TerminalSession
  lastActivity: number
}

/** True when two states describe the same connection situation (v2.6.5). */
function sameConnectionState(a: VpsConnectionState, b: VpsConnectionState): boolean {
  return (
    a.status === b.status &&
    a.serverId === b.serverId &&
    a.fingerprint === b.fingerprint &&
    a.pendingFingerprint === b.pendingFingerprint &&
    (a.error ?? '') === (b.error ?? '')
  )
}

/** Upper bound on a private key file we are willing to hand to ssh2 (v2.6.5). */
const MAX_PRIVATE_KEY_BYTES = 256 * 1024

/** Absolute POSIX or Windows path (v2.6.5). */
function isAbsolutePath(value: string): boolean {
  return value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\')
}

/**
 * A real private key always carries a PEM header — OpenSSH keys included
 * (`-----BEGIN OPENSSH PRIVATE KEY-----`). Anything else is refused so a
 * renderer-supplied path cannot turn the SSH layer into a file probe (v2.6.5).
 */
function looksLikePrivateKey(content: Buffer): boolean {
  const head = content.toString('utf8', 0, Math.min(content.length, 8192))
  return /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(head)
}

export interface SshManagerOptions {
  store: VpsServerStore
  backend: SshBackend
  audit: AuditLog
  rateLimiter?: RateLimiter
  idleTimeoutMs?: number
  now?: () => number
  onStatus?: (state: VpsConnectionState) => void
  /**
   * R1: per-server liveness, on every real transition. It carries the server id as its own
   * field, so a consumer can update ONE server fact instead of reading the last-writer-wins
   * `getState()` snapshot.
   */
  onLiveness?: (event: VpsLivenessEvent) => void
  onData?: (sessionId: string, chunk: string) => void
  readKeyFile?: (path: string) => Promise<Buffer>
  /**
   * R3: the dependency facts this layer cannot see for itself — which servers open remote projects
   * point at, and which servers an agent run is using. Re-read on every idle sweep, so a project or
   * a run that has ended releases its pin without any bookkeeping here.
   */
  pinSources?: () => readonly ServerPin[]
  /** R3: told about every pin taken, released or expired, so a kept session has a stated reason. */
  onPinChange?: (change: PinChange) => void
  /** R3: how long one UI keep-alive keeps a hand-connected server pinned. */
  manualLeaseMs?: number
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
  private readonly onLiveness?: (event: VpsLivenessEvent) => void
  private readonly onData?: (sessionId: string, chunk: string) => void
  private readonly readKeyFile: (path: string) => Promise<Buffer>
  private connections = new Map<string, ConnectionEntry>()
  /**
   * R3: the explicit pin set — why each connected server is exempt from the idle sweep. See
   * `pins.ts` for the three reasons and for the lease that keeps `manual-session` honest.
   */
  private readonly pins: PinRegistry
  private readonly pinSources?: () => readonly ServerPin[]
  private readonly onPinChange?: (change: PinChange) => void
  private readonly manualLeaseMs: number
  /** The dependency pins seen on the previous sweep, so a take/release is logged exactly once. */
  private sourcedPins = new Map<string, ServerPin>()
  /** In-flight connect attempts, so two callers cannot open two SSH clients. */
  private connecting = new Map<string, Promise<VpsConnectionState>>()
  private pendingFingerprints = new Map<string, string>()
  /** Last known state per server, so the UI can reason about each independently. */
  private serverStates = new Map<string, VpsConnectionState>()
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
    if (options.onLiveness) this.onLiveness = options.onLiveness
    if (options.onData) this.onData = options.onData
    if (options.pinSources) this.pinSources = options.pinSources
    if (options.onPinChange) this.onPinChange = options.onPinChange
    this.manualLeaseMs = options.manualLeaseMs ?? DEFAULT_MANUAL_LEASE_MS
    this.pins = new PinRegistry(this.now)
    this.readKeyFile = options.readKeyFile ?? ((path) => fs.readFile(path))
  }

  getState(): VpsConnectionState {
    return { ...this.state }
  }

  /** Last known state of one server, or disconnected when we have never seen it. */
  stateFor(serverId: string): VpsConnectionState {
    return this.serverStates.get(serverId) ?? { status: 'disconnected', serverId }
  }

  /** Per-server state snapshot (v2.6.4): every server keeps its own connection. */
  states(): Record<string, VpsConnectionState> {
    const entries: Record<string, VpsConnectionState> = {}
    for (const [id, state] of this.serverStates) entries[id] = { ...state }
    return entries
  }

  connectedServers(): string[] {
    return [...this.connections.keys()]
  }

  isConnected(serverId: string): boolean {
    return this.connections.has(serverId)
  }

  /** Connection details for a saved server, used by cross-server tools. */
  async resolveServer(
    id: string
  ): Promise<{ host: string; port: number; username: string } | undefined> {
    const server = (await this.store.list()).find((entry) => entry.id === id)
    return server ? { host: server.host, port: server.port, username: server.username } : undefined
  }

  /**
   * The saved-server roster, for the agent's `list_servers` tool (v2.8.1).
   *
   * The model previously had no way to learn a server id: the only id it ever saw was
   * the active project's own, so asking it to migrate to a *second* saved server ended
   * with it demanding a UUID from the user — and the UI never displays one. This exposes
   * id, name, host, port, user and connection state, and nothing secret.
   *
   * X1 (v4.3): the state is `hasSession` — do we hold an SSH connection *from here* — and
   * `configured`, so that "we have no session" can never again be printed as "offline" for a
   * machine that is up. Reachability is a separate, observed fact and is attached by the roster
   * executor (`reachability()` below), not invented here.
   */
  async listServers(): Promise<ServerSummary[]> {
    const servers = await this.store.list()
    return servers.map((server) => ({
      id: server.id,
      name: server.name,
      host: server.host,
      port: server.port,
      username: server.username,
      hasSession: this.isConnected(server.id),
      configured: true,
      ...(server.policy?.mode ? { policyMode: server.policy.mode } : {})
    }))
  }

  /**
   * X4: prove one saved server's port from every path this app can use, without a model call.
   *
   * Three facts, reported separately: from a connected source server (`/dev/tcp`), from this
   * computer (a TCP connect), and from the target itself (`ss -lnt`) when a session to it exists.
   * The decision logic is pure (`@core/remote/reachability`); this method only supplies the probes.
   */
  async reachability(server: {
    id: string
    host: string
    port: number
    name?: string
  }): Promise<ReachabilityReport> {
    const observed = await observeServerReachability(this, server)
    return observed.report
  }

  auditEntries(): AuditEntry[] {
    return this.audit.entries()
  }

  /** Record an audit entry (e.g. an SFTP file operation) outside `exec`. */
  async recordAudit(entry: Omit<AuditEntry, 'at'>): Promise<AuditEntry> {
    return this.audit.record(entry)
  }

  private setState(next: VpsConnectionState): VpsConnectionState {
    const previous = next.serverId ? this.serverStates.get(next.serverId) : undefined
    this.state = next
    if (next.serverId) this.serverStates.set(next.serverId, { ...next })
    // v2.6.5: emit only on a real transition. Every call used to emit `vps:status`,
    // and the renderer answers each event with an extra `vps:connected` invoke, so
    // a repeated identical state (e.g. a keepalive re-reporting "connected") cost a
    // full IPC round-trip for nothing.
    if (!previous || !sameConnectionState(previous, next)) {
      this.onStatus?.(this.getState())
      /*
       * R1: the same transition as a per-server event. `onStatus` already carries this state,
       * but its payload is the singular snapshot; this one states which server changed, which
       * is what lets the renderer update that server entry in `vpsStates` in the same tick.
       */
      if (next.serverId) {
        this.onLiveness?.({ serverId: next.serverId, state: { ...next }, at: this.now() })
      }
    }
    return this.getState()
  }

  /**
   * "The UI still shows this server as connected" — the third pin reason (R3).
   *
   * Refreshes the idle stamp (v2.6.5) **and** takes/renews a leased `manual-session` pin, so the
   * reason a session survives is stated rather than implied by a timestamp. The lease is what keeps
   * the reaper alive: a renderer that stops pinging loses the pin a couple of minutes later, and a
   * server nothing depends on is swept again.
   */
  markActive(serverId: string): void {
    this.touch(serverId)
    this.pin(serverId, 'manual-session', 'the renderer still lists it as connected', this.manualLeaseMs)
  }

  /**
   * Hold one server open for one stated reason (R3). Idempotent; a `leaseMs` makes the pin lapse on
   * its own, which is how the UI's claim is expressed. Every newly taken pin is logged.
   */
  pin(serverId: string, reason: ServerPinReason, detail?: string, leaseMs?: number): void {
    const change = this.pins.take({ serverId, reason, ...(detail ? { detail } : {}) }, leaseMs)
    if (change) this.announce(change)
  }

  /** Drop one reason. The server is swept on the next idle check once nothing else pins it (R3). */
  unpin(serverId: string, reason: ServerPinReason): void {
    const change = this.pins.release(serverId, reason)
    if (change) this.announce(change)
  }

  /** Every reason this server is currently pinned for: taken here plus the ones main supplies. */
  pinsFor(serverId: string): ServerPinReason[] {
    const held = this.pinIndex().get(serverId) ?? []
    return held.map((pin) => pin.reason)
  }

  /** The whole pin set with its reasons — what the reaper is honouring right now (R3). */
  pinnedServers(): ServerPin[] {
    return [...this.pinIndex().values()].flat()
  }

  private touch(serverId: string): void {
    const entry = this.connections.get(serverId)
    if (entry) entry.lastActivity = this.now()
  }

  /**
   * The pin set as the idle sweep reads it: explicitly held pins plus the dependency facts main
   * supplies, deduplicated per `(server, reason)`.
   */
  private pinIndex(): Map<string, ServerPin[]> {
    const index = new Map<string, ServerPin[]>()
    const add = (pin: ServerPin): void => {
      const held = index.get(pin.serverId)
      if (!held) {
        index.set(pin.serverId, [pin])
        return
      }
      if (held.some((entry) => entry.reason === pin.reason)) return
      held.push(pin)
    }
    for (const pin of this.pins.snapshot()) add(pin)
    for (const pin of this.pinSources?.() ?? []) add(pin)
    return index
  }

  /**
   * Log a dependency pin the first time it appears and the time it is gone.
   *
   * The pins main supplies (an open remote project, a live agent run) are derived on each sweep
   * rather than passed through add/remove calls, so their take/release is the difference between
   * the last sweep and this one. A pin that is merely held again is not re-logged.
   */
  private logDependencyChanges(): void {
    const next = new Map<string, ServerPin>()
    for (const pin of this.pinSources?.() ?? []) next.set(pin.serverId + ':' + pin.reason, pin)
    for (const [key, pin] of next) {
      if (this.sourcedPins.has(key)) continue
      this.announce({ ...pin, action: 'pinned', at: this.now() })
    }
    for (const [key, pin] of this.sourcedPins) {
      if (next.has(key)) continue
      this.announce({ ...pin, action: 'released', at: this.now() })
    }
    this.sourcedPins = next
  }

  /** Report a pin change. Never silent: a pin is the only reason a session was not reaped. */
  private announce(change: PinChange): void {
    if (this.onPinChange) {
      this.onPinChange(change)
      return
    }
    const detail = change.detail ? ' (' + change.detail + ')' : ''
    console.info(
      '[vps] ' + change.action + ' pin ' + change.serverId + ' for ' + change.reason + detail
    )
  }

  /**
   * Connect to a saved server.
   *
   * v2.6.5: concurrent attempts for the same server are coalesced. A double-click
   * on Connect, or the keepalive racing a manual connect, used to open two SSH
   * clients; the map kept the second and the first was never `end()`ed, leaking
   * an authenticated connection for the life of the process.
   */
  async connect(serverId: string): Promise<VpsConnectionState> {
    const existing = this.connections.get(serverId)
    if (existing) {
      const known = this.serverStates.get(serverId)
      return this.setState(
        known ? { ...known, status: 'connected' } : { status: 'connected', serverId }
      )
    }
    const inFlight = this.connecting.get(serverId)
    if (inFlight) return inFlight

    const attempt = this.doConnect(serverId).finally(() => {
      this.connecting.delete(serverId)
    })
    this.connecting.set(serverId, attempt)
    return attempt
  }

  private async doConnect(serverId: string): Promise<VpsConnectionState> {
    await this.store.load()
    const decrypted = await this.store.getDecrypted(serverId)
    if (!decrypted) return this.setState({ status: 'error', serverId, error: `Unknown server: ${serverId}` })
    const { server, password, passphrase } = decrypted

    let privateKey: Buffer | undefined
    if (server.authType === 'key') {
      if (!server.privateKeyPath) {
        return this.blocked(serverId, 'No private key configured — connection blocked.')
      }
      // v2.6.5: the stored path is a renderer-supplied string that used to be fed
      // straight to `fs.readFile` and then to ssh2 as key material, so it could
      // point at any readable file. Require an absolute path and only hand over a
      // file that really looks like a private key, of a sane size.
      const keyPath = server.privateKeyPath.trim()
      if (!isAbsolutePath(keyPath) || /[\u0000\n\r]/.test(keyPath)) {
        return this.blocked(serverId, `Private key path must be absolute: ${keyPath}`)
      }
      try {
        privateKey = await this.readKeyFile(keyPath)
      } catch {
        return this.blocked(serverId, `Private key not found: ${keyPath}`)
      }
      if (privateKey.length === 0 || privateKey.length > MAX_PRIVATE_KEY_BYTES) {
        return this.blocked(serverId, `Private key file is empty or too large: ${keyPath}`)
      }
      if (!looksLikePrivateKey(privateKey)) {
        return this.blocked(
          serverId,
          `Refusing to use a file that is not an SSH private key: ${keyPath}`
        )
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
      /*
       * R3: a session the app just opened is pinned for the UI, not reaped on a timer while the
       * renderer's keep-alive takes up to one interval to arrive. The pin is leased, so an app that
       * never comes back stops being a reason to hold the connection.
       */
      this.pin(serverId, 'manual-session', 'connected in the app', this.manualLeaseMs)
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
    /*
     * R3: an explicit disconnect ends the UI's claim, so its lease is dropped here rather than
     * waiting for it to lapse. The run and project pins are not touched: a disconnect is not the end
     * of a run, and a project still points at the server.
     */
    this.unpin(serverId, 'manual-session')
    if (this.connections.size === 0 && this.watchdog) {
      clearInterval(this.watchdog)
      this.watchdog = undefined
    }
    return this.setState({ status: 'disconnected', serverId })
  }

  async disconnectAll(): Promise<void> {
    for (const serverId of [...this.connections.keys()]) await this.disconnect(serverId)
  }

  /**
   * Trust the observation over the cached belief: check the handle instead of assuming it works.
   *
   * This is the half-open case that R1 missed. A socket whose peer is gone can stay in
   * `connections` indefinitely: `isConnected()` still answers true, the UI dot stays green, and yet
   * ssh2 rejects every `exec` with `Not connected` in a millisecond — so the liveness wrapper saw
   * "the manager says connected" plus the app's own vocabulary and did nothing at all.
   *
   * The probe is one trivial remote command (`true`) on the held handle, with a short deadline. A
   * handle that answers is alive and nothing happens. A handle that rejects or does not answer is
   * dead, and this method says so as a **real transition** — `disconnect()` clears the map entry,
   * ends the client and publishes the per-server liveness event, which is what moves the dot,
   * the tree row and the selector.
   *
   * It deliberately bypasses the deny list, the host policy and the rate limiter: `true` is not a
   * user command, it is a health check, and it must not consume the agent's command budget or be
   * refused by a read-only host policy.
   */
  async probeLiveness(
    serverId: string,
    timeoutMs = DEFAULT_LIVENESS_PROBE_TIMEOUT_MS
  ): Promise<boolean> {
    const entry = this.connections.get(serverId)
    if (!entry) {
      /*
       * No handle at all is already the fact. The per-server state is corrected only when it still
       * claims `connected`, so a real `error` (an unseen host key, a bad key) is never flattened
       * into a plain disconnect by a health check.
       */
      if (this.serverStates.get(serverId)?.status === 'connected') {
        this.setState({ status: 'disconnected', serverId })
      }
      return false
    }
    let alive: boolean
    try {
      const probe = await entry.connection.exec('true', timeoutMs)
      // A completed round trip is a live channel even if `true` somehow exited non-zero; only a
      // timeout means the socket answered nothing.
      alive = probe.timedOut !== true
    } catch {
      // ssh2 says `Not connected` / `channel closed` here: the write went nowhere.
      alive = false
    }
    if (alive) {
      this.touch(serverId)
      return true
    }
    await this.disconnect(serverId, 'liveness probe: the held connection answered nothing')
    return false
  }

  /**
   * R1: the one reconnect attempt after a tool found its session gone.
   *
   * Bounded by construction: it runs exactly once and returns that attempt outcome. There is no
   * loop and no second silent retry. It is logged with the reason it was triggered (the tool's own
   * failure line), and it drops the stale connection first - a dead client still sitting in
   * `connections` would make `connect()` answer "already connected" and never open a new session.
   * A failed attempt leaves the server `disconnected`, because that is the fact: no session.
   */
  async reconnectOnce(serverId: string, reason: string): Promise<VpsReconnectOutcome> {
    await this.audit.record({
      type: 'connect',
      ok: false,
      serverId,
      detail: `liveness: one reconnect attempt - ${reason}`
    })
    if (this.connections.has(serverId)) await this.disconnect(serverId, `liveness: ${reason}`)
    let attempt: VpsConnectionState
    try {
      attempt = await this.connect(serverId)
    } catch (error) {
      attempt = {
        status: 'error',
        serverId,
        error: error instanceof Error ? error.message : String(error)
      }
    }
    if (attempt.status === 'connected') return { ok: true, state: attempt, reason }
    /*
     * An unseen host key is left as the actionable `error` it is (the user must confirm the
     * fingerprint). Every other failed attempt reports the honest fact: no session.
     */
    const state = attempt.pendingFingerprint
      ? attempt
      : this.setState({
          status: 'disconnected',
          serverId,
          ...(attempt.error ? { error: attempt.error } : {})
        })
    return { ok: false, state, reason }
  }

  async exec(serverId: string, command: string, timeoutMs?: number): Promise<VpsExecResult> {
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
    const policy = await this.store.policyFor(serverId)
    if (policy) {
      const decision = evaluateHostPolicy(policy, command)
      if (!decision.allowed) {
        await this.audit.record({
          type: 'blocked',
          ok: false,
          serverId,
          command: denied.command,
          detail: `policy: ${decision.reason}`
        })
        return {
          ok: false,
          stdout: '',
          stderr: '',
          exitCode: 126,
          blocked: true,
          reason: decision.reason
        }
      }
      if (decision.requiresApproval) {
        await this.audit.record({
          type: 'blocked',
          ok: false,
          serverId,
          command: denied.command,
          detail: `policy: approval required — ${decision.reason}`
        })
        return {
          ok: false,
          stdout: '',
          stderr: '',
          exitCode: 126,
          requiresApproval: true,
          reason: decision.reason
        }
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
      const effectiveTimeout = timeoutMs ?? getCommandTimeout(command)
      const result = await entry.connection.exec(command, effectiveTimeout)
      if (result.timedOut) {
        const reason = `Command timed out after ${effectiveTimeout}ms.`
        await this.audit.record({ type: 'exec', ok: false, serverId, command: denied.command, detail: reason })
        return {
          ok: false,
          stdout: result.stdout,
          stderr: reason,
          exitCode: 124,
          timedOut: true,
          reason
        }
      }
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
    // v2.6.5: re-opening a terminal (panel remount, a reconnect) overwrote the
    // handle and leaked the previous shell channel, whose data listener kept
    // touching the connection so the idle watchdog never reaped it. Close the old
    // shell first — its `onClose` clears `entry.terminal` while it still refers to
    // the previous session, so the assignment below is the last word.
    entry.terminal?.close()
    entry.terminal = session
    return session.id
  }

  writeTerminal(serverId: string, data: string): void {
    this.connections.get(serverId)?.terminal?.write(data)
    this.touch(serverId)
  }

  /**
   * Close only the interactive shell for a server, leaving its SSH connection
   * (and every other server's connection) up. v2.6.4: a terminal panel
   * unmounting must not tear down a connection other projects rely on.
   */
  closeTerminal(serverId: string, sessionId?: string): void {
    const entry = this.connections.get(serverId)
    if (!entry?.terminal) return
    if (sessionId && entry.terminal.id !== sessionId) return
    entry.terminal.close()
    entry.terminal = undefined
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

  /**
   * Restore a `<path>.backup-<ts>` copy over its original file (v2.3.2, B.1).
   * Only paths we recognise as backups are accepted.
   */
  async restoreBackup(serverId: string, backupPath: string): Promise<void> {
    const parsed = parseBackupPath(backupPath)
    if (!parsed) {
      throw new Error('Not a recognised backup path')
    }
    const result = await this.exec(serverId, restoreCommandFor(backupPath, shellQuote)!)
    if (!result.ok) {
      throw new Error(result.stderr || result.reason || 'Restore failed')
    }
    await this.audit.record({
      type: 'backup_restored',
      ok: true,
      serverId,
      command: `fs:restore ${parsed.original}`,
      detail: backupPath
    })
  }

  /** Run a project's post-deploy health checks over the SSH connection. */
  async healthCheck(serverId: string, config: HealthCheckConfig): Promise<HealthCheckOutcome> {
    return runHealthCheck(async (command) => {
      const result = await this.exec(serverId, command)
      return {
        ok: result.ok,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode
      }
    }, config)
  }

  /**
   * The idle sweep (R3).
   *
   * A **pinned** server is never swept, regardless of idle time: something depends on it (a run, an
   * open remote project, or the UI's own claim). An **unpinned** one that genuinely idles still
   * closes on the same 30-minute cutoff as before — the reaper is not disabled, it is told what not
   * to reap.
   *
   * Leases and dependency pins are settled here first, so a pin that lapsed or a project that closed
   * is both logged and effective in the same sweep that would otherwise have closed the session.
   */
  async checkIdle(): Promise<string[]> {
    for (const change of this.pins.expire()) this.announce(change)
    this.logDependencyChanges()
    const cutoff = this.now() - this.idleTimeoutMs
    const pinned = this.pinIndex()
    const idle: string[] = []
    for (const [serverId, entry] of this.connections) {
      const held = pinned.get(serverId)
      if (held && held.length > 0) continue
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
