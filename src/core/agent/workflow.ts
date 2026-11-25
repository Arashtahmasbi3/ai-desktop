import { SubagentLimiter } from './subagent'

/**
 * Workflows (T15): a declared plan of child runs, not arbitrary code.
 *
 * The checklist's item was "run a JS workflow", and a workflow that is `eval`-ed in the main process is a security hole
 * with a progress bar. So the script is *data*: steps with ids, tasks and dependencies. The engine runs every step whose
 * dependencies are done, at most N at a time, hands each one the answers it depends on, and skips a step whose
 * dependency failed instead of running it on garbage.
 *
 * Bounds mirror the sub-agent rules: a step budget per child, a cap on steps, and the parent's abort signal.
 */
export interface WorkflowStep {
  id: string
  task: string
  /** Step ids that must finish before this one runs. */
  dependsOn?: string[]
}

export interface WorkflowLimits {
  maxSteps: number
  maxParallel: number
  stepBudget: number
}

export const DEFAULT_WORKFLOW_LIMITS: WorkflowLimits = {
  maxSteps: 20,
  maxParallel: 2,
  stepBudget: 6
}

export interface WorkflowDeps {
  /** Runs one step; the same injected runner the `subagent` tool uses. */
  run: (
    input: { task: string; maxSteps: number },
    signal: AbortSignal
  ) => Promise<{ ok: boolean; answer: string; error?: string }>
  signal: AbortSignal
  limits?: WorkflowLimits
}

export interface WorkflowStepResult {
  id: string
  status: 'done' | 'failed' | 'skipped'
  answer: string
  error?: string
}

export interface WorkflowResult {
  ok: boolean
  steps: WorkflowStepResult[]
}

/** Refuses a plan the engine cannot run; returns the steps in declaration order. */
export function validateWorkflow(
  steps: unknown,
  limits: WorkflowLimits = DEFAULT_WORKFLOW_LIMITS
): { ok: boolean; steps: WorkflowStep[]; error?: string } {
  if (!Array.isArray(steps) || steps.length === 0) {
    return { ok: false, steps: [], error: 'workflow needs a non-empty "steps" array.' }
  }
  if (steps.length > limits.maxSteps) {
    return { ok: false, steps: [], error: `workflow accepts at most ${limits.maxSteps} steps.` }
  }

  const parsed: WorkflowStep[] = []
  const ids = new Set<string>()
  for (const [index, entry] of steps.entries()) {
    if (typeof entry !== 'object' || entry === null) {
      return { ok: false, steps: [], error: `workflow step ${index + 1} is not an object.` }
    }
    const record = entry as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id.trim() : ''
    const task = typeof record.task === 'string' ? record.task.trim() : ''
    if (id === '' || task === '') {
      return { ok: false, steps: [], error: `workflow step ${index + 1} needs a non-empty id and task.` }
    }
    if (ids.has(id)) {
      return { ok: false, steps: [], error: `workflow has a duplicate step id "${id}".` }
    }
    ids.add(id)
    const dependsOn = Array.isArray(record.dependsOn)
      ? record.dependsOn.filter((value): value is string => typeof value === 'string')
      : []
    parsed.push({ id, task, ...(dependsOn.length > 0 ? { dependsOn } : {}) })
  }

  for (const step of parsed) {
    for (const dependency of step.dependsOn ?? []) {
      if (!ids.has(dependency)) {
        return { ok: false, steps: [], error: `workflow step "${step.id}" depends on unknown step "${dependency}".` }
      }
      if (dependency === step.id) {
        return { ok: false, steps: [], error: `workflow step "${step.id}" depends on itself.` }
      }
    }
  }

  if (hasCycle(parsed)) {
    return { ok: false, steps: [], error: 'workflow has a dependency cycle.' }
  }
  return { ok: true, steps: parsed }
}

function hasCycle(steps: WorkflowStep[]): boolean {
  const byId = new Map(steps.map((step) => [step.id, step]))
  const visiting = new Set<string>()
  const done = new Set<string>()

  const visit = (id: string): boolean => {
    if (done.has(id)) return false
    if (visiting.has(id)) return true
    visiting.add(id)
    for (const dependency of byId.get(id)?.dependsOn ?? []) {
      if (visit(dependency)) return true
    }
    visiting.delete(id)
    done.add(id)
    return false
  }

  return steps.some((step) => visit(step.id))
}

/**
 * Run a plan. Independent ready steps run together, up to `maxParallel`; a step whose dependency failed is skipped, so a
 * failure stops the branch that depended on it and nothing else.
 */
export async function runWorkflow(steps: WorkflowStep[], deps: WorkflowDeps): Promise<WorkflowResult> {
  const limits = deps.limits ?? DEFAULT_WORKFLOW_LIMITS
  const limiter = new SubagentLimiter(limits.maxParallel)
  const results = new Map<string, WorkflowStepResult>()
  const started = new Set<string>()
  const active = new Set<Promise<void>>()

  const execute = async (step: WorkflowStep): Promise<void> => {
    const failedDependency = (step.dependsOn ?? []).find((dependency) => results.get(dependency)?.status !== 'done')
    if (failedDependency !== undefined) {
      results.set(step.id, {
        id: step.id,
        status: 'skipped',
        answer: '',
        error: `skipped because "${failedDependency}" did not finish`
      })
      return
    }
    if (deps.signal.aborted) {
      results.set(step.id, { id: step.id, status: 'skipped', answer: '', error: 'the parent run was cancelled' })
      return
    }

    const context = (step.dependsOn ?? [])
      .map((dependency) => `[${dependency}]\n${results.get(dependency)?.answer ?? ''}`)
      .join('\n\n')
    const task = context === '' ? step.task : `${step.task}\n\nContext from previous steps:\n${context}`

    try {
      const outcome = await limiter.run(() =>
        deps.run({ task, maxSteps: limits.stepBudget }, deps.signal)
      )
      results.set(step.id, {
        id: step.id,
        status: outcome.ok ? 'done' : 'failed',
        answer: outcome.answer,
        ...(outcome.ok ? {} : { error: outcome.error ?? 'step failed' })
      })
    } catch (error) {
      results.set(step.id, {
        id: step.id,
        status: 'failed',
        answer: '',
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  for (;;) {
    for (const step of steps) {
      if (started.has(step.id)) continue
      if (!(step.dependsOn ?? []).every((dependency) => results.has(dependency))) continue
      started.add(step.id)
      const promise = execute(step).finally(() => {
        active.delete(promise)
      })
      active.add(promise)
    }

    if (active.size === 0) break
    await Promise.race(active)
  }

  return {
    ok: steps.every((step) => results.get(step.id)?.status === 'done'),
    steps: steps.map((step) => results.get(step.id)!).filter(Boolean)
  }
}
