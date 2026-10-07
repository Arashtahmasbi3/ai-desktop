import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import type { ExecOptions, ExecResult, SandboxProvider } from '@shared/sandbox'
import type { CommandRunner } from './command-runner'
import { ChildProcessRunner } from './command-runner'
import type { SandboxCreateSpec, SandboxDriver, SandboxHandle } from './driver'
import { ExecFailedError } from './errors'
import { resolveInsideWorkspace, resolveWorkspaceDir } from './paths'

export interface LocalSandboxOptions {
  runner?: CommandRunner
  defaultExecTimeoutMs?: number
  /** Restrict the child environment to a minimal allow-list (default true). */
  restrictEnv?: boolean
}

/**
 * Runs commands directly on the host inside an isolated workspace directory.
 *
 * This is a best-effort fallback for machines without Docker. It enforces path
 * containment, a minimal environment and per-command timeouts, but it is **not**
 * a security boundary: commands run as the current user and can reach the host
 * filesystem outside the workspace.
 */
export class LocalSandboxDriver implements SandboxDriver {
  readonly provider: SandboxProvider = 'local'
  protected readonly runner: CommandRunner
  protected readonly defaultExecTimeoutMs: number
  private readonly restrictEnv: boolean

  constructor(options: LocalSandboxOptions = {}) {
    this.runner = options.runner ?? new ChildProcessRunner()
    this.defaultExecTimeoutMs = options.defaultExecTimeoutMs ?? 30_000
    this.restrictEnv = options.restrictEnv ?? true
  }

  async isAvailable(): Promise<boolean> {
    return true
  }

  async create(spec: SandboxCreateSpec): Promise<SandboxHandle> {
    await fs.mkdir(spec.workspaceRoot, { recursive: true })
    return {
      id: spec.id,
      provider: this.provider,
      workspaceRoot: spec.workspaceRoot,
      limits: spec.limits,
      networkEnabled: spec.networkEnabled,
      env: spec.env
    }
  }

  protected shellFor(): { file: string; args: (command: string) => string[] } {
    if (process.platform === 'win32') {
      return { file: 'cmd.exe', args: (command) => ['/d', '/s', '/c', command] }
    }
    return { file: '/bin/sh', args: (command) => ['-c', command] }
  }

  protected buildEnv(handle: SandboxHandle, options: ExecOptions): Record<string, string> {
    const extra = { ...handle.env, ...options.env }
    if (!this.restrictEnv) return { ...(process.env as Record<string, string>), ...extra }
    const allow: Record<string, string> = {}
    for (const key of ['PATH', 'SystemRoot', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'HOME']) {
      const value = process.env[key]
      if (value !== undefined) allow[key] = value
    }
    return { ...allow, ...extra }
  }

  async exec(handle: SandboxHandle, command: string, options: ExecOptions): Promise<ExecResult> {
    const cwd = resolveWorkspaceDir(handle.workspaceRoot, options.cwd)
    await fs.mkdir(cwd, { recursive: true })
    const shell = this.shellFor()
    try {
      return await this.runner.run(shell.file, shell.args(command), {
        cwd,
        env: this.buildEnv(handle, options),
        timeoutMs: options.timeoutMs ?? this.defaultExecTimeoutMs,
        stdin: options.stdin,
        maxOutputBytes: options.maxOutputBytes
      })
    } catch (error) {
      throw new ExecFailedError(
        `command failed: ${error instanceof Error ? error.message : String(error)}`,
        { provider: this.provider, sandboxId: handle.id, cause: error }
      )
    }
  }

  async writeFile(
    handle: SandboxHandle,
    relativePath: string,
    content: string | Uint8Array
  ): Promise<void> {
    const target = resolveInsideWorkspace(handle.workspaceRoot, relativePath)
    await fs.mkdir(dirname(target), { recursive: true })
    await fs.writeFile(target, content)
  }

  async readFile(handle: SandboxHandle, relativePath: string): Promise<string> {
    const target = resolveInsideWorkspace(handle.workspaceRoot, relativePath)
    return fs.readFile(target, 'utf8')
  }

  async destroy(handle: SandboxHandle): Promise<void> {
    await fs.rm(handle.workspaceRoot, { recursive: true, force: true })
  }
}

/**
 * Fallback for Windows users without Docker: a `cmd.exe`-backed local sandbox.
 * See {@link LocalSandboxDriver} for the isolation caveats.
 */
export class WindowsSandboxDriver extends LocalSandboxDriver {
  override readonly provider: SandboxProvider = 'windows'

  override async isAvailable(): Promise<boolean> {
    return process.platform === 'win32'
  }

  protected override shellFor(): { file: string; args: (command: string) => string[] } {
    return { file: 'cmd.exe', args: (command) => ['/d', '/s', '/c', command] }
  }
}
