/**
 * Turning a project Goal into run context (v2.6.2, Topic 4.3).
 *
 * A run must know which goal it serves so the model can be told what "done"
 * means, and so the run can be linked back to that goal. This module is the
 * single place that decides which goal a run attaches to and how it is described
 * to the model; keeping it out of `AgentService` makes the policy unit-testable.
 */

import { goalProgress, isGoalClosed, type Goal } from '@shared/goal'
import type { GoalStore } from './goal-store'

export interface RunGoalContext {
  /** The goal this run serves, when one was unambiguously selected. */
  goal?: Goal
  /** Ids of competing active goals; non-empty means the user must choose. */
  ambiguousGoalIds: string[]
  /** Prompt fragment describing the goal (or asking the model to clarify). */
  hint?: string
  /** True when the run must not assume a goal and should ask the user. */
  needsInput: boolean
}

/**
 * Resolve the goal a run serves. An explicit request wins; otherwise the
 * project's active goal is used. Several active goals are never guessed between —
 * the run is told to ask instead, so work is not misattributed.
 */
export async function resolveRunGoal(
  store: GoalStore,
  projectId: string,
  requestedGoalId?: string
): Promise<RunGoalContext> {
  if (requestedGoalId) {
    const goal = await store.get(projectId, requestedGoalId)
    // A closed goal accepts no new work; asking is safer than silently attaching.
    if (!goal || isGoalClosed(goal.status)) return { ambiguousGoalIds: [], needsInput: false }
    return { goal, ambiguousGoalIds: [], hint: buildGoalHint(goal), needsInput: false }
  }

  const resolved = await store.resolveGoalId(projectId)
  if (resolved.kind === 'ambiguous') {
    return {
      ambiguousGoalIds: resolved.goalIds,
      needsInput: true,
      hint: buildAmbiguityHint(resolved.goalIds)
    }
  }
  if (resolved.kind === 'none') return { ambiguousGoalIds: [], needsInput: false }

  const goal = await store.get(projectId, resolved.goalId)
  if (!goal) return { ambiguousGoalIds: [], needsInput: false }
  return { goal, ambiguousGoalIds: [], hint: buildGoalHint(goal), needsInput: false }
}

/** The prompt fragment that tells the model what the run is working toward. */
export function buildGoalHint(goal: Goal): string {
  const { met, total } = goalProgress(goal)
  const criteria = goal.criteria.length
    ? goal.criteria.map((criterion) => `- [${criterion.met ? 'x' : ' '}] ${criterion.text}`).join('\n')
    : '- (no criteria recorded)'
  return [
    '[Project goal]',
    `Title: ${goal.title}`,
    'Success criteria:',
    criteria,
    `Progress: ${met}/${total}`,
    'Work toward this goal. Do not claim it is achieved until every criterion is verifiably met; when it is, say so explicitly.'
  ].join('\n')
}

/** The prompt fragment for the "which goal?" case. */
export function buildAmbiguityHint(goalIds: string[]): string {
  return [
    '[Project goals]',
    `This project has ${goalIds.length} active goals (${goalIds.join(', ')}), so none is assumed.`,
    'Before changing anything, ask the user which goal this work belongs to.'
  ].join('\n')
}
