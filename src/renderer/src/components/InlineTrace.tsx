import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Activity, ChevronDown, ChevronRight } from 'lucide-react'
import DecisionCard from './DecisionCard'
import { useStore } from '../store'

/** Keep the inline list light; the full run is still in the Progress panel. */
const INLINE_TRACE_LIMIT = 30

/**
 * Inline execution trace for the active run (v2.6.3, Fix C). Decisions used to
 * live only inside the collapsed `ProgressTimeline` side panel, so during work the
 * chat showed nothing but `✓ tool ok` rows. This renders the same `DecisionCard`s
 * directly in the message flow so the agent's intent/evidence is visible without
 * opening a panel.
 */
export default function InlineTrace(): JSX.Element | null {
  const { t } = useTranslation()
  const decisions = useStore((state) => state.decisions)
  const [open, setOpen] = useState(true)

  if (decisions.length === 0) return null

  const visible = decisions.slice(-INLINE_TRACE_LIMIT)
  const latest = decisions[decisions.length - 1].intent.summary

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
        <ul className="flex flex-col gap-1">
          {visible.map((decision) => (
            <DecisionCard key={decision.id} compact decision={decision} />
          ))}
        </ul>
      ) : null}
    </section>
  )
}
