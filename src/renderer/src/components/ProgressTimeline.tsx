import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Check, Circle, Loader2, PauseCircle, Sparkles, Wrench } from 'lucide-react'
import { buildTimeline, type StepKind } from '../lib/timeline'
import { useStore } from '../store'

const KIND_ICON: Record<StepKind, typeof Check> = {
  start: Sparkles,
  thought: Sparkles,
  tool: Wrench,
  error: AlertTriangle,
  done: Check,
  stopped: PauseCircle
}

/** Collapsible right-hand vertical timeline of the current agent run (D.6). */
export default function ProgressTimeline(): JSX.Element {
  const { t } = useTranslation()
  const logs = useStore((state) => state.logs)
  const running = useStore((state) => state.running)
  const steps = useMemo(() => buildTimeline(logs, running), [logs, running])

  const label = (kind: StepKind, tool?: string): string => {
    if (kind === 'tool' && tool) return t('timeline.tool', { tool })
    return t(`timeline.${kind}`)
  }

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-l border-border bg-bg-secondary">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
          {t('timeline.title')}
        </span>
        {running ? <Loader2 className="h-3 w-3 animate-spin text-accent" /> : null}
      </div>
      <ol className="min-h-0 flex-1 overflow-y-auto p-3">
        {steps.length === 0 ? (
          <p className="text-[11px] text-neutral-600">{t('timeline.empty')}</p>
        ) : (
          steps.map((step, index) => {
            const Icon = KIND_ICON[step.kind]
            const state =
              step.status === 'active'
                ? 'text-accent'
                : step.status === 'pending'
                  ? 'text-neutral-600'
                  : step.kind === 'error'
                    ? 'text-red-400'
                    : 'text-emerald-400'
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
                <span
                  className={`min-w-0 flex-1 text-[11px] leading-snug ${
                    step.status === 'pending' ? 'text-neutral-600' : 'text-neutral-300'
                  }`}
                >
                  {label(step.kind, step.tool)}
                </span>
              </li>
            )
          })
        )}
      </ol>
    </aside>
  )
}
