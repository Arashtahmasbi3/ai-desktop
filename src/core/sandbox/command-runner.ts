import { spawn, type ChildProcess } from 'node:child_process'

export interface RunOptions {
  cwd?: string
  env?: Record<string, string>
  timeoutMs?: number
  stdin?: string | Uint8Array
  signal?: AbortSignal
  maxOutputBytes?: number
}

export interface RunResult {
  stdout: string
  stderr: string
  exitCode: number
  timedOut: boolean
  durationMs: number
}

/** Injectable process runner — the boundary mocked in tests. */
export interface CommandRunner {
  run(file: string, args: string[], options?: RunOptions): Promise<RunResult>
}

export const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024

function appendCapped(current: string, chunk: Buffer, maxBytes: number): string {
  const remaining = maxBytes - Buffer.byteLength(current, 'utf8')
  if (remaining <= 0) return current
  return current + chunk.subarray(0, remaining).toString('utf8')
}

function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
    } catch {
      /* ignore */
    }
    return
  }
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    try {
      child.kill('SIGKILL')
    } catch {
      /* already gone */
    }
  }
}

/**
 * Runs a command with no shell, capturing stdout/stderr and enforcing a timeout.
 * Timeouts kill the whole process group so child processes (e.g. `sh -c sleep`)
 * cannot hold the pipes open and delay completion.
 */
export class ChildProcessRunner implements CommandRunner {
  run(file: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
    const startedAt = Date.now()
    const maxBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES

    return new Promise<RunResult>((resolvePromise, rejectPromise) => {
      const child = spawn(file, args, {
        cwd: options.cwd,
        env: options.env ? { ...process.env, ...options.env } : process.env,
        windowsHide: true,
        // A detached child becomes a process-group leader on POSIX, so the whole
        // tree can be killed via a negative pid.
        detached: process.platform !== 'win32'
      })

      let stdout = ''
      let stderr = ''
      let timedOut = false
      let settled = false

      const onAbort = (): void => killTree(child)
      const timer =
        options.timeoutMs && options.timeoutMs > 0
          ? setTimeout(() => {
              timedOut = true
              killTree(child)
            }, options.timeoutMs)
          : undefined

      const cleanup = (): void => {
        if (timer) clearTimeout(timer)
        options.signal?.removeEventListener('abort', onAbort)
      }

      if (options.signal) {
        if (options.signal.aborted) killTree(child)
        else options.signal.addEventListener('abort', onAbort, { once: true })
      }

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout = appendCapped(stdout, chunk, maxBytes)
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr = appendCapped(stderr, chunk, maxBytes)
      })

      child.on('error', (error) => {
        if (settled) return
        settled = true
        cleanup()
        rejectPromise(error)
      })

      child.on('close', (code, signal) => {
        if (settled) return
        settled = true
        cleanup()
        resolvePromise({
          stdout,
          stderr,
          exitCode: code ?? (signal ? 128 : timedOut ? 124 : -1),
          timedOut,
          durationMs: Date.now() - startedAt
        })
      })

      if (options.stdin !== undefined && child.stdin) {
        child.stdin.end(options.stdin)
      } else {
        child.stdin?.end()
      }
    })
  }
}
