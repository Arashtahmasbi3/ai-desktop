import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronDown,
  ChevronRight,
  Eye,
  FileOutput,
  HelpCircle,
  Loader2,
  Pencil,
  Search,
  SquareTerminal
} from 'lucide-react'
import type { TraceDecision, TraceEvidence, TraceExplanation, TracePhase } from '@shared/trace'
import { TRACE_PHASES } from '@shared/trace'

/** Colour + icon per phase, matching the dark timeline palette. */
const PHASE_STYLE: Record<TracePhase, { icon: typeof Eye; className: string }> = {
  planning: { icon: Search, className: 'text-sky-400 border-sky-500/30 bg-sky-500/10' },
  inspecting: { icon: Eye, className: 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10' },
  executing: { icon: SquareTerminal, className: 'text-violet-400 border-violet-500/30 bg-violet-500/10' },
  verifying: { icon: Pencil, className: 'text-amber-400 border-amber-500/30 bg-amber-500/10' },
  done: { icon: FileOutput, className: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' }
}

export interface DecisionCardProps {
  decision: TraceDecision
  /**
   * Tighter row padding for the inline chat trace (v2.6.3). The expanded body is
   * unchanged — only the collapsed header is compacted.
   */
  compact?: boolean
  /** Overridable for tests; defaults to the real `Ask Why` IPC. */
  onExplain?: (decision: TraceDecision) => Promise<TraceExplanation | null>
}

async function defaultExplain(decision: TraceDecision): Promise<TraceExplanation | null> {
  return window.api.agent.explainStep(decision.runId, decision.id)
}

/**
 * v2.6.2 (T3.2) - one node of the run timeline. Shows what the agent intended,
 * the evidence it collected, and the decision it took, plus an `Ask Why` button
 * that asks main to explain the decision (deterministic, no extra model call).
 */
export default function DecisionCard({ decision, compact, onExplain }: DecisionCardProps): JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [explanation, setExplanation] = useState<TraceExplanation | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  const style = PHASE_STYLE[decision.phase]
  const Icon = style.icon

  const askWhy = async (): Promise<void> => {
    setLoading(true)
    setFailed(false)
    try {
      const result = await (onExplain ?? defaultExplain)(decision)
      setExplanation(result)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  const evidenceLabel = (item: TraceEvidence): string => t(`trace.evidence${item.kind[0].toUpperCase()}${item.kind.slice(1)}`)

  return (
    <li
      data-testid="decision-card"
      className={`rounded-md border border-border bg-bg-secondary/60 ${
        compact ? 'text-2xs' : ''
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`flex w-full items-center gap-2 text-left ${compact ? 'px-2 py-1' : 'px-2.5 py-2'}`}
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-neutral-500" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-neutral-500" />
        )}
        <span className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-3xs ${style.className}`}>
          <Icon className="h-3 w-3" />
          {t(`trace.phase${decision.phase[0].toUpperCase()}${decision.phase.slice(1)}`)}
        </span>
        <span className="min-w-0 flex-1 truncate text-2xs text-neutral-300">
          {decision.intent.summary}
        </span>
        {decision.outcome ? (
          <span
            className={`shrink-0 text-3xs ${
              decision.outcome === 'ok'
                ? 'text-emerald-400'
                : decision.outcome === 'failed'
                  ? 'text-red-400'
                  : 'text-amber-400'
            }`}
          >
            {t(`trace.outcome${decision.outcome[0].toUpperCase()}${decision.outcome.slice(1)}`)}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="space-y-2 border-t border-border px-2.5 py-2">
          <section>
            <h4 className="text-3xs font-semibold uppercase tracking-wide text-neutral-500">
              {t('trace.intent')}
            </h4>
            <p className="mt-0.5 text-2xs leading-snug text-neutral-300">{decision.intent.summary}</p>
            {decision.intent.rationale ? (
              <p className="mt-1 text-2xs leading-snug text-neutral-400">
                <span className="text-neutral-500">{t('trace.assessment')}: </span>
                {decision.intent.rationale}
              </p>
            ) : null}
          </section>

          <section>
            <h4 className="text-3xs font-semibold uppercase tracking-wide text-neutral-500">
              {t('trace.evidence')}
            </h4>
            {decision.evidence.length === 0 ? (
              <p className="mt-0.5 text-2xs text-neutral-500">{t('trace.noEvidence')}</p>
            ) : (
              <ul className="mt-0.5 space-y-1">
                {decision.evidence.map((item, index) => (
                  <li key={`${item.hash ?? item.ref}-${index}`} className="text-2xs leading-snug">
                    <span className="text-neutral-400">{evidenceLabel(item)}</span>
                    <span className="mx-1 text-neutral-600">·</span>
                    <code className="text-neutral-300">{item.lines ?? item.summary}</code>
                    {item.kind === 'output' ? (
                      <span className="ml-1 text-3xs text-neutral-500">
                        {t('trace.viewOutput')}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h4 className="text-3xs font-semibold uppercase tracking-wide text-neutral-500">
              {t('trace.decision')}
            </h4>
            <p className="mt-0.5 text-2xs leading-snug text-neutral-300">{decision.decision}</p>
          </section>

          <button
            type="button"
            onClick={() => void askWhy()}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-3xs text-neutral-300 hover:border-accent hover:text-accent disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <HelpCircle className="h-3 w-3" />
            )}
            {t('trace.askWhy')}
          </button>

          {failed ? <p className="text-3xs text-red-400">{t('trace.askWhyFailed')}</p> : null}

          {explanation ? (
            <div className="rounded border border-border/70 bg-bg-tertiary/40 p-2">
              <p className="text-3xs font-semibold uppercase tracking-wide text-neutral-500">
                {t('trace.why')}
              </p>
              <ul className="mt-1 space-y-0.5">
                {explanation.reasoning.map((line) => (
                  <li key={line} className="text-2xs leading-snug text-neutral-300">
                    • {line}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

/** Guard for consumers that receive `unknown` decisions from the log stream. */
export function isTraceDecision(value: unknown): value is TraceDecision {
  if (typeof value !== 'object' || value === null) return false
  const decision = value as Partial<TraceDecision>
  return (
    typeof decision.id === 'string' &&
    typeof decision.runId === 'string' &&
    typeof decision.decision === 'string' &&
    typeof decision.intent === 'object' &&
    decision.intent !== null &&
    TRACE_PHASES.includes(decision.phase as TracePhase)
  )
}
