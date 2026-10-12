/**
 * Multi-step task planning types (v2.5.7). Shared between main, renderer and
 * core so the plan the agent builds can be rendered and tracked in the UI.
 * Dependency-free and environment-neutral.
 */
import type { AgentToolResult } from './agent'

export type TaskPlanStatus = 'planning' | 'approved' | 'executing' | 'completed' | 'failed'
export type TaskStepStatus = 'pending' | 'running' | 'done' | 'failed'

/** One concrete, executable step of a plan. */
export interface TaskStep {
  id: string
  number: number
  description: string
  toolName: string
  args: Record<string, unknown>
  status: TaskStepStatus
  result?: AgentToolResult
  durationMs?: number
  notes?: string
  /** True when this step was inserted as a retry/alternative for a failed step. */
  alternativeFor?: string
}

export interface TaskPlan {
  id: string
  runId: string
  goal: string
  /** The project Goal this plan was built for, when the run served one (T4.3). */
  goalId?: string
  steps: TaskStep[]
  status: TaskPlanStatus
  createdAt: number
  updatedAt?: number
}

/** What the model returns when asked to produce a plan. */
export interface PlannedStep {
  description: string
  toolName: string
  args?: Record<string, unknown>
}

export type TaskPlannerEventType = 'task:plan' | 'task:step' | 'task:complete' | 'task:failed'

export interface TaskPlannerEvent {
  type: TaskPlannerEventType
  planId: string
  plan: TaskPlan
  step?: TaskStep
  at: number
}
