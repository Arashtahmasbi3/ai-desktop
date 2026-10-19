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
import type { TraceDecision, TraceEvidence, TraceExplanation, TraceOutcome, TracePhase } from '@shared/trace'
import { TRACE_PHASES } from '@shared/trace'
import { InlineMarkdown, MarkdownProse } from './Markdown'
import type { StepSummary } from '../lib/step-summary'

/** Colour + icon per phase, matching the dark timeline palette. */
const PHASE_STYLE: Record<TracePhase, { icon: typeof Eye; className: string }> = {
  planning: { icon: Search, className: 'text-info border-info/30 bg-info/10' },
  inspecting: { icon: Eye, className: 'text-info border-info/30 bg-info/10' },
  executing: { icon: SquareTerminal, className: 'text-accent border-accent/30 bg-accent-solid/10' },
  verifying: { icon: Pencil, className: 'text-warning border-warning/30 bg-warning/10' },
  done: { icon: FileOutput, className: 'text-success border-success/30 bg-success/10' }
}

export interface DecisionCardProps {
  decision: TraceDecision
  /**
   * Tighter row padding for the inline chat trace (v2.6.3). The expanded body is
   * unchanged — only the collapsed header is compacted.
   */
  compact?: boolean
  /**
   * U3-5: what this step DID, in words a reader can scan — the tool's human label, the
   * outcome and how long it took. It renders in the collapsed header, because a summary
   * that only appears after expanding is not a summary. The arguments, the evidence, the
   * decision, the reasoning and "Ask Why" all stay behind the expand.
   */
  summary?: StepSummary
  /** Overridable for tests; defaults to the real `Ask Why` IPC. */
  onExplain?: (decision: TraceDecision) => Promise<TraceExplanation | null>
}

async function defaultExplain(decision: TraceDecision): Promise<TraceExplanation | null> {
  return window.api.agent.explainStep(decision.runId, decision.id)
}

/** `ok` -> `trace.outcomeOk`, so the phase and outcome vocabulary stays in i18n. */
function outcomeKey(outcome: TraceOutcome): string {
  return `trace.outcome${outcome.charAt(0).toUpperCase()}${outcome.slice(1)}`
}

/**
 * v2.6.2 (T3.2) - one node of the run timeline. Shows what the agent intended,
 * the evidence it collected, and the decision it took, plus an `Ask Why` button
 * that asks main to explain the decision (deterministic, no extra model call).
 *
 * U3-5: the row is a summary that stands on its own — the tool's human label, the
 * outcome and the duration — so a run can be read by scanning; the detail is one click
 * away and never replaces the scan.
 */
export default function DecisionCard({ decision, compact, summary, onExplain }: DecisionCardProps): JSX.Element {
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

  // A failed observation outranks the decision's own verdict: the row must not say "ok"
  // above a tool that failed (U3-5, "did it work").
  const outcome: TraceOutcome | undefined = summary?.outcome ?? decision.outcome

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
        aria-expanded={open}
        data-testid="decision-header"
        className={`flex w-full items-center gap-2 text-left ${compact ? 'px-2 py-1' : 'px-2.5 py-2'}`}
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
        )}
        <span className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-3xs ${style.className}`}>
          <Icon className="h-3 w-3" />
          {t(`trace.phase${decision.phase[0].toUpperCase()}${decision.phase.slice(1)}`)}
        </span>
        {/*
          U3-5: what ran, in human words — "Ran a command · Read a file ×2". This is the
          scan line; the raw tool ids stay in the step's chips and in the expanded body.
        */}
        {summary?.activity ? (
          <span
            data-testid="decision-activity"
            dir="auto"
            title={summary.activity}
            className="max-w-[16rem] shrink-0 truncate text-3xs text-fg-muted"
          >
            {summary.activity}
          </span>
        ) : null}
        {/*
          The intent is the model's own thought: free prose that may contain markdown and may be
          Persian. It resolves its own direction (`dir="auto"`) and renders its markdown, but as an
          inline preview so the row stays one truncated line — the full rendering is in the body.
        */}
        <span
          data-testid="decision-summary"
          dir="auto"
          className="min-w-0 flex-1 truncate text-2xs text-fg"
        >
          <InlineMarkdown text={decision.intent.summary} />
        </span>
        {summary?.durationLabel ? (
          <span
            data-testid="decision-duration"
            className="shrink-0 font-mono text-3xs text-fg-subtle"
          >
            {summary.durationLabel}
          </span>
        ) : null}
        {outcome ? (
          <span
            data-testid="decision-outcome"
            data-outcome={outcome}
            className={`shrink-0 text-3xs ${
              outcome === 'ok'
                ? 'text-success'
                : outcome === 'failed'
                  ? 'text-danger'
                  : 'text-warning'
            }`}
          >
            {t(outcomeKey(outcome))}
          </span>
        ) : null}
      </button>

      {open ? (
        <div data-testid="decision-body" className="space-y-2 border-t border-border px-2.5 py-2">
          <section>
            <h4 className="text-3xs font-semibold uppercase tracking-wide text-fg-muted">
              {t('trace.intent')}
            </h4>
            <MarkdownProse
              dir="auto"
              text={decision.intent.summary}
              className="mt-0.5 text-2xs leading-snug text-fg"
            />
            {decision.intent.rationale ? (
              <div className="mt-1 text-2xs leading-snug text-fg-muted">
                <span className="text-fg-muted">{t('trace.assessment')}: </span>
                <MarkdownProse
                  dir="auto"
                  text={decision.intent.rationale}
                  className="mt-0.5 leading-snug"
                />
              </div>
            ) : null}
          </section>

          <section>
            <h4 className="text-3xs font-semibold uppercase tracking-wide text-fg-muted">
              {t('trace.evidence')}
            </h4>
            {decision.evidence.length === 0 ? (
              <p className="mt-0.5 text-2xs text-fg-muted">{t('trace.noEvidence')}</p>
            ) : (
              <ul className="mt-0.5 space-y-1">
                {decision.evidence.map((item, index) => (
                  <li key={`${item.hash ?? item.ref}-${index}`} className="text-2xs leading-snug">
                    <span className="text-fg-muted">{evidenceLabel(item)}</span>
                    <span className="mx-1 text-fg-subtle">·</span>
                    <code className="text-fg">{item.lines ?? item.summary}</code>
                    {item.kind === 'output' ? (
                      <span className="ml-1 text-3xs text-fg-muted">
                        {t('trace.viewOutput')}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h4 className="text-3xs font-semibold uppercase tracking-wide text-fg-muted">
              {t('trace.decision')}
            </h4>
            <p className="mt-0.5 text-2xs leading-snug text-fg">{decision.decision}</p>
          </section>

          <button
            type="button"
            onClick={() => void askWhy()}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-3xs text-fg hover:border-accent hover:text-accent disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <HelpCircle className="h-3 w-3" />
            )}
            {t('trace.askWhy')}
          </button>

          {failed ? <p className="text-3xs text-danger">{t('trace.askWhyFailed')}</p> : null}

          {explanation ? (
            <div className="rounded border border-border/70 bg-bg-tertiary/40 p-2">
              <p className="text-3xs font-semibold uppercase tracking-wide text-fg-muted">
                {t('trace.why')}
              </p>
              <ul className="mt-1 space-y-0.5">
                {explanation.reasoning.map((line) => (
                  <li key={line} className="text-2xs leading-snug text-fg">
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
