import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

/**
 * The transport seam (F0-2).
 *
 * Everything above this line speaks JSON-RPC and knows nothing about processes, pipes or newlines; everything
 * below it knows nothing about tools. That split is what makes the protocol testable without spawning a real
 * server: the tests hand `McpClient` an in-memory transport and assert the bytes it would have written.
 */
export interface McpTransport {
  /** Send a request and resolve with its result; rejects with the server's `error` when it reports one. */
  request(method: string, params?: unknown): Promise<unknown>
  /** Send a notification (no reply expected). */
  notify(method: string, params?: unknown): Promise<void>
  close(): Promise<void>
  /** Anything the server wrote to stderr, for diagnostics. Never thrown. */
  stderr(): string
}

export class McpTransportError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly data?: unknown
  ) {
    super(message)
    this.name = 'McpTransportError'
  }
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

/**
 * Newline-delimited JSON over a child process's stdio — the transport the MCP spec defines for local servers.
 *
 * Two details that are easy to get wrong and matter in practice: a write may be split across chunks, so stdout is
 * buffered until a newline arrives; and a server that exits mid-request must reject every pending call rather than
 * leaving the run hanging forever.
 */
export class StdioTransport implements McpTransport {
  private readonly pending = new Map<number, Pending>()
  private readonly errors: string[] = []
  private buffer = ''
  private nextId = 1
  private closed = false

  constructor(
    command: string,
    args: readonly string[],
    options: { env?: Record<string, string>; cwd?: string; timeoutMs?: number } = {}
  ) {
    this.child = spawn(command, [...args], {
      env: { ...process.env, ...(options.env ?? {}) },
      ...(options.cwd ? { cwd: options.cwd } : {}),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })

    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', (chunk: string) => this.onData(chunk))
    this.child.stderr.setEncoding('utf8')
    this.child.stderr.on('data', (chunk: string) => {
      // Keep a bounded tail: a chatty server must not grow the app's memory.
      this.errors.push(chunk)
      if (this.errors.length > 200) this.errors.shift()
    })
    this.child.on('error', (error) => this.failAll(error))
    this.child.on('exit', (code, signal) => {
      this.closed = true
      this.failAll(
        new McpTransportError(
          `MCP server exited (${signal ?? `code ${code ?? 'unknown'}`}) before answering`
        )
      )
    })

    const timeoutMs = options.timeoutMs ?? 20_000
    this.timeout = setTimeout(() => {
      if (this.pending.size > 0) this.failAll(new McpTransportError('MCP server did not answer in time'))
    }, timeoutMs)
    this.timeout.unref?.()
  }

  private readonly child: ChildProcessWithoutNullStreams
  private readonly timeout: ReturnType<typeof setTimeout>

  private onData(chunk: string): void {
    this.buffer += chunk
    let newline = this.buffer.indexOf('\n')
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      if (line !== '') this.onLine(line)
      newline = this.buffer.indexOf('\n')
    }
  }

  private onLine(line: string): void {
    let message: {
      id?: number
      result?: unknown
      error?: { code?: number; message?: string; data?: unknown }
      method?: string
    }
    try {
      message = JSON.parse(line) as typeof message
    } catch {
      // A server may print banners to stdout before the protocol starts; that is not fatal.
      return
    }
    if (typeof message.id !== 'number') return
    const waiting = this.pending.get(message.id)
    if (waiting === undefined) return
    this.pending.delete(message.id)
    if (message.error !== undefined) {
      waiting.reject(
        new McpTransportError(
          message.error.message ?? 'MCP server returned an error',
          message.error.code,
          message.error.data
        )
      )
      return
    }
    waiting.resolve(message.result)
  }

  private failAll(error: Error): void {
    for (const [, waiting] of this.pending) waiting.reject(error)
    this.pending.clear()
  }

  private write(payload: unknown): void {
    if (this.closed) throw new McpTransportError('MCP server is not running')
    this.child.stdin.write(`${JSON.stringify(payload)}\n`)
  }

  request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId
    this.nextId += 1
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try {
        this.write({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })
      } catch (error) {
        this.pending.delete(id)
        reject(error instanceof Error ? error : new McpTransportError(String(error)))
      }
    })
  }

  notify(method: string, params?: unknown): Promise<void> {
    try {
      this.write({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) })
      return Promise.resolve()
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new McpTransportError(String(error)))
    }
  }

  async close(): Promise<void> {
    clearTimeout(this.timeout)
    if (this.closed) return
    this.closed = true
    this.failAll(new McpTransportError('MCP server closed'))
    // A child that ignores stdin closing gets a moment, then a signal: a hung server must not hang the app.
    this.child.stdin.end()
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.child.kill('SIGTERM')
        resolve()
      }, 1500)
      timer.unref?.()
      this.child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  stderr(): string {
    return this.errors.join('').trim()
  }
}
