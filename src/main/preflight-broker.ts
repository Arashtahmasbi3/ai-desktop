import type { AgentAction } from '@shared/agent'
import type { AgentEvent } from '@shared/ui'
import {
  PREFLIGHT_OVERRIDE_TIMEOUT_MS,
  type PreflightChoice,
  type PreflightPromptTier,
  type PreflightRequestView
} from '@shared/preflight'
import type { PreflightCheck } from '@core/agent/preflight'
import { buildPreflightOptions, canRetryPreflight, extractPreflightReason } from '@core/agent/preflight-override'

/** Extra context the caller attaches to a preflight prompt. */
export interface PreflightRequestContext {
  tier: PreflightPromptTier
  checks: PreflightCheck[]
  command?: string
  path?: string
  server?: string
  workingDirectory?: string
  /** Critical retries already used (0-based). */
  attempt?: number
}

export interface PreflightBrokerOptions {
  emit: (event: AgentEvent) => void
  timeoutMs?: number
  now?: () => number
}

/**
 * Bridges the orchestrator's preflight override to the renderer: emits a
 * `preflight:request` event and resolves with the user's choice. If nobody
 * answers before the timeout the action is cancelled (fail closed), mirroring
 * {@link ApprovalBroker} and {@link PlanBroker}.
 */
export class PreflightBroker {
  private readonly emit: (event: AgentEvent) => void
  private readonly timeoutMs: number
  private readonly now: () => number
  private readonly pending = new Map<string, (choice: PreflightChoice) => void>()
  private counter = 0

  constructor(options: PreflightBrokerOptions) {
    this.emit = options.emit
    this.timeoutMs = options.timeoutMs ?? PREFLIGHT_OVERRIDE_TIMEOUT_MS
    this.now = options.now ?? (() => Date.now())
  }

  /** Ask the renderer how to handle a preflight block. Resolves cancelled on timeout. */
  request(runId: string, action: AgentAction, context: PreflightRequestContext): Promise<PreflightChoice> {
    const id = `preflight-${++this.counter}`
    const args = action.arguments
    const command = context.command ?? (typeof args.command === 'string' ? args.command : undefined)
    const path = context.path ?? (typeof args.path === 'string' ? args.path : undefined)
    const request: PreflightRequestView = {
      id,
      runId,
      tool: action.name,
      tier: context.tier,
      reason: extractPreflightReason(context.checks),
      checks: context.checks,
      options: buildPreflightOptions(context.tier).filter(
        (option) => option.id !== 'retry' || canRetryPreflight(context.attempt ?? 0)
      ),
      timeoutMs: this.timeoutMs,
      ...(command !== undefined ? { command } : {}),
      ...(path !== undefined ? { path } : {}),
      ...(context.server ? { server: context.server } : {}),
      ...(context.workingDirectory ? { workingDirectory: context.workingDirectory } : {}),
      ...(context.attempt !== undefined ? { attempt: context.attempt } : {})
    }
    return new Promise<PreflightChoice>((resolve) => {
      const timer = setTimeout(() => this.resolve(id, 'cancel'), this.timeoutMs)
      timer.unref?.()
      this.pending.set(id, (choice) => {
        clearTimeout(timer)
        resolve(choice)
      })
      this.emit({ type: 'preflight:request', request })
    })
  }

  /** Called from IPC when the user answers. Returns whether a request matched. */
  resolve(id: string, choice: PreflightChoice): boolean {
    const settle = this.pending.get(id)
    if (!settle) return false
    this.pending.delete(id)
    this.emit({ type: 'preflight:resolved', id, choice, at: this.now() })
    settle(choice)
    return true
  }

  /** Cancel every outstanding request (e.g. the run was aborted). */
  cancelAll(): void {
    for (const id of [...this.pending.keys()]) this.resolve(id, 'cancel')
  }

  pendingCount(): number {
    return this.pending.size
  }
}
