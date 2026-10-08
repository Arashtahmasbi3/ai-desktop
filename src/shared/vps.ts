/** VPS / remote (SSH) types shared across main, preload and renderer. */

export type VpsAuthType = 'key' | 'password'

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
