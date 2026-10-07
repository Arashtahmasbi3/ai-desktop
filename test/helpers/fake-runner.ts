import type {
  CommandRunner,
  RunOptions,
  RunResult
} from '@core/sandbox/command-runner'
import type { SandboxDriver, SandboxHandle } from '@core/sandbox/driver'
import type { SandboxCreateSpec } from '@core/sandbox/driver'
import type { ExecOptions, ExecResult, SandboxProvider } from '@shared/sandbox'

export interface RecordedRun {
  file: string
  args: string[]
  options: RunOptions | undefined
}

export type RunHandler = (
  file: string,
  args: string[],
  options: RunOptions | undefined
) => RunResult | Promise<RunResult>

export function runResult(partial: Partial<RunResult> = {}): RunResult {
  return {
    stdout: '',
    stderr: '',
    exitCode: 0,
    timedOut: false,
    durationMs: 1,
    ...partial
  }
}

/** A `CommandRunner` that records every call and delegates to a handler. */
export class FakeRunner implements CommandRunner {
  readonly calls: RecordedRun[] = []

  constructor(private readonly handler: RunHandler) {}

  async run(file: string, args: string[], options?: RunOptions): Promise<RunResult> {
    this.calls.push({ file, args, options })
    return this.handler(file, args, options)
  }
}

/** A `SandboxDriver` stub for registry/selection tests. */
export class FakeDriver implements SandboxDriver {
  execCalls: { command: string; options: ExecOptions }[] = []

  constructor(
    readonly provider: SandboxProvider,
    private readonly available: boolean
  ) {}

  async isAvailable(): Promise<boolean> {
    return this.available
  }

  async create(spec: SandboxCreateSpec): Promise<SandboxHandle> {
    return {
      id: spec.id,
      provider: this.provider,
      workspaceRoot: spec.workspaceRoot,
      image: spec.image,
      limits: spec.limits,
      networkEnabled: spec.networkEnabled,
      env: spec.env
    }
  }

  async exec(_handle: SandboxHandle, command: string, options: ExecOptions): Promise<ExecResult> {
    this.execCalls.push({ command, options })
    return runResult({ stdout: `${this.provider}:${command}\n` })
  }

  async writeFile(): Promise<void> {}

  async readFile(): Promise<string> {
    return ''
  }

  async destroy(): Promise<void> {}
}

export function argValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  return index === -1 ? undefined : args[index + 1]
}
