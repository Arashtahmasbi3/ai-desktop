import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Activity, AlertCircle, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react'
import DecisionCard from './DecisionCard'
import { useStore, type ChatMessage } from '../store'
import type { TraceDecision } from '@shared/trace'

/** Keep the inline list light; the full run is still in the Progress panel. */
const INLINE_TRACE_LIMIT = 30

/** Collapsed view shows only the newest few steps; the rest load on demand. */
const INLINE_TRACE_PREVIEW = 3

/** Step index encoded in a decision id (`${runId}:${step}`). */
function stepOf(decision: TraceDecision): number | undefined {
  const index = decision.id.lastIndexOf(':')
  if (index < 0) return undefined
  const step = Number(decision.id.slice(index + 1))
  return Number.isFinite(step) ? step : undefined
}

/**
 * Inline execution trace for the active run (v2.6.3, Fix C). Decisions used to
 * live only inside the collapsed `ProgressTimeline` side panel, so during work the
 * chat showed nothing but `✓ tool ok` rows. This renders the same `DecisionCard`s
 * directly in the message flow so the agent's intent/evidence is visible without
 * opening a panel.
 *
 * v2.6.3 Layer 2: each decision groups the tool calls that ran in its step, as
 * compact chips, so intent, evidence and result read together.
 */
export default function InlineTrace(): JSX.Element | null {
  const { t } = useTranslation()
  const decisions = useStore((state) => state.decisions)
  const messages = useStore((state) => state.messages)
  const [open, setOpen] = useState(true)
  const [expanded, setExpanded] = useState(false)

  if (decisions.length === 0) return null

  const bounded = decisions.slice(-INLINE_TRACE_LIMIT)
  const visible = expanded ? bounded : bounded.slice(-INLINE_TRACE_PREVIEW)
  const hiddenCount = bounded.length - visible.length
  const latest = decisions[decisions.length - 1].intent.summary

  const toolsFor = (decision: TraceDecision): ChatMessage[] => {
    const step = stepOf(decision)
    if (step === undefined) return []
    return messages.filter(
      (message) =>
        message.role === 'tool' &&
        message.runId === decision.runId &&
        message.toolCall?.step === step
    )
  }

  return (
    <section
      data-testid="inline-trace"
      dir="ltr"
      className="mx-4 flex flex-col gap-1 rounded-lg border border-border bg-bg-secondary/40 p-2"
    >
      <button
        type="button"
        data-testid="inline-trace-toggle"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex items-center gap-2 px-0.5 text-left"
      >
        <Activity className="h-3.5 w-3.5 shrink-0 text-accent" />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
          {t('trace.inlineTitle')}
        </span>
        <span
          data-testid="inline-trace-count"
          className="rounded bg-bg-tertiary px-1 font-mono text-[10px] text-neutral-400"
        >
          {decisions.length}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-neutral-500">{latest}</span>
        <span className="shrink-0 text-neutral-500">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
      </button>

      {open ? (
        <ul data-testid="trace-steps" className="flex flex-col gap-1">
          {visible.map((decision) => {
            const tools = toolsFor(decision)
            return (
              <Fragment key={decision.id}>
                <DecisionCard compact decision={decision} />
                {tools.length > 0 ? (
                  <li
                    data-testid="trace-step-tools"
                    className="ml-5 flex flex-wrap gap-1 list-none"
                  >
                    {tools.map((message) => {
                      const ok = message.toolCall?.ok ?? false
                      const Icon = ok ? CheckCircle2 : AlertCircle
                      return (
                        <span
                          key={message.id}
                          data-testid="trace-tool-chip"
                          className={`flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                            ok ? 'border-border text-neutral-400' : 'border-red-500/40 text-red-300'
                          }`}
                        >
                          <Icon
                            className={`h-2.5 w-2.5 shrink-0 ${
                              ok ? 'text-emerald-400' : 'text-red-400'
                            }`}
                          />
                          {message.toolCall?.name}
                        </span>
                      )
                    })}
                  </li>
                ) : null}
              </Fragment>
            )
          })}
        </ul>
      ) : null}

      {open && hiddenCount > 0 ? (
        <button
          type="button"
          data-testid="inline-trace-show-all"
          onClick={() => setExpanded(true)}
          className="self-start rounded border border-border px-2 py-0.5 text-[10px] text-neutral-400 hover:border-accent/50 hover:text-accent"
        >
          {t('trace.showAll', { count: hiddenCount })}
        </button>
      ) : null}

      {open && expanded && bounded.length > INLINE_TRACE_PREVIEW ? (
        <button
          type="button"
          data-testid="inline-trace-show-less"
          onClick={() => setExpanded(false)}
          className="self-start rounded border border-border px-2 py-0.5 text-[10px] text-neutral-400 hover:border-accent/50 hover:text-accent"
        >
          {t('trace.showLess')}
        </button>
      ) : null}
    </section>
  )
}
