import type { ToolDefinition } from '@shared/types'
import type { AgentAction, AgentToolResult } from '@shared/agent'
import type { ToolExecutor, ToolExecOptions } from '@core/agent/tools'
import type { ToolGroup } from './toolset'
import {
  DEFAULT_WORKFLOW_LIMITS,
  runWorkflow,
  validateWorkflow,
  type WorkflowLimits,
  type WorkflowStep
} from '@core/agent/workflow'


/**
 * `workflow` (T15): a plan of child runs as data.
 *
 * No code is evaluated: the model sends steps with dependencies, the engine runs them with a per-step budget and a
 * parallel ceiling, and reports one line per step. A refused plan (cycle, unknown dependency) never starts a child.
 */
export const workflowTool: ToolDefinition = {
  name: 'workflow',
  description:
    'Run a plan of child agents: steps with ids, tasks and dependsOn. Independent steps run in parallel (bounded); a dependent step receives its dependencies answers; a failed step skips its dependents.',
  parameters: {
    type: 'object',
    properties: {
      steps: {
        type: 'array',
        description: 'The plan, in any order (dependencies decide execution order)',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            task: { type: 'string' },
            dependsOn: { type: 'array', items: { type: 'string' } }
          },
          required: ['id', 'task'],
          additionalProperties: false
        }
      }
    },
    required: ['steps'],
    additionalProperties: false
  }
}

/** One child run: the same shape `workflow.ts` consumes, so any sub-agent runner satisfies it. */
export type WorkflowSpawn = (
  input: { task: string; maxSteps: number },
  signal: AbortSignal
) => Promise<{ ok: boolean; answer: string; error?: string }>

export interface WorkflowToolDeps {
  /** The same child-run function the `subagent` tool uses. */
  spawn: WorkflowSpawn
  limits?: WorkflowLimits
}

export class WorkflowToolExecutor implements ToolExecutor {
  constructor(private readonly deps: WorkflowToolDeps) {}

  async execute(action: AgentAction, options: ToolExecOptions = {}): Promise<AgentToolResult> {
    const startedAt = Date.now()
    const base = { actionId: action.id, name: action.name, attempts: 1 }
    const limits = this.deps.limits ?? DEFAULT_WORKFLOW_LIMITS
    if (action.name !== 'workflow') {
      return { ...base, ok: false, output: '', error: `Unknown tool "${action.name}"`, code: 'unknown_tool', durationMs: 0 }
    }
    if (!action.valid) {
      return {
        ...base,
        ok: false,
        output: '',
        error: 'workflow received malformed arguments',
        code: 'invalid_arguments',
        durationMs: Date.now() - startedAt
      }
    }

    const validation = validateWorkflow(action.arguments.steps, limits)
    if (!validation.ok) {
      return {
        ...base,
        ok: false,
        output: '',
        error: validation.error ?? 'workflow refused the plan',
        code: 'invalid_arguments',
        durationMs: Date.now() - startedAt
      }
    }

    const result = await runWorkflow(validation.steps as WorkflowStep[], {
      run: (input, signal) => this.deps.spawn(input, signal),
      signal: options.signal ?? new AbortController().signal,
      limits
    })

    const lines = result.steps.map(
      (step) => `${step.status === 'done' ? '✓' : step.status === 'failed' ? '✗' : '–'} ${step.id}: ${step.status}${step.error ? ` — ${step.error}` : ''}`
    )
    return {
      ...base,
      ok: result.ok,
      output: lines.join('\n'),
      ...(result.ok ? {} : { error: 'one or more workflow steps did not finish' }),
      code: result.ok ? undefined : 'remote_error',
      attempts: 1,
      durationMs: Date.now() - startedAt
    }
  }
}

export function createWorkflowToolGroup(deps: WorkflowToolDeps): ToolGroup {
  return {
    definitions: [workflowTool],
    executor: new WorkflowToolExecutor(deps),
    hint:
      'برای چند کار وابسته از workflow استفاده کن: هر گام یک اجرای مستقل است و گام وابسته پاسخ گام قبلی را می‌گیرد.'
  }
}
