import { Fragment, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Activity, AlertCircle, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react'
import DecisionCard from './DecisionCard'
import { useStore, type ChatMessage } from '../store'
import { summarizeActivity, toolHeadline } from '../lib/tool-labels'
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
  // v2.8.0: the durable "what changed" summary for this chat, with each file's diffstat.
  const changedFiles = useStore((state) => state.changedFiles)
  // v2.8.0: the model's reasoning per step, keyed by `runId:step` — the trace id.
  const reasoningByStep = useStore((state) => state.reasoningByStep)

  // U-11: `toolsFor` used to filter the entire message list once per visible
  // decision (O(steps x messages) every render). Index the tool messages by
  // `runId:step` once instead.
  const toolsByStep = useMemo(() => {
    const index = new Map<string, ChatMessage[]>()
    for (const message of messages) {
      const step = message.toolCall?.step
      if (message.role !== 'tool' || !message.runId || step === undefined) continue
      const key = `${message.runId}:${step}`
      const bucket = index.get(key)
      if (bucket) bucket.push(message)
      else index.set(key, [message])
    }
    return index
  }, [messages])

  if (decisions.length === 0) return null

  // v2.8.0: the activity this run actually performed, and what it changed on disk.
  const activity = summarizeActivity(
    messages.filter((message) => message.role === 'tool').map((message) => message.toolCall?.name)
  )
  const totalAdded = changedFiles.reduce((sum, file) => sum + file.added, 0)
  const totalRemoved = changedFiles.reduce((sum, file) => sum + file.removed, 0)
  // A decision id is `${runId}:${step}`, which is exactly the reasoning key.
  const reasoningFor = (decision: TraceDecision): string | undefined =>
    reasoningByStep[decision.id]

  const bounded = decisions.slice(-INLINE_TRACE_LIMIT)
  const visible = expanded ? bounded : bounded.slice(-INLINE_TRACE_PREVIEW)
  const hiddenCount = bounded.length - visible.length
  const latest = decisions[decisions.length - 1].intent.summary

  const toolsFor = (decision: TraceDecision): ChatMessage[] => {
    const step = stepOf(decision)
    if (step === undefined) return []
    return toolsByStep.get(`${decision.runId}:${step}`) ?? []
  }

  /*
   * v3.0 clay — soft tier: the trace chip/container is a raised card, and everything
   * inside it (step rows, tool chips, changed-file counts) stays flat.
   */
  return (
    <section
      data-testid="inline-trace"
      // U-7: `dir="ltr"` forced a Persian intent summary to render left-to-right
      // inside an RTL chat. `auto` resolves per element, and the commands/tool
      // chips below keep their own explicit LTR direction.
      dir="auto"
      className="clay-card mx-4 flex flex-col gap-1 p-2"
    >
      <button
        type="button"
        data-testid="inline-trace-toggle"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex items-center gap-2 px-0.5 text-left"
      >
        <Activity className="h-3.5 w-3.5 shrink-0 text-accent" />
        <span className="text-3xs font-semibold uppercase tracking-wide text-fg-muted">
          {t('trace.inlineTitle')}
        </span>
        <span
          data-testid="inline-trace-count"
          className="rounded bg-bg-tertiary px-1 font-mono text-3xs text-fg-muted"
        >
          {decisions.length}
        </span>
        <span className="min-w-0 flex-1 truncate text-2xs text-fg-muted">{latest}</span>
        <span className="shrink-0 text-fg-muted">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
      </button>

      {/*
        v2.8.0: what the run has actually done, in words, instead of a bare count of
        steps — "Ran 3 commands, read 5 files, edited 2 files" plus the per-file
        diffstat. Asked for as: "say which files changed and by how much".
      */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-0.5 text-3xs text-fg-muted">
        <span data-testid="activity-summary">
          {activity.total === 0
            ? t('chat.activitySummaryEmpty')
            : t('chat.activitySummary', {
                commands: activity.commands,
                files: activity.reads,
                edits: activity.edits
              })}
        </span>
        {changedFiles.length > 0 ? (
          <span data-testid="changed-files-total" className="text-fg">
            {`· ${t('chat.filesChangedTotal', {
              count: changedFiles.length,
              added: totalAdded,
              removed: totalRemoved
            })}`}
          </span>
        ) : null}
      </div>

      {changedFiles.length > 0 ? (
        <ul data-testid="changed-files" className="flex flex-col gap-0.5 px-0.5">
          {changedFiles.map((file) => (
            <li
              key={file.path}
              data-testid={`changed-file-${file.path}`}
              className="flex items-center gap-2 text-3xs"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-fg-muted" dir="ltr">
                {file.path}
              </span>
              {/* Numbers in the semantic diff colours, readable in both themes. */}
              <span className="shrink-0 font-mono text-success">+{file.added}</span>
              <span className="shrink-0 font-mono text-danger">−{file.removed}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {open ? (
        <ul data-testid="trace-steps" className="flex flex-col gap-1">
          {visible.map((decision) => {
            const tools = toolsFor(decision)
            return (
              <Fragment key={decision.id}>
                <DecisionCard compact decision={decision} />
                {/*
                  v2.8.0: the model's own reasoning for this step, when the provider
                  exposes it (DeepSeek `reasoning_content`, Anthropic thinking blocks).
                  Collapsed by default — it is context for the reader, not the answer —
                  and only shown where the provider actually sent something.
                */}
                {reasoningFor(decision) ? (
                  <li className="ml-5 list-none">
                    <details data-testid="trace-reasoning" className="group">
                      <summary className="cursor-pointer text-3xs text-fg-subtle hover:text-fg-muted">
                        {t('trace.reasoningLabel')}
                      </summary>
                      <p
                        dir="auto"
                        className="mt-0.5 whitespace-pre-wrap border-l-2 border-border pl-2 text-3xs text-fg-muted"
                      >
                        {reasoningFor(decision)}
                      </p>
                    </details>
                  </li>
                ) : null}
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
                          data-tool={message.toolCall?.name}
                          title={message.toolCall?.name}
                          className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-3xs ${
                            ok ? 'border-border text-fg-muted' : 'border-danger/40 text-danger'
                          }`}
                        >
                          <Icon
                            className={`h-2.5 w-2.5 shrink-0 ${
                              ok ? 'text-success' : 'text-danger'
                            }`}
                          />
                          {/*
      v2.8.1: a chip that says "a file" tells the reader nothing. The prose headline
      ("Read a file", "Ran a command on the server") is self-explanatory, and the exact
      tool id stays in data-tool/title for tests and tooltips.
    */}
                    {toolHeadline(
                      {
                        ...(message.toolCall?.name ? { name: message.toolCall.name } : {}),
                        ...(message.toolCall?.command ? { command: message.toolCall.command } : {}),
                        ...(message.toolCall?.path ? { path: message.toolCall.path } : {}),
                        ...(message.toolCall?.serverId ? { serverId: message.toolCall.serverId } : {})
                      },
                      t
                    ).headline}
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
          className="self-start rounded border border-border px-2 py-0.5 text-3xs text-fg-muted hover:border-accent/50 hover:text-accent"
        >
          {t('trace.showAll', { count: hiddenCount })}
        </button>
      ) : null}

      {open && expanded && bounded.length > INLINE_TRACE_PREVIEW ? (
        <button
          type="button"
          data-testid="inline-trace-show-less"
          onClick={() => setExpanded(false)}
          className="self-start rounded border border-border px-2 py-0.5 text-3xs text-fg-muted hover:border-accent/50 hover:text-accent"
        >
          {t('trace.showLess')}
        </button>
      ) : null}
    </section>
  )
}
