/**
 * Sub-agent policy (T14, part 1).
 *
 * A child run is only worth having if it cannot outgrow its parent: it gets a step budget, it may not spawn another
 * sub-agent, it shares the parent's abort signal, and only a small number of them may be in flight at once. Those four
 * rules are pure functions here — no provider, no sandbox — so they can be tested without a run and cannot drift when the
 * wiring changes.
 */
export interface SubagentLimits {
  /** Hard ceiling on child steps, regardless of what the model asked for. */
  maxSteps: number
  /** How deep nesting may go. v1 allows one level: a child may not spawn a child. */
  maxDepth: number
  /** Children running at the same time. */
  maxConcurrent: number
  /** Default when the model does not ask for a number. */
  defaultSteps: number
}

export const DEFAULT_SUBAGENT_LIMITS: SubagentLimits = {
  maxSteps: 12,
  maxDepth: 1,
  maxConcurrent: 2,
  defaultSteps: 6
}

export interface SubagentOutcome {
  ok: boolean
  answer: string
  steps: number
  usageTokens: number
  error?: string
}

export interface SubagentRequest {
  task: string
  maxSteps: number
}

/** The function the wiring supplies: run a child to completion. */
export type SubagentRunner = (request: SubagentRequest, signal: AbortSignal) => Promise<SubagentOutcome>

export interface RunSubagentInput {
  task: string
  /** The child's depth: the parent's depth plus one. */
  depth: number
  /** What the model asked for; clamped. */
  requestedSteps?: number
  runner: SubagentRunner
  limiter: SubagentLimiter
  signal: AbortSignal
  limits?: SubagentLimits
}

export class SubagentLimiter {
  private active = 0
  private readonly queue: Array<() => void> = []

  constructor(private readonly max: number) {}

  get inFlight(): number {
    return this.active
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => this.queue.push(resolve))
    }
    this.active += 1
    try {
      return await task()
    } finally {
      this.active -= 1
      this.queue.shift()?.()
    }
  }
}

export function clampSteps(requested: number | undefined, limits: SubagentLimits = DEFAULT_SUBAGENT_LIMITS): number {
  const value = Math.floor(Number(requested ?? limits.defaultSteps))
  if (!Number.isFinite(value) || value < 1) return 1
  return Math.min(value, limits.maxSteps)
}

export async function runSubagent(input: RunSubagentInput): Promise<SubagentOutcome> {
  const limits = input.limits ?? DEFAULT_SUBAGENT_LIMITS
  const refused = (error: string): SubagentOutcome => ({ ok: false, answer: '', steps: 0, usageTokens: 0, error })

  if (input.depth > limits.maxDepth) {
    return refused('subagent: nesting is limited to one level; a child may not spawn another child.')
  }
  if (input.task.trim() === '') {
    return refused('subagent: the task is empty.')
  }
  if (input.signal.aborted) {
    return refused('subagent: the parent run was already cancelled.')
  }

  return input.limiter.run(async () => {
    // The child gets its own controller so a parent abort stops it mid-step, not just before it starts.
    const child = new AbortController()
    const onAbort = (): void => child.abort()
    input.signal.addEventListener('abort', onAbort, { once: true })
    try {
      const outcome = await input.runner(
        { task: input.task.trim(), maxSteps: clampSteps(input.requestedSteps, limits) },
        child.signal
      )
      return {
        ok: outcome.ok,
        answer: outcome.answer,
        steps: outcome.steps,
        usageTokens: outcome.usageTokens,
        ...(outcome.error ? { error: outcome.error } : {})
      }
    } catch (error) {
      return refused(error instanceof Error ? error.message : String(error))
    } finally {
      input.signal.removeEventListener('abort', onAbort)
    }
  })
}
