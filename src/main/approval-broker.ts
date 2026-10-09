import type { ApprovalHistoryEntry, ApprovalOutcome } from '@shared/approval'
import type { AgentAction } from '@shared/agent'
import type { AgentEvent, ApprovalRequest } from '@shared/ui'
import { classifyAction, isDenyListedAction } from '@core/agent/approval'

export const DEFAULT_APPROVAL_TIMEOUT_MS = 2 * 60 * 1000

/** Extra context the caller can attach to an approval prompt. */
export interface ApprovalContext {
  workingDirectory?: string
  server?: string
  /** Session id used when the user chooses "auto-approve for this session". */
  sessionId?: string
}

export interface ApprovalBrokerOptions {
  emit: (event: AgentEvent) => void
  timeoutMs?: number
  /** How many resolved approvals to keep for the History list. */
  historyLimit?: number
  now?: () => number
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

/** The command/path to show large in the dialog. */
export function actionPreview(action: AgentAction): string {
  const args = action.arguments
  if (typeof args.command === 'string' && args.command.trim() !== '') return args.command
  if (typeof args.path === 'string' && args.path.trim() !== '') return args.path
  return summarizeAction(action)
}

/**
 * Bridges an orchestrator's synchronous approval gate to the renderer: emits an
 * `approval:request` event and resolves when the user answers. If nobody answers
 * before the timeout the action is denied (fail closed).
 */
export class ApprovalBroker {
  private readonly emit: (event: AgentEvent) => void
  private readonly timeoutMs: number
  private readonly historyLimit: number
  private readonly now: () => number
  private readonly pending = new Map<string, (outcome: ApprovalOutcome) => void>()
  private readonly requests = new Map<string, ApprovalRequest>()
  private readonly past: ApprovalHistoryEntry[] = []
  private counter = 0

  constructor(options: ApprovalBrokerOptions) {
    this.emit = options.emit
    this.timeoutMs = options.timeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS
    this.historyLimit = options.historyLimit ?? 50
    this.now = options.now ?? (() => Date.now())
  }

  /** Ask the renderer to approve an action. Resolves denied on timeout. */
  request(
    runId: string,
    action: AgentAction,
    context: ApprovalContext = {}
  ): Promise<ApprovalOutcome> {
    const id = `approval-${++this.counter}`
    const request: ApprovalRequest = {
      id,
      runId,
      tool: action.name,
      summary: summarizeAction(action),
      arguments: action.arguments,
      kind: classifyAction(action),
      preview: actionPreview(action),
      dangerous: isDenyListedAction(action),
      ...(context.workingDirectory ? { workingDirectory: context.workingDirectory } : {}),
      ...(context.server ? { server: context.server } : {})
    }
    return new Promise<ApprovalOutcome>((resolve) => {
      const timer = setTimeout(() => this.resolve(id, false), this.timeoutMs)
      timer.unref?.()
      this.pending.set(id, (outcome) => {
        clearTimeout(timer)
        resolve(outcome)
      })
      this.requests.set(id, request)
      this.emit({ type: 'approval:request', request })
    })
  }

  /** Called from IPC when the user answers. Returns whether a request matched. */
  resolve(id: string, answer: boolean | ApprovalOutcome): boolean {
    const settle = this.pending.get(id)
    if (!settle) return false
    const outcome: ApprovalOutcome =
      typeof answer === 'boolean' ? { approved: answer } : answer
    this.pending.delete(id)
    const request = this.requests.get(id)
    this.requests.delete(id)
    if (request) {
      this.past.unshift({
        id,
        runId: request.runId,
        tool: request.tool,
        summary: request.summary,
        approved: outcome.approved,
        at: this.now()
      })
      if (this.past.length > this.historyLimit) this.past.length = this.historyLimit
    }
    settle(outcome)
    return true
  }

  /** Recent approvals, newest first. */
  history(): ApprovalHistoryEntry[] {
    return [...this.past]
  }

  /** Deny every outstanding request (e.g. the run was aborted). */
  cancelAll(): void {
    for (const id of [...this.pending.keys()]) this.resolve(id, false)
  }

  pendingCount(): number {
    return this.pending.size
  }
}
