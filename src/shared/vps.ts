/** VPS / remote (SSH) types shared across main, preload and renderer. */

export type VpsAuthType = 'key' | 'password'

/** How much a host may be mutated (v2.3.1, B.3). */
export type HostPolicyMode = 'read-only' | 'staging' | 'production'

/** When the agent must ask before touching a host. */
export type HostApprovalRequirement = 'never' | 'always' | 'destructive'

/** Per-host command policy. Absent ⇒ the legacy deny-list-only behaviour. */
export interface HostPolicy {
  vpsId: string
  mode: HostPolicyMode
  allowCommands: string[]
  denyCommands: string[]
  requireApproval: HostApprovalRequirement
  allowedPaths: string[]
  /**
   * Commands that are always allowed without approval, on every mode
   * (v2.3.2, A.3). Empty/absent ⇒ fall back to the legacy read heuristic.
   */
  readOnlyCommands?: string[]
  /** Commands that require approval on staging / are blocked on production. */
  writeCommands?: string[]
}

export interface VpsServer {
  id: string
  name: string
  host: string
  port: number
  username: string
  authType: VpsAuthType
  privateKeyPath?: string
  createdAt: number
  updatedAt: number
  trustedFingerprint?: string
  lastConnectedAt?: number
  policy?: HostPolicy
}

/** One host imported from `~/.ssh/config` (v2.3.2, B.5). Private key contents are never read. */
export interface SshConfigHost {
  alias: string
  hostName: string
  user?: string
  port?: number
  identityFile?: string
}

export interface VpsServerInput {
  id?: string
  name: string
  host: string
  port?: number
  username: string
  authType: VpsAuthType
  privateKeyPath?: string
  /** Secret; encrypted at rest and never returned. */
  password?: string
  /** Secret; encrypted at rest and never returned. */
  passphrase?: string
  /** Pin the presented fingerprint after the user confirms it. */
  trustFingerprint?: string
  /** Replace this host's command policy (v2.3.1, B.3). */
  policy?: HostPolicy
}

/** Secret-free server row for the renderer. */
export interface VpsServerView {
  id: string
  name: string
  host: string
  port: number
  username: string
  authType: VpsAuthType
  hasPassword: boolean
  hasPrivateKey: boolean
  trustedFingerprint?: string
  createdAt: number
  updatedAt: number
  lastConnectedAt?: number
  policy?: HostPolicy
}

export type ConnectionOutcome = 'open' | 'timeout' | 'refused' | 'unreachable' | 'invalid'

/**
 * Where an observation of a TCP port was made from (X1/X4).
 *
 * `from` is part of the fact, not a label on it: "port 22 closed" means nothing until the reader knows
 * *who* could not reach it. Three different questions used to share one word — do we hold an SSH
 * session, can another host connect, is the server saved in Settings — and a server that was up and
 * answering ping was reported as "offline" because only the first of the three was false.
 */
export type PortFactOrigin = 'source' | 'local' | 'target' | 'unknown'

/**
 * One observed fact about a port. `open: null` means **nobody has looked**, never "the machine is
 * down": an unobserved path must not be rendered as a negative fact.
 */
export interface PortFact {
  from: PortFactOrigin
  /** true = a connection from `from` was possible; false = it was not; null = not observed. */
  open: boolean | null
  /** Epoch ms of the observation. Only meaningful when `open` is not null. */
  at: number
  /** The probe's own short words: `refused`, `timed out`, `blocked by host policy`, … */
  detail?: string
}

/** What the three paths, compared, actually agree on. Computed from the facts — never from a model. */
export type ReachabilityAgreement =
  | 'all-open'
  | 'all-closed'
  | 'local-only'
  | 'source-only'
  | 'target-only'
  | 'split'
  | 'unobserved'

/**
 * The three-path reachability preflight (X4).
 *
 * Only `source → target` was ever tested, so a port filtered from two servers looked like a dead
 * server while the machine was listening on 22 and reachable from the user's own computer. This
 * report keeps one fact per path, says in one sentence what they mean together, and ends with the
 * action the evidence supports.
 */
export interface ReachabilityReport {
  host: string
  port: number
  /** source server → target port, when an SSH session to a *different* server was available. */
  source: PortFact
  /** this computer → target port. A different network by construction. */
  local: PortFact
  /** the target's own listener table (`ss -lnt`), which needs a session to the target itself. */
  target: PortFact
  agreement: ReachabilityAgreement
  /** One sentence, built from the facts above, that never calls a server "down". */
  summary: string
  /**
   * The one action this evidence supports. `through-this-computer` exists because that path was the
   * only one that could have worked in the session this came from, and it was never tried.
   */
  recommendation?: 'through-this-computer' | 'transfer-from-source' | 'ask-the-provider'
  /** The consequences of `recommendation`, one per line — usually two ways to proceed. */
  nextSteps: string[]
}

/**
 * The answer to "can this computer reach that server?" (v4.1).
 *
 * It exists so the app can answer that question instead of the model improvising a port scan with
 * `/dev/tcp` — which is how a firewall problem once looked like a broken agent.
 */
export interface ConnectionTestResult {
  ok: boolean
  host: string
  port: number
  outcome: ConnectionOutcome
  latencyMs?: number
  message?: string
  /** The test always runs from this computer, and says so. */
  from: 'this-machine'
  /**
   * The same question asked from every path the app can use (X4). Optional because it needs a saved
   * server and, for the source path, a live session; when absent the surface shows only `outcome`,
   * which is still the honest answer for one path.
   */
  paths?: ReachabilityReport
}

export type VpsStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface VpsConnectionState {
  status: VpsStatus
  serverId?: string
  fingerprint?: string
  /** Set when the host key is unseen and needs explicit approval. */
  pendingFingerprint?: string
  error?: string
}

export interface RemoteFileEntry {
  name: string
  path: string
  type: 'file' | 'dir' | 'link'
  size?: number
  modifiedAt?: number
}

export interface VpsExecResult {
  ok: boolean
  stdout: string
  stderr: string
  exitCode: number
  blocked?: boolean
  rateLimited?: boolean
  /** Set when this host's policy requires explicit approval before running. */
  requiresApproval?: boolean
  /** Set when the command was killed for exceeding its timeout (v2.3.2, A.4). */
  timedOut?: boolean
  reason?: string
}

export interface AuditEntryView {
  at: string
  type: string
  ok: boolean
  serverId?: string
  command?: string
  detail?: string
}

/** Post-deploy health checks for a project (v2.3.2, B.2). */
export interface HealthCheckConfig {
  processName?: string
  port?: number
  /** Defaults to `http://localhost:<port>/health`. */
  healthEndpoint?: string
  /** An extra command that must exit 0. */
  customCommand?: string
}

export interface HealthCheckOutcome {
  ok: boolean
  failed?: string
  output?: string
  /** Every check that ran, in order. */
  ran: string[]
}
