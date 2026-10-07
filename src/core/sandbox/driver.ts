import type {
  CreateSandboxOptions,
  ExecOptions,
  ExecResult,
  SandboxLimits,
  SandboxProvider
} from '@shared/sandbox'

/** Runtime state a driver needs to operate an existing sandbox. */
export interface SandboxHandle {
  id: string
  provider: SandboxProvider
  image?: string
  /** Host directory mounted as the sandbox workspace. */
  workspaceRoot: string
  /** Container name (Docker only). */
  containerName?: string
  limits: SandboxLimits
  networkEnabled: boolean
  env: Record<string, string>
}

export interface SandboxCreateSpec extends CreateSandboxOptions {
  id: string
  workspaceRoot: string
  limits: SandboxLimits
  networkEnabled: boolean
  env: Record<string, string>
  image?: string
}

/** Low-level provider implementation. One instance serves many sandboxes. */
export interface SandboxDriver {
  readonly provider: SandboxProvider
  /** Whether this provider can run right now (e.g. Docker daemon reachable). */
  isAvailable(): Promise<boolean>
  create(spec: SandboxCreateSpec): Promise<SandboxHandle>
  exec(handle: SandboxHandle, command: string, options: ExecOptions): Promise<ExecResult>
  writeFile(handle: SandboxHandle, relativePath: string, content: string | Uint8Array): Promise<void>
  readFile(handle: SandboxHandle, relativePath: string): Promise<string>
  destroy(handle: SandboxHandle): Promise<void>
}
