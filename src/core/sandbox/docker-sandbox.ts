import type { ExecOptions, ExecResult, SandboxProvider } from '@shared/sandbox'
import type { CommandRunner } from './command-runner'
import { ChildProcessRunner } from './command-runner'
import type { SandboxCreateSpec, SandboxDriver, SandboxHandle } from './driver'
import { ExecFailedError, ProviderUnavailableError } from './errors'
import { normalizeSandboxPath, toContainerPath } from './paths'
import { shellQuote } from '@shared/shell-quote'

export interface DockerSandboxOptions {
  /** Docker binary (for testing / non-standard installs). */
  dockerPath?: string
  runner?: CommandRunner
  containerBasePath?: string
  /** Apply `--storage-opt size=` (needs a quota-capable storage driver). */
  enforceDiskQuota?: boolean
  defaultExecTimeoutMs?: number
}

const TMP_SIZE_MB = 64
const CONTAINER_WORKDIR = '/workspace'
/** Default sandbox image. */
const DEFAULT_IMAGE = 'node:20-alpine'
/**
 * A conservative Docker image reference. It must not start with `-`, so an
 * attacker-supplied value can never be read by Docker as another flag.
 */
const IMAGE_REFERENCE = /^[a-z0-9][a-z0-9._\-/:@]*$/i

/**
 * Runs commands inside a hardened Docker container:
 * - no network by default (`--network none`)
 * - read-only root filesystem; only the workspace bind-mount is writable
 * - CPU / memory / PID limits and a size-limited tmpfs for `/tmp`
 * - all capabilities dropped, `no-new-privileges`
 */
export class DockerSandboxDriver implements SandboxDriver {
  readonly provider: SandboxProvider = 'docker'

  private readonly dockerPath: string
  private readonly runner: CommandRunner
  private readonly containerBasePath: string
  private readonly enforceDiskQuota: boolean
  private readonly defaultExecTimeoutMs: number

  constructor(options: DockerSandboxOptions = {}) {
    this.dockerPath = options.dockerPath ?? 'docker'
    this.runner = options.runner ?? new ChildProcessRunner()
    this.containerBasePath = options.containerBasePath ?? CONTAINER_WORKDIR
    this.enforceDiskQuota = options.enforceDiskQuota ?? false
    this.defaultExecTimeoutMs = options.defaultExecTimeoutMs ?? 30_000
  }

  async isAvailable(): Promise<boolean> {
    try {
      const result = await this.runner.run(
        this.dockerPath,
        ['info', '--format', '{{.ServerVersion}}'],
        { timeoutMs: 10_000, maxOutputBytes: 4096 }
      )
      return result.exitCode === 0
    } catch {
      return false
    }
  }

  buildCreateArgs(spec: SandboxCreateSpec): string[] {
    const containerName = containerNameFor(spec.id)
    const args = [
      'create',
      '--name',
      containerName,
      '--cpus',
      String(spec.limits.cpus),
      '--memory',
      `${spec.limits.memoryMb}m`,
      '--memory-swap',
      `${spec.limits.memoryMb}m`,
      '--pids-limit',
      String(spec.limits.pidsLimit),
      '--network',
      spec.networkEnabled ? 'bridge' : 'none',
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--tmpfs',
      `/tmp:rw,noexec,nosuid,size=${TMP_SIZE_MB}m`,
      '--tmpfs',
      '/run:rw,noexec,nosuid,size=16m',
      '-v',
      `${spec.workspaceRoot}:${this.containerBasePath}:rw`,
      '-w',
      this.containerBasePath
    ]

    if (this.enforceDiskQuota) {
      args.push('--storage-opt', `size=${spec.limits.diskMb}m`)
    }

    for (const [key, value] of Object.entries(spec.env)) {
      args.push('-e', `${key}=${value}`)
    }

    // v2.6.5: the image reference is validated before it reaches argv. It is
    // pushed after the hardening flags, so a value beginning with `-` would be
    // parsed by Docker as another flag (e.g. `--network=host`, overriding the
    // `--network none` set above). `docker-migrate-tool.ts` already validates its
    // refs this way; this driver did not.
    const image = spec.image ?? DEFAULT_IMAGE
    if (!IMAGE_REFERENCE.test(image)) {
      throw new ExecFailedError(`Invalid sandbox image reference: ${image}`, {
        provider: this.provider,
        sandboxId: spec.id
      })
    }
    args.push(image)
    // Keep the container alive without a shell dependency beyond `sh`.
    args.push('sh', '-c', 'trap "exit 0" TERM INT; while true; do sleep 3600 & wait $!; done')
    return args
  }

  async create(spec: SandboxCreateSpec): Promise<SandboxHandle> {
    const containerName = containerNameFor(spec.id)
    const create = await this.runner.run(this.dockerPath, this.buildCreateArgs(spec), {
      timeoutMs: 120_000
    })
    if (create.exitCode !== 0) {
      throw new ExecFailedError(`docker create failed: ${create.stderr.trim()}`, {
        provider: this.provider,
        sandboxId: spec.id
      })
    }

    const start = await this.runner.run(this.dockerPath, ['start', containerName], {
      timeoutMs: 60_000
    })
    if (start.exitCode !== 0) {
      // Best-effort cleanup so a failed start does not leak a container.
      await this.runner
        .run(this.dockerPath, ['rm', '-f', containerName], { timeoutMs: 30_000 })
        .catch(() => undefined)
      throw new ExecFailedError(`docker start failed: ${start.stderr.trim()}`, {
        provider: this.provider,
        sandboxId: spec.id
      })
    }

    return {
      id: spec.id,
      provider: this.provider,
      image: spec.image,
      workspaceRoot: spec.workspaceRoot,
      containerName,
      limits: spec.limits,
      networkEnabled: spec.networkEnabled,
      env: spec.env
    }
  }

  buildExecArgs(handle: SandboxHandle, command: string, options: ExecOptions): string[] {
    const args = ['exec', '-i']
    const workdir = options.cwd
      ? toContainerPath(options.cwd, this.containerBasePath)
      : this.containerBasePath
    args.push('-w', workdir)
    const env = { ...handle.env, ...options.env }
    for (const [key, value] of Object.entries(env)) {
      args.push('-e', `${key}=${value}`)
    }
    args.push(handle.containerName!, 'sh', '-lc', command)
    return args
  }

  async exec(handle: SandboxHandle, command: string, options: ExecOptions): Promise<ExecResult> {
    try {
      return await this.runner.run(this.dockerPath, this.buildExecArgs(handle, command, options), {
        timeoutMs: options.timeoutMs ?? this.defaultExecTimeoutMs,
        stdin: options.stdin,
        maxOutputBytes: options.maxOutputBytes
      })
    } catch (error) {
      throw new ExecFailedError(
        `docker exec failed: ${error instanceof Error ? error.message : String(error)}`,
        { provider: this.provider, sandboxId: handle.id, cause: error }
      )
    }
  }

  async writeFile(
    handle: SandboxHandle,
    relativePath: string,
    content: string | Uint8Array
  ): Promise<void> {
    const target = toContainerPath(relativePath, this.containerBasePath)
    const script = `mkdir -p "$(dirname ${shellQuote(target)})" && cat > ${shellQuote(target)}`
    const result = await this.runner.run(
      this.dockerPath,
      ['exec', '-i', handle.containerName!, 'sh', '-c', script],
      { stdin: content, timeoutMs: 30_000 }
    )
    if (result.exitCode !== 0) {
      throw new ExecFailedError(`docker write failed: ${result.stderr.trim()}`, {
        provider: this.provider,
        sandboxId: handle.id
      })
    }
  }

  async readFile(handle: SandboxHandle, relativePath: string): Promise<string> {
    const target = toContainerPath(relativePath, this.containerBasePath)
    const result = await this.runner.run(
      this.dockerPath,
      ['exec', handle.containerName!, 'cat', target],
      { timeoutMs: 30_000 }
    )
    if (result.exitCode !== 0) {
      throw new ExecFailedError(`docker read failed: ${result.stderr.trim()}`, {
        provider: this.provider,
        sandboxId: handle.id
      })
    }
    return result.stdout
  }

  async destroy(handle: SandboxHandle): Promise<void> {
    const name = handle.containerName ?? containerNameFor(handle.id)
    const result = await this.runner.run(this.dockerPath, ['rm', '-f', name], {
      timeoutMs: 60_000
    })
    // Removing an already-absent container is not an error.
    if (result.exitCode !== 0 && !/No such container/i.test(result.stderr)) {
      throw new ExecFailedError(`docker rm failed: ${result.stderr.trim()}`, {
        provider: this.provider,
        sandboxId: handle.id
      })
    }
  }

  /** Throw unless the Docker daemon is reachable. */
  async assertAvailable(): Promise<void> {
    if (!(await this.isAvailable())) {
      throw new ProviderUnavailableError('docker', 'daemon not reachable')
    }
  }
}

export function containerNameFor(id: string): string {
  return `ai-desktop-sbx-${normalizeSandboxPath(`sandbox-${id}`).replace(/\//g, '-')}`
}
