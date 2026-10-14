import { useState } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  ListChecks,
  Loader2,
  Pause,
  Play,
  Square,
  XCircle
} from 'lucide-react'
import type { TaskStep } from '@shared/task-plan'
import { useStore } from '../store'

function StepIcon({ status }: { status: TaskStep['status'] }): JSX.Element {
  switch (status) {
    case 'done':
      return <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-label="done" />
    case 'running':
      return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" aria-label="running" />
    case 'failed':
      return <XCircle className="h-4 w-4 shrink-0 text-danger" aria-label="failed" />
    default:
      return <Circle className="h-4 w-4 shrink-0 text-fg-subtle" aria-label="pending" />
  }
}

function commandOf(step: TaskStep): string | null {
  const command = step.args?.command
  return typeof command === 'string' && command ? command : null
}

function durationLabel(ms?: number): string | null {
  if (ms === undefined) return null
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

/**
 * Live task-plan panel (v2.5.7). Shown next to the chat while the agent works
 * through a multi-step plan; the user can pause, resume, stop and inspect it.
 */
export default function TaskTracker(): JSX.Element | null {
  const plan = useStore((state) => state.taskPlan)
  const paused = useStore((state) => state.taskPaused)
  const pauseTaskPlan = useStore((state) => state.pauseTaskPlan)
  const resumeTaskPlan = useStore((state) => state.resumeTaskPlan)
  const stopTaskPlan = useStore((state) => state.stopTaskPlan)
  const [details, setDetails] = useState(false)

  if (!plan || plan.steps.length === 0) return null

  const total = plan.steps.length
  const done = plan.steps.filter((step) => step.status === 'done').length
  const percent = Math.round((done / total) * 100)
  const finished = plan.status === 'completed' || plan.status === 'failed'

  return (
    <div className="mx-4 mt-3 shrink-0 rounded-lg border border-border bg-bg-tertiary p-3 text-sm">
      <div className="mb-2 flex items-center gap-2">
        <ListChecks className="h-4 w-4 text-accent" />
        <span className="font-medium text-fg">Current Task</span>
        <span className="truncate text-xs text-fg-muted" title={plan.goal}>
          {plan.goal}
        </span>
      </div>

      <ol className="space-y-1.5" data-testid="task-steps">
        {plan.steps.map((step) => {
          const duration = durationLabel(step.durationMs)
          const command = commandOf(step)
          return (
            <li key={step.id} data-status={step.status} className="flex items-start gap-2">
              <StepIcon status={step.status} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span
                    className={
                      step.status === 'done'
                        ? 'text-fg-muted line-through'
                        : step.status === 'running'
                          ? 'text-fg-strong'
                          : 'text-fg'
                    }
                  >
                    {step.number}. {step.description}
                  </span>
                  {duration ? (
                    <span className="shrink-0 text-3xs text-fg-subtle">{duration}</span>
                  ) : null}
                </div>
                {command ? (
                  <code className="mt-0.5 block truncate font-mono text-3xs text-fg-muted">
                    $ {command}
                  </code>
                ) : null}
                {step.status === 'running' ? (
                  <span className="text-3xs text-accent">running…</span>
                ) : null}
                {step.status === 'failed' && step.notes ? (
                  <span className="block text-3xs text-danger">{step.notes}</span>
                ) : null}
                {details && Object.keys(step.args).length > 0 ? (
                  <pre className="mt-1 overflow-x-auto rounded bg-bg-primary p-1 font-mono text-3xs text-fg-muted">
                    {JSON.stringify(step.args, null, 2)}
                  </pre>
                ) : null}
              </div>
            </li>
          )
        })}
      </ol>

      <div className="mt-3">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-primary">
          <div
            className="h-full rounded-full bg-accent-solid transition-all"
            style={{ width: `${percent}%` }}
            data-testid="task-progress-bar"
            role="progressbar"
            aria-valuenow={percent}
          />
        </div>
        <div className="mt-1 flex items-center justify-between text-2xs text-fg-muted">
          <span data-testid="task-progress">
            Progress: {done}/{total} ({percent}%)
          </span>
          <div className="flex items-center gap-1">
            {!finished ? (
              <button
                type="button"
                onClick={paused ? resumeTaskPlan : pauseTaskPlan}
                className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-fg-muted hover:text-fg-strong"
              >
                {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                {paused ? 'Resume' : 'Pause'}
              </button>
            ) : null}
            {!finished ? (
              <button
                type="button"
                onClick={stopTaskPlan}
                className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-fg-muted hover:text-danger"
              >
                <Square className="h-3 w-3" />
                Stop
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setDetails((value) => !value)}
              className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-fg-muted hover:text-fg-strong"
            >
              {details ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              Details
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
