import { promises as fs, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ExecOptions, ExecResult, SandboxProvider } from '@shared/sandbox'
import type { CommandRunner } from './command-runner'
import { ChildProcessRunner } from './command-runner'
import type { SandboxCreateSpec, SandboxDriver, SandboxHandle } from './driver'
import { ExecFailedError } from './errors'
import { resolveInsideWorkspace, resolveWorkspaceDir } from './paths'
import { resolveSandboxShell, shellDialectMismatch, type SandboxShell } from './shell'

export interface LocalSandboxOptions {
  runner?: CommandRunner
  defaultExecTimeoutMs?: number
  /** Restrict the child environment to a minimal allow-list (default true). */
  restrictEnv?: boolean
  /** Override the shell (tests, or a user-pinned Git Bash / WSL path). */
  shell?: SandboxShell
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
  private readonly shellOverride?: SandboxShell

  constructor(options: LocalSandboxOptions = {}) {
    this.runner = options.runner ?? new ChildProcessRunner()
    this.defaultExecTimeoutMs = options.defaultExecTimeoutMs ?? 30_000
    this.restrictEnv = options.restrictEnv ?? true
    this.shellOverride = options.shell
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

  /**
   * The shell every command runs in (v2.6.5). POSIX `/bin/sh` on POSIX and the
   * best available POSIX shell on Windows (Git for Windows' `bash.exe`), because
   * the agent only ever writes POSIX commands. Resolved once and cached.
   */
  protected shellFor(): SandboxShell {
    if (!this.cachedShell) {
      this.cachedShell =
        this.shellOverride ?? resolveSandboxShell(process.platform, process.env, existsSync)
    }
    return this.cachedShell
  }

  /** True when no POSIX shell was found and commands will run under `cmd.exe`. */
  protected usesNonPosixShell(): boolean {
    return shellDialectMismatch(this.shellFor())
  }

  private cachedShell?: SandboxShell

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
    // A caller-supplied workspace is not ours to delete.
    if (handle.ownsWorkspace === false) return
    await fs.rm(handle.workspaceRoot, { recursive: true, force: true })
  }
}

/**
 * Fallback for Windows users without Docker.
 *
 * v2.6.5: this used to force `cmd.exe`, which cannot run any of the POSIX
 * commands the agent writes — every command failed and returned empty output.
 * It now inherits the POSIX-shell preference from {@link LocalSandboxDriver} and
 * only ends up on `cmd.exe` when no Git Bash / WSL shell is installed.
 * See {@link LocalSandboxDriver} for the isolation caveats.
 */
export class WindowsSandboxDriver extends LocalSandboxDriver {
  override readonly provider: SandboxProvider = 'windows'

  override async isAvailable(): Promise<boolean> {
    return process.platform === 'win32'
  }
}
