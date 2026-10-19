import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Brain, Check, Circle, Loader2, PauseCircle, RotateCcw, Sparkles, Wrench } from 'lucide-react'
import { buildTimeline, type StepKind, type TimelineStep } from '../lib/timeline'
import { toolLabel } from '../lib/tool-labels'
import { useStore } from '../store'
import DecisionCard from './DecisionCard'

const KIND_ICON: Record<StepKind, typeof Check> = {
  start: Sparkles,
  thought: Sparkles,
  tool: Wrench,
  error: AlertTriangle,
  done: Check,
  stopped: PauseCircle,
  recovery: RotateCcw,
  decision: Brain
}

export interface ProgressTimelineProps {
  /**
   * v2.6.3 T1.3: render inside the chat's single column instead of as a fixed
   * right-hand column, so the conversation is never squeezed by a side panel.
   */
  embedded?: boolean
}

/** Collapsible vertical timeline of the current agent run (D.6). */
export default function ProgressTimeline({ embedded }: ProgressTimelineProps = {}): JSX.Element {
  const { t } = useTranslation()
  const logs = useStore((state) => state.logs)
  const running = useStore((state) => state.running)
  const decisions = useStore((state) => state.decisions)
  const steps = useMemo(() => buildTimeline(logs, running), [logs, running])

  const label = (step: TimelineStep): string => {
    if (step.kind === 'tool' && step.tool) return toolLabel(step.tool, t)
    if (step.kind === 'decision' && step.decision) return step.decision.intent.summary
    return t(`timeline.${step.kind}`)
  }

  /** Secondary line: agent phase and/or the recovery decision (v2.5.2). */
  const detail = (step: TimelineStep): string | undefined => {
    const parts: string[] = []
    if (step.phase) {
      parts.push(t(`timeline.phase${step.phase[0].toUpperCase()}${step.phase.slice(1)}`))
    }
    if (step.recovery) {
      const { decision, attempts, recovered, to } = step.recovery
      if (decision === 'switch') parts.push(t('timeline.switchedTo', { to: to ?? '—' }))
      else if (decision === 'retry') {
        parts.push(
          recovered
            ? t('timeline.recoveredAfter', { count: attempts ?? 1 })
            : t('timeline.retryFailed', { count: attempts ?? 1 })
        )
      } else parts.push(t('timeline.noRetry'))
    }
    return parts.length > 0 ? parts.join(' · ') : undefined
  }

  return (
    <aside
      data-testid="progress-timeline"
      className={
        embedded
          ? 'flex max-h-72 w-full shrink-0 flex-col overflow-hidden rounded-shape border border-border bg-bg-secondary'
          : 'flex h-full w-64 shrink-0 flex-col border-l border-border bg-bg-secondary'
      }
    >
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-3xs font-semibold text-fg-muted">
          {t('timeline.title')}
        </span>
        {running ? <Loader2 className="h-3 w-3 animate-spin text-accent" /> : null}
      </div>
      {decisions.length > 0 ? (
        <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
          {decisions.map((decision) => (
            <DecisionCard key={decision.id} decision={decision} />
          ))}
        </ul>
      ) : (
        <ol className="min-h-0 flex-1 overflow-y-auto p-3">
          {steps.length === 0 ? (
          <p className="text-2xs text-fg-subtle">{t('timeline.empty')}</p>
        ) : (
          steps.map((step, index) => {
            const Icon = KIND_ICON[step.kind]
            const state =
              step.status === 'active'
                ? 'text-accent'
                : step.status === 'pending'
                  ? 'text-fg-subtle'
                  : step.kind === 'error'
                    ? 'text-danger'
                    : 'text-success'
            return (
              <li key={step.id} className="relative flex gap-2 pb-3 last:pb-0">
                {index < steps.length - 1 ? (
                  <span className="absolute left-[7px] top-4 h-full w-px bg-border" />
                ) : null}
                {step.status === 'active' ? (
                  <Loader2 className={`relative z-10 mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin ${state}`} />
                ) : step.status === 'pending' ? (
                  <Circle className={`relative z-10 mt-0.5 h-3.5 w-3.5 shrink-0 ${state}`} />
                ) : (
                  <Icon className={`relative z-10 mt-0.5 h-3.5 w-3.5 shrink-0 ${state}`} />
                )}
                <span className="min-w-0 flex-1">
                  <span
                    className={`block text-2xs leading-snug ${
                      step.status === 'pending' ? 'text-fg-subtle' : 'text-fg'
                    }`}
                  >
                    {label(step)}
                  </span>
                  {detail(step) ? (
                    <span className="mt-0.5 block text-3xs leading-snug text-fg-muted">
                      {detail(step)}
                    </span>
                  ) : null}
                </span>
              </li>
            )
          })
        )}
        </ol>
      )}
    </aside>
  )
}
