/**
 * Tool execution: the approval gate, the bounded retry, and the pre-write snapshot
 * (F0-4 extraction).
 *
 * The order is the contract: approval is asked before anything runs, a refusal never
 * reaches the executor, and a retry re-runs the same action with the same signal.
 */
import type { SandboxManager } from '@shared/sandbox'
import type { AgentAction, AgentRunOptions, AgentToolResult, ToolRecoveryInfo } from '@shared/agent'
import type { ToolResultView } from '@shared/ui'
import { sleep } from '@core/llm-adapters'
import type { ErrorRecovery } from './error-recovery'
import { buildToolDetail, toolDetailLogFields } from './tool-detail'
import type { OrchestratorLog } from './orchestrator-log'
import type { ToolExecutor } from './tools'

/** What execution needs from the orchestrator, passed explicitly (no class state). */
export interface ExecutionDeps {
  recovery: ErrorRecovery
  log: OrchestratorLog
  approvalGate?: (action: AgentAction) => Promise<boolean>
  onToolResult?: (result: ToolResultView) => void
}

/** Ask the approval gate (when present), then execute or block the action. */
export async function guardedExecute(
  deps: ExecutionDeps,
  executor: ToolExecutor,
  action: AgentAction,
  runId: string,
  step: number,
  options: AgentRunOptions,
  onDecision?: (tool: string, approved: boolean) => void
): Promise<AgentToolResult> {
  const approvalGate = deps.approvalGate
  if (approvalGate) {
    let allowed = false
    try {
      allowed = await approvalGate(action)
    } catch {
      allowed = false
    }
    onDecision?.(action.name, allowed)
    if (!allowed) {
      deps.log('warn', 'action.denied', runId, { step, tool: action.name })
      return {
        actionId: action.id,
        name: action.name,
        ok: false,
        output: '',
        error: `Action "${action.name}" was not approved by the user.`,
        code: 'blocked',
        attempts: 1,
        durationMs: 0
      }
    }
  }
  return executeAction(deps, executor, action, runId, step, options)
}

/** Reads the pre-write contents of a `write_file` target. */
export async function snapshotBefore(
  sandbox: SandboxManager,
  action: AgentAction,
  sandboxId: string | null
): Promise<string | null> {
  if (!sandboxId || action.name !== 'write_file' || !action.valid) return null
  const path = action.arguments.path
  if (typeof path !== 'string') return null
  try {
    return await sandbox.readFile(sandboxId, path)
  } catch (error) {
    // v2.6.5: only "the file does not exist" means a new file. Any other read
    // failure used to return '' as well, so an existing file was presented as
    // brand new and the review diff showed every line as an addition.
    const code = (error as NodeJS.ErrnoException).code
    const message = error instanceof Error ? error.message : String(error)
    if (code === 'ENOENT' || /no such file|not found|does not exist/i.test(message)) return ''
    return null
  }
}

export async function executeAction(
  deps: ExecutionDeps,
  executor: ToolExecutor,
  action: AgentAction,
  runId: string,
  step: number,
  options: AgentRunOptions
): Promise<AgentToolResult> {
  let attempt = 1
  let retried = false
  let result = await executor.execute(action, {
    ...(options.signal ? { signal: options.signal } : {})
  })

  while (!result.ok && !options.signal?.aborted) {
    const plan = deps.recovery.planToolRetry(result.code, attempt)
    if (!plan.retry) break
    retried = true
    deps.log('warn', 'recovery.action_retry', runId, {
      step,
      tool: action.name,
      attempt,
      delayMs: plan.delayMs,
      code: result.code,
      decision: 'retry',
      ...(plan.guidance ? { message: plan.guidance } : {})
    })
    await sleep(plan.delayMs, options.signal)
    // v2.6.5: `sleep` resolves immediately once the signal is aborted, so the
    // tool used to run one more time after the user pressed Stop.
    if (options.signal?.aborted) break
    attempt += 1
    const retriedResult = await executor.execute(action, {
      ...(options.signal ? { signal: options.signal } : {})
    })
    retriedResult.attempts = attempt
    result = retriedResult
  }

  // v2.5.2: record what the run chose to do after a failure so the chat can
  // explain it. Omitted for a clean first-try success.
  const recovery: ToolRecoveryInfo | undefined = !result.ok
    ? {
        decision: retried ? 'retry' : 'stop',
        attempts: attempt,
        recovered: false,
        ...(result.code ? { code: result.code } : {})
      }
    : attempt > 1
      ? { decision: 'retry', attempts: attempt, recovered: true }
      : undefined
  if (recovery) result = { ...result, recovery }

  const detail = buildToolDetail(result)
  deps.log(result.ok ? 'info' : 'error', result.ok ? 'action.ok' : 'action.error', runId, {
    step,
    tool: action.name,
    code: result.code,
    attempts: result.attempts,
    durationMs: result.durationMs,
    // Short technical cause, so the existing `message`-based card keeps working.
    ...(detail.error !== undefined ? { message: detail.error } : {}),
    ...toolDetailLogFields(detail)
  })
  deps.onToolResult?.({ ...detail, step })
  return result
}
