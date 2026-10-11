/**
 * Task Planner (v2.5.7, Task 4.1).
 *
 * Turns a goal into an ordered, tracked plan and executes it step by step,
 * emitting events the UI can render. Everything is injected (`callLLM`,
 * `execute`, `now`, `generateId`) so the loop is fully unit-testable without an
 * LLM or a VPS, matching the existing orchestrator/executor pattern.
 */
import type { AgentToolResult } from '@shared/agent'
import type { PlannedStep, TaskPlan, TaskPlannerEvent, TaskStep } from '@shared/task-plan'
import { generateId } from '@core/llm-adapters/util'
import { checkDenyList } from './deny-list'

/** The goal's active context, supplied by the orchestrator/service. */
export interface RunContext {
  runId: string
  project?: { name: string; path?: string }
  vpsName?: string
  tools?: string[]
}

export type PlanComplexity = 'simple' | 'complex'

/** How the planner decides whether to ask the LLM for a plan. */
export interface TaskPlannerDeps {
  callLLM(prompt: string): Promise<string>
  execute(toolName: string, args: Record<string, unknown>): Promise<AgentToolResult>
  onEvent?(event: TaskPlannerEvent): void
  generateId?(prefix?: string): string
  now?(): number
  /** Overall budget for one `executePlan` call. 0 disables. Default 5 min. */
  planTimeoutMs?: number
  /** Upper bound on steps accepted from the model. Default 7. */
  maxSteps?: number
}

export const DEFAULT_PLAN_TIMEOUT_MS = 5 * 60 * 1000
export const DEFAULT_MAX_PLAN_STEPS = 7

/** Diagnostic / multi-step wording that always warrants an explicit plan. */
const COMPLEX_MARKERS = [
  /\bwhy\b/i,
  /\bdiagnose\b/i,
  /\binvestigate\b/i,
  /\bfix\b/i,
  /\bdebug\b/i,
  /\bdeploy\b/i,
  /\bmigrate\b/i,
  /\bcrash/i,
  /\berror/i,
  /\bfail/i,
  /چرا/,
  /عیب/,
  /دیباگ/,
  /رفع/,
  /خطا/,
  /کرش/,
  /درست\s*کن/,
  /بررسی/
]

/** A request that is answerable without touching a tool. */
const SIMPLE_MARKERS = [
  /^\s*(hi|hello|hey|salam|سلام|درود)\b/i,
  /^\s*(who are you|what is your name|اسمت|کی هستی)/i,
  /^\s*(what project|which project|چه پروژه|کدام پروژه|به چه پروژه)/i
]

/**
 * Decide whether a goal needs a plan. A short question with no action verb is
 * simple; anything diagnostic, multi-clause or long is complex.
 */
export function assessComplexity(goal: string): PlanComplexity {
  const text = goal.trim()
  if (!text) return 'simple'
  if (SIMPLE_MARKERS.some((pattern) => pattern.test(text))) return 'simple'

  const clauses = text.split(/[.;!?؟\n]+/).filter((clause) => clause.trim().length > 0)
  const hasComplexMarker = COMPLEX_MARKERS.some((pattern) => pattern.test(text))

  // Two or more clauses joined by "and"/"then" is a multi-step request.
  const chained = /(\band\b|\bthen\b|\bafter that\b|سپس|بعد از آن|و بعد)/i.test(text)
  if (hasComplexMarker || text.length > 120 || (clauses.length >= 2 && chained)) return 'complex'
  if (clauses.length >= 3) return 'complex'
  return 'simple'
}

/** Pull a JSON object out of an LLM reply that may wrap it in prose/fences. */
export function extractPlanJson(reply: string): unknown {
  const trimmed = reply.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1].trim() : trimmed
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  const slice = start !== -1 && end > start ? candidate.slice(start, end + 1) : candidate
  try {
    return JSON.parse(slice)
  } catch {
    return null
  }
}

/** A step is usable only if it is a concrete description with a tool name. */
function normalizeStep(raw: unknown): PlannedStep | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const description = typeof record.description === 'string' ? record.description.trim() : ''
  const toolName = typeof record.toolName === 'string' ? record.toolName.trim() : ''
  if (!description || !toolName) return null
  const args =
    record.args && typeof record.args === 'object' && !Array.isArray(record.args)
      ? (record.args as Record<string, unknown>)
      : {}
  return { description, toolName, args }
}

/**
 * Builds and executes a plan for a goal. `createPlan` returns a plan whose
 * `status` reflects whether planning is needed; `executePlan` runs it and emits
 * `task:step` / `task:complete` / `task:failed` events.
 */
export class TaskPlanner {
  private readonly now: () => number
  private readonly newId: (prefix?: string) => string
  private readonly maxSteps: number

  constructor(private readonly deps: TaskPlannerDeps) {
    this.now = deps.now ?? (() => Date.now())
    this.newId = deps.generateId ?? generateId
    this.maxSteps = deps.maxSteps ?? DEFAULT_MAX_PLAN_STEPS
  }

  async createPlan(goal: string, context: RunContext): Promise<TaskPlan> {
    const base: TaskPlan = {
      id: this.newId('plan'),
      runId: context.runId,
      goal,
      steps: [],
      status: 'planning',
      createdAt: this.now()
    }

    if (assessComplexity(goal) === 'simple') {
      const done: TaskPlan = { ...base, status: 'completed' }
      this.emit('task:complete', done)
      return done
    }

    const planned = await this.askLLMForPlan(goal, context)
    const steps = planned.map((step, index) => this.toStep(step, index))
    const plan: TaskPlan = { ...base, steps, status: 'planning' }
    this.emit('task:plan', plan)
    return plan
  }

  private async askLLMForPlan(goal: string, context: RunContext): Promise<PlannedStep[]> {
    const tools = context.tools?.length
      ? context.tools.join(', ')
      : 'remote_shell, remote_read_file, remote_list_dir, diagnose_crash'
    const prompt = `You are a task planner. Break down the goal into 3-${this.maxSteps} concrete steps.

Goal: ${goal}

Context:
- Project: ${context.project?.name ?? 'unknown'}
- Path: ${context.project?.path ?? 'unknown'}
- VPS: ${context.vpsName ?? 'none'}
- Available tools: ${tools}

Output JSON only:
{
  "steps": [
    { "description": "...", "toolName": "...", "args": {} }
  ]
}

Rules:
- Each step concrete and executable
- If a step may fail, add an alternative approach as a later step
- No dangerous commands (rm -rf, mkfs, sudo)
- Prefer read-only first

Plan:`

    let reply: string
    try {
      reply = await this.deps.callLLM(prompt)
    } catch {
      return []
    }
    const parsed = extractPlanJson(reply)
    const rawSteps =
      parsed && typeof parsed === 'object' && Array.isArray((parsed as { steps?: unknown }).steps)
        ? ((parsed as { steps: unknown[] }).steps)
        : []
    return rawSteps
      .map((step) => normalizeStep(step))
      .filter((step): step is PlannedStep => step !== null)
      .slice(0, this.maxSteps)
  }

  private toStep(planned: PlannedStep, index: number): TaskStep {
    const args = planned.args ?? {}
    // A plan must never carry a denied command; drop the payload so the executor
    // cannot run it, and leave a note explaining why.
    const denied = checkDenyList(JSON.stringify(args)).blocked
    return {
      id: this.newId('step'),
      number: index + 1,
      description: planned.description,
      toolName: planned.toolName,
      args: denied ? {} : args,
      status: 'pending',
      ...(denied ? { notes: 'Arguments removed: denied by policy.' } : {})
    }
  }

  /**
   * Execute a plan step by step. On failure the planner asks the model whether
   * to continue, insert an alternative, or stop; it stops automatically once the
   * overall time budget is exceeded.
   */
  async executePlan(plan: TaskPlan, context: RunContext): Promise<TaskPlan> {
    const timeout = this.deps.planTimeoutMs ?? DEFAULT_PLAN_TIMEOUT_MS
    const deadline = timeout > 0 ? this.now() + timeout : Number.POSITIVE_INFINITY

    plan.status = 'executing'
    plan.updatedAt = this.now()

    for (let index = 0; index < plan.steps.length; index += 1) {
      if (this.now() > deadline) {
        plan.status = 'failed'
        plan.updatedAt = this.now()
        this.emit('task:failed', plan)
        return plan
      }

      const step = plan.steps[index]
      if (step.status === 'done') continue

      step.status = 'running'
      plan.updatedAt = this.now()
      this.emit('task:step', plan, step)

      const startedAt = this.now()
      let result: AgentToolResult
      try {
        result = await this.deps.execute(step.toolName, step.args)
      } catch (error) {
        result = {
          actionId: step.id,
          name: step.toolName,
          ok: false,
          output: '',
          error: error instanceof Error ? error.message : String(error),
          attempts: 1,
          durationMs: this.now() - startedAt
        }
      }

      step.result = result
      step.durationMs = this.now() - startedAt
      step.status = result.ok ? 'done' : 'failed'
      if (!result.ok) step.notes = result.error ?? 'step failed'
      plan.updatedAt = this.now()
      this.emit('task:step', plan, step)

      if (!result.ok) {
        const decision = await this.decideNextAction(step, result)
        if (decision === 'stop') {
          plan.status = 'failed'
          plan.updatedAt = this.now()
          this.emit('task:failed', plan)
          return plan
        }
        if (decision === 'alternative') {
          const alternative = await this.generateAlternative(step, result, context)
          if (alternative) {
            plan.steps[index + 1] = alternative
            plan.steps[index + 1].number = index + 2
          }
        }
      }
    }

    plan.status = 'completed'
    plan.updatedAt = this.now()
    this.emit('task:complete', plan)
    return plan
  }

  /** Ask the model whether to continue, try an alternative, or stop. */
  private async decideNextAction(
    step: TaskStep,
    result: AgentToolResult
  ): Promise<'continue' | 'alternative' | 'stop'> {
    const prompt = `Step "${step.description}" failed with: ${result.error ?? result.output}.
Options:
- continue: the next step may still work
- alternative: try a different approach
- stop: no viable path

Decision (one word):`
    let reply: string
    try {
      reply = await this.deps.callLLM(prompt)
    } catch {
      return 'stop'
    }
    const word = reply.trim().toLowerCase()
    if (word.startsWith('continue')) return 'continue'
    if (word.startsWith('alternative')) return 'alternative'
    return 'stop'
  }

  /** Ask the model for one replacement step after a failure. */
  private async generateAlternative(
    step: TaskStep,
    result: AgentToolResult,
    context: RunContext
  ): Promise<TaskStep | null> {
    const tools = context.tools?.length ? context.tools.join(', ') : 'remote_shell, remote_read_file, remote_list_dir, diagnose_crash'
    const prompt = `Step "${step.description}" (tool ${step.toolName}) failed: ${result.error ?? result.output}.
Propose ONE alternative step using a different tool or different arguments.
Available tools: ${tools}
Output JSON only: { "description": "...", "toolName": "...", "args": {} }
Alternative:`
    let reply: string
    try {
      reply = await this.deps.callLLM(prompt)
    } catch {
      return null
    }
    const parsed = extractPlanJson(reply)
    const planned = normalizeStep(parsed)
    if (!planned) return null
    const alternative = this.toStep(planned, step.number)
    alternative.alternativeFor = step.id
    return alternative
  }

  private emit(
    type: TaskPlannerEvent['type'],
    plan: TaskPlan,
    step?: TaskStep
  ): void {
    this.deps.onEvent?.({
      type,
      planId: plan.id,
      plan,
      ...(step ? { step } : {}),
      at: this.now()
    })
  }
}
