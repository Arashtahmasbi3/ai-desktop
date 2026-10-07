import {
  DEFAULT_SANDBOX_LIMITS,
  type CreateSandboxOptions,
  type ExecOptions,
  type ExecResult,
  type SandboxInfo,
  type SandboxManager
} from '@shared/sandbox'

/**
 * In-memory SandboxManager for tests. Records lifecycle calls and lets the
 * caller script command results.
 */
export class FakeSandbox implements SandboxManager {
  readonly created: string[] = []
  readonly destroyed: string[] = []
  readonly executed: Array<{ id: string; command: string; options?: ExecOptions }> = []
  private counter = 0

  constructor(private readonly runner?: (command: string) => Promise<Partial<ExecResult>> | Partial<ExecResult>) {}

  async createSandbox(options: CreateSandboxOptions = {}): Promise<SandboxInfo> {
    const id = `sandbox-${++this.counter}`
    this.created.push(id)
    const now = Date.now()
    return {
      id,
      provider: options.provider ?? 'local',
      status: 'running',
      createdAt: now,
      lastUsedAt: now,
      limits: { ...DEFAULT_SANDBOX_LIMITS, ...options.limits },
      networkEnabled: options.network?.enabled ?? false,
      ...(options.workspaceRoot ? { workspaceRoot: options.workspaceRoot } : {})
    }
  }

  async executeCommand(id: string, command: string, options?: ExecOptions): Promise<ExecResult> {
    this.executed.push({ id, command, ...(options ? { options } : {}) })
    const extra = (await this.runner?.(command)) ?? {}
    return {
      stdout: '',
      stderr: '',
      exitCode: 0,
      timedOut: false,
      durationMs: 1,
      ...extra
    }
  }

  async writeFile(): Promise<void> {}
  async readFile(): Promise<string> {
    return ''
  }
  async destroySandbox(id: string): Promise<void> {
    this.destroyed.push(id)
  }

  getSandbox(): SandboxInfo | undefined {
    return undefined
  }
  listSandboxes(): SandboxInfo[] {
    return []
  }
  async destroyAll(): Promise<void> {}
  async sweep(): Promise<string[]> {
    return []
  }
}
