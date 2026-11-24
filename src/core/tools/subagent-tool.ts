import type { ToolDefinition } from '@shared/types'
import type { AgentAction, AgentToolResult } from '@shared/agent'
import type { ToolExecutor, ToolExecOptions } from '@core/agent/tools'
import type { ToolGroup } from './toolset'
import {
  DEFAULT_SUBAGENT_LIMITS,
  runSubagent,
  type SubagentLimiter,
  type SubagentLimits,
  type SubagentRunner
} from '@core/agent/subagent'

/**
 * `subagent` (T14, part 2): hand a self-contained task to a child run.
 *
 * The bounds live in `core/agent/subagent.ts`; this file is the tool surface. The executor receives a `spawn` function
 * from the wiring, so the tool does not know how a run is built — and the tests do not need a provider to prove the
 * refusals, the step clamp and the abort path.
 */
export const subagentTool: ToolDefinition = {
  name: 'subagent',
  description:
    'Run a self-contained task in a child agent with its own bounded budget, and return its final answer. Use it for a focused side task; it cannot spawn another subagent.',
  parameters: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'The complete, self-contained instruction for the child' },
      max_steps: { type: 'number', description: 'Optional step budget (clamped to the app limit)' }
    },
    required: ['task'],
    additionalProperties: false
  }
}

export interface SubagentToolDeps {
  /** The child's depth; 1 for a child of the main run. */
  depth: number
  spawn: SubagentRunner
  limiter: SubagentLimiter
  limits?: SubagentLimits
}

export class SubagentToolExecutor implements ToolExecutor {
  constructor(private readonly deps: SubagentToolDeps) {}

  async execute(action: AgentAction, options: ToolExecOptions = {}): Promise<AgentToolResult> {
    const startedAt = Date.now()
    const base = { actionId: action.id, name: action.name, attempts: 1 }
    if (action.name !== 'subagent') {
      return { ...base, ok: false, output: '', error: `Unknown tool "${action.name}"`, code: 'unknown_tool', durationMs: 0 }
    }
    if (!action.valid) {
      return {
        ...base,
        ok: false,
        output: '',
        error: 'subagent received malformed arguments',
        code: 'invalid_arguments',
        durationMs: Date.now() - startedAt
      }
    }

    const task = typeof action.arguments.task === 'string' ? action.arguments.task.trim() : ''
    if (task === '') {
      return {
        ...base,
        ok: false,
        output: '',
        error: 'subagent requires a non-empty "task"',
        code: 'invalid_arguments',
        durationMs: Date.now() - startedAt
      }
    }

    const requestedSteps =
      typeof action.arguments.max_steps === 'number' ? action.arguments.max_steps : undefined
    const outcome = await runSubagent({
      task,
      depth: this.deps.depth,
      ...(requestedSteps === undefined ? {} : { requestedSteps }),
      runner: this.deps.spawn,
      limiter: this.deps.limiter,
      signal: options.signal ?? new AbortController().signal,
      ...(this.deps.limits ? { limits: this.deps.limits } : {})
    })

    if (!outcome.ok) {
      return {
        ...base,
        ok: false,
        output: outcome.answer,
        error: outcome.error ?? 'the sub-agent failed',
        code: 'remote_error',
        durationMs: Date.now() - startedAt
      }
    }

    return {
      ...base,
      ok: true,
      output: outcome.answer.trim() === '' ? '(the sub-agent returned no text)' : outcome.answer,
      attempts: 1,
      durationMs: Date.now() - startedAt
    }
  }
}

export function createSubagentToolGroup(deps: SubagentToolDeps): ToolGroup {
  return {
    definitions: [subagentTool],
    executor: new SubagentToolExecutor({ ...deps, limits: deps.limits ?? DEFAULT_SUBAGENT_LIMITS }),
    hint:
      'برای یک کار جانبیِ مستقل از subagent استفاده کن؛ بودجهٔ گامش محدود است و خودش نمی‌تواند subagent بسازد.'
  }
}
