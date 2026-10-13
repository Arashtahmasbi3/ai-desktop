import { useTranslation } from 'react-i18next'
import { Activity } from 'lucide-react'
import { useStore } from '../store'
import type { TracePhase } from '@shared/trace'

/** Human label for a phase, reusing the timeline's translations. */
function phaseKey(phase: TracePhase): string {
  return `timeline.phase${phase[0].toUpperCase()}${phase.slice(1)}`
}

/**
 * v2.6.3 T1.3 - the always-visible run status above the conversation.
 *
 * A compact `{ phase, lastDecision }` readout so the user can tell what the agent
 * is doing (or last did) without opening the detailed run timeline. It shows an
 * "idle" placeholder before the first decision and a localized fallback when a
 * decision has no summary.
 */
export default function StatusCard(): JSX.Element {
  const { t } = useTranslation()
  const running = useStore((state) => state.running)
  const decisions = useStore((state) => state.decisions)

  const latest = decisions[decisions.length - 1]
  const phaseLabel = latest ? t(phaseKey(latest.phase)) : t('chat.statusIdle')
  const decisionLabel = latest?.decision || t('chat.statusUnknown')

  return (
    <div
      data-testid="run-status"
      className="flex shrink-0 items-center gap-3 rounded-xl border border-border bg-bg-secondary px-3 py-2"
    >
      <span className="flex shrink-0 items-center gap-1.5 text-3xs font-semibold uppercase tracking-wide text-neutral-500">
        <Activity className={`h-3.5 w-3.5 ${running ? 'text-accent' : 'text-neutral-500'}`} />
        {t('chat.statusLabel')}
      </span>
      <span className="shrink-0 rounded bg-bg-tertiary px-1.5 py-0.5 text-3xs font-medium text-neutral-300">
        {phaseLabel}
      </span>
      <span className="min-w-0 flex-1 truncate text-2xs text-neutral-500" title={decisionLabel}>
        {decisionLabel}
      </span>
    </div>
  )
}
