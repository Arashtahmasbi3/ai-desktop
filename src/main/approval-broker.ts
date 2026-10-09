import type { AgentAction } from '@shared/agent'
import type { AgentEvent, ApprovalRequest } from '@shared/ui'

export const DEFAULT_APPROVAL_TIMEOUT_MS = 2 * 60 * 1000

export interface ApprovalBrokerOptions {
  emit: (event: AgentEvent) => void
  timeoutMs?: number
}

/** A short, human-readable description of what an action is about to do. */
export function summarizeAction(action: AgentAction): string {
  const args = action.arguments
  switch (action.name) {
    case 'run_command':
    case 'remote_shell':
      return `Run: ${String(args.command ?? '').slice(0, 200)}`
    case 'write_file':
    case 'remote_write_file':
      return `Write ${String(args.path ?? '')} (${String(args.content ?? '').length} chars)`
    default: {
      const first = Object.entries(args)
        .map(([key, value]) => `${key}=${String(value).slice(0, 60)}`)
        .join(', ')
      return `${action.name}${first ? ` (${first})` : ''}`
    }
  }
}

/**
 * Bridges an orchestrator's synchronous approval gate to the renderer: emits an
 * `approval:request` event and resolves when the user answers. If nobody answers
 * before the timeout the action is denied (fail closed).
 */
export class ApprovalBroker {
  private readonly emit: (event: AgentEvent) => void
  private readonly timeoutMs: number
  private readonly pending = new Map<string, (approved: boolean) => void>()
  private counter = 0

  constructor(options: ApprovalBrokerOptions) {
    this.emit = options.emit
    this.timeoutMs = options.timeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS
  }

  /** Ask the renderer to approve an action. Resolves false on timeout. */
  request(runId: string, action: AgentAction): Promise<boolean> {
    const id = `approval-${++this.counter}`
    const request: ApprovalRequest = {
      id,
      runId,
      tool: action.name,
      summary: summarizeAction(action),
      arguments: action.arguments
    }
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => this.resolve(id, false), this.timeoutMs)
      timer.unref?.()
      this.pending.set(id, (approved) => {
        clearTimeout(timer)
        resolve(approved)
      })
      this.emit({ type: 'approval:request', request })
    })
  }

  /** Called from IPC when the user answers. Returns whether a request matched. */
  resolve(id: string, approved: boolean): boolean {
    const settle = this.pending.get(id)
    if (!settle) return false
    this.pending.delete(id)
    settle(approved)
    return true
  }

  /** Deny every outstanding request (e.g. the run was aborted). */
  cancelAll(): void {
    for (const id of [...this.pending.keys()]) this.resolve(id, false)
  }

  pendingCount(): number {
    return this.pending.size
  }
}
