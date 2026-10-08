import { randomUUID } from 'node:crypto'
import type { SshShell } from './backend'

export interface TerminalSessionOptions {
  id?: string
  now?: () => number
  onData?: (sessionId: string, chunk: string) => void
  onClose?: (sessionId: string) => void
}

/**
 * One interactive shell. Keeps its own activity clock so the manager can apply
 * the idle timeout per session, and forwards output to the renderer.
 */
export class TerminalSession {
  readonly id: string
  private readonly shell: SshShell
  private readonly now: () => number
  private readonly onData?: (sessionId: string, chunk: string) => void
  private readonly onClose?: (sessionId: string) => void
  private lastActivity: number

  constructor(shell: SshShell, options: TerminalSessionOptions = {}) {
    this.id = options.id ?? randomUUID()
    this.shell = shell
    this.now = options.now ?? (() => Date.now())
    if (options.onData) this.onData = options.onData
    if (options.onClose) this.onClose = options.onClose
    this.lastActivity = this.now()
    this.shell.onData((chunk) => {
      this.lastActivity = this.now()
      this.onData?.(this.id, chunk)
    })
    this.shell.onClose(() => this.onClose?.(this.id))
  }

  write(data: string): void {
    this.shell.write(data)
    this.lastActivity = this.now()
  }

  resize(cols: number, rows: number): void {
    this.shell.resize(cols, rows)
    this.lastActivity = this.now()
  }

  close(): void {
    this.shell.close()
  }

  isIdle(idleTimeoutMs: number): boolean {
    return this.now() - this.lastActivity >= idleTimeoutMs
  }
}
