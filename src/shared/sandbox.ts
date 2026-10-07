/**
 * Sandbox (code execution) types — shared between main, renderer and core.
 * Kept dependency-free and environment-neutral.
 */

export type SandboxProvider = 'docker' | 'windows' | 'local'

export type SandboxStatus = 'creating' | 'running' | 'stopped' | 'error'

/** Resource limits applied to a sandbox. */
export interface SandboxLimits {
  /** CPU cores (fractional allowed). */
  cpus: number
  /** Memory in MiB. */
  memoryMb: number
  /** Workspace disk budget in MiB (soft on drivers without quota support). */
  diskMb: number
  /** Max number of processes. */
  pidsLimit: number
}

export interface SandboxNetwork {
  /** Network access is disabled by default. */
  enabled: boolean
}

export interface CreateSandboxOptions {
  /** Force a specific provider instead of auto-selecting. */
  provider?: SandboxProvider
  /** Container image (Docker provider only). */
  image?: string
  limits?: Partial<SandboxLimits>
  network?: Partial<SandboxNetwork>
  /** Extra environment variables for executed commands. */
  env?: Record<string, string>
  /** Auto-destroy the sandbox after this many ms (from creation). */
  ttlMs?: number
  /** Auto-destroy the sandbox after this many ms of inactivity. */
  idleTimeoutMs?: number
  /** Override the host directory used as the workspace. */
  workspaceRoot?: string
}

export interface SandboxInfo {
  id: string
  provider: SandboxProvider
  status: SandboxStatus
  image?: string
  createdAt: number
  lastUsedAt: number
  /** Host path of the workspace (available for local providers). */
  workspaceRoot?: string
  limits: SandboxLimits
  networkEnabled: boolean
}

export interface ExecOptions {
  /** Working directory relative to the workspace root (default '.'). */
  cwd?: string
  timeoutMs?: number
  env?: Record<string, string>
  stdin?: string
  /** Cap on captured stdout/stderr bytes (default 1 MiB each). */
  maxOutputBytes?: number
}

export interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number
  timedOut: boolean
  durationMs: number
}

/**
 * Public sandbox API. Lifecycle, concurrency and expiry are handled by the
 * implementation; callers only deal with ids and content.
 */
export interface SandboxManager {
  createSandbox(options?: CreateSandboxOptions): Promise<SandboxInfo>
  executeCommand(sandboxId: string, command: string, options?: ExecOptions): Promise<ExecResult>
  writeFile(sandboxId: string, path: string, content: string | Uint8Array): Promise<void>
  readFile(sandboxId: string, path: string): Promise<string>
  destroySandbox(sandboxId: string): Promise<void>

  getSandbox(sandboxId: string): SandboxInfo | undefined
  listSandboxes(): SandboxInfo[]
  /** Destroy every sandbox owned by this manager. */
  destroyAll(): Promise<void>
  /** Immediately destroy sandboxes past their TTL/idle deadline; returns their ids. */
  sweep(): Promise<string[]>
}

export const DEFAULT_SANDBOX_LIMITS: SandboxLimits = {
  cpus: 1,
  memoryMb: 512,
  diskMb: 1024,
  pidsLimit: 256
}

export const DEFAULT_SANDBOX_IMAGE = 'node:20-alpine'
