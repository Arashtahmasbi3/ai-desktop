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
