/**
 * The reliability preflight gate, resolved interactively (F0-4 extraction).
 *
 * The fail-closed order is the reason this lives apart from the loop: a check the
 * user did not override still blocks, and `cleanup` records the refusal BEFORE
 * appending its hint (a system message between an assistant turn and its tool
 * results breaks sanitizeToolPairs, which then drops the real results).
 */
import type { AgentAction, AgentToolResult } from '@shared/agent'
import type { PreflightChoice } from '@shared/preflight'
import type { ContextManager } from './context-manager'
import type { OrchestratorLog } from './orchestrator-log'
import { preflightTier, preflightWarnings, type PreflightResult, type PreflightTier } from './preflight'
import {
  canOverrideTier,
  canRetryPreflight,
  extractPreflightReason,
  preflightNeedsChoice,
  PREFLIGHT_CLEANUP_NOTE
} from './preflight-override'
import { formatObservation } from './tool-results'

/** What the gate needs from the orchestrator, passed explicitly. */
export interface PreflightDeps {
  gate?: (action: AgentAction) => Promise<PreflightResult | undefined>
  override?: (
    action: AgentAction,
    result: PreflightResult,
    tier: PreflightTier,
    context: { attempt: number }
  ) => Promise<PreflightChoice>
  retryDelayMs: number
  log: OrchestratorLog
}

/**
 * v2.6.3 T3.2: run the preflight gate for one action and, when it fails,
 * resolve it interactively. Returns:
 * - `ok`        the action may run (passed, warn-only, or a block the user overrode)
 * - `blocked`   the action was refused and recorded; carry on with the next one
 * - `cancelled` the user cancelled; the step must stop
 */
export async function resolvePreflight(
  deps: PreflightDeps,
  action: AgentAction,
  runId: string,
  step: number,
  signal: AbortSignal | undefined,
  context: ContextManager,
  observations: AgentToolResult[]
): Promise<'ok' | 'blocked' | 'cancelled'> {
  const gate = deps.gate
  const override = deps.override
  if (!gate) return 'ok'
  let check: PreflightResult | undefined
  try {
    check = await gate(action)
  } catch {
    check = undefined
  }
  if (!check) return 'ok'

  // v2.6.3 T3.1: surface the tiered result to the UI (the structured log is
  // what AgentService forwards to the renderer's banner).
  let tier = preflightTier(check)
  if (tier === 'ok') return 'ok'
  deps.log(tier === 'warn' ? 'warn' : 'error', 'preflight', runId, {
    step,
    tool: action.name,
    tier,
    blocked: !check.ok,
    checks: check.checks
  })

  if (check.ok) {
    const warnings = preflightWarnings(check)
    if (warnings.length > 0) {
      deps.log('warn', 'preflight.warnings', runId, {
        step,
        tool: action.name,
        checks: warnings.map((entry) => entry.name)
      })
    }
    return 'ok'
  }

  // Without an interactive override (or for a tier that never prompts) a hard
  // block fails closed, exactly as before v2.6.3.
  if (!override || !preflightNeedsChoice(tier)) {
    rejectPreflight(deps.log, action, check, runId, step, context, observations)
    return 'blocked'
  }

  let attempt = 0
  for (;;) {
    const choice = await requestPreflightChoice(override, action, check, tier, attempt)
    if (choice === 'proceed' && canOverrideTier(tier)) {
      deps.log('warn', 'preflight.override', runId, {
        step,
        tool: action.name,
        tier,
        reason: extractPreflightReason(check.checks)
      })
      return 'ok'
    }
    if (choice === 'retry' && tier === 'critical' && canRetryPreflight(attempt)) {
      attempt += 1
      await delay(deps.retryDelayMs, signal)
      const recheck = await gate(action).catch(() => undefined)
      if (!recheck) return 'ok'
      tier = preflightTier(recheck)
      if (tier === 'ok') return 'ok'
      if (recheck.ok) return 'ok'
      check = recheck
      continue
    }
    if (choice === 'cleanup') {
      deps.log('warn', 'preflight.cleanup', runId, { step, tool: action.name, tier })
      // v2.6.5: append the observation FIRST, then the hint. A system message
      // between the assistant turn and its tool results breaks the contiguous
      // run that `sanitizeToolPairs` consumes, so the real results were treated
      // as orphans and silently replaced with "[no tool result was recorded]".
      rejectPreflight(deps.log, action, check, runId, step, context, observations)
      context.appendHint(PREFLIGHT_CLEANUP_NOTE)
      return 'blocked'
    }
    // `cancel`, and any choice the tier does not allow, stops the step.
    deps.log('warn', 'preflight.cancelled', runId, {
      step,
      tool: action.name,
      tier,
      reason: extractPreflightReason(check.checks)
    })
    return 'cancelled'
  }
}

/** Ask the override callback, failing closed on any error. */
async function requestPreflightChoice(
  override: NonNullable<PreflightDeps['override']>,
  action: AgentAction,
  result: PreflightResult,
  tier: PreflightTier,
  attempt: number
): Promise<PreflightChoice> {
  try {
    return (await override!(action, result, tier, { attempt })) ?? 'cancel'
  } catch {
    return 'cancel'
  }
}

/** Record a hard block as an observation, so the model sees the refusal. */
function rejectPreflight(
  log: OrchestratorLog,
  action: AgentAction,
  check: PreflightResult,
  runId: string,
  step: number,
  context: ContextManager,
  observations: AgentToolResult[]
): void {
  const failed = check.checks.filter((entry) => entry.status === 'fail')
  const blocked: AgentToolResult = {
    actionId: action.id,
    name: action.name,
    ok: false,
    output: '',
    error: `Preflight failed: ${failed.map((entry) => entry.message).join('; ')}`,
    code: 'blocked',
    attempts: 1,
    durationMs: 0
  }
  log('warn', 'preflight.blocked', runId, {
    step,
    tool: action.name,
    checks: failed.map((entry) => entry.name)
  })
  observations.push(blocked)
  context.appendToolResult({
    toolCallId: action.id,
    name: action.name,
    content: formatObservation(blocked)
  })
}

/** Sleep, waking early (and never throwing) when the run is aborted. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms)
    function done(): void {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    signal?.addEventListener('abort', done, { once: true })
  })
}
