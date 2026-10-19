import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react'
import type { ChatMessage } from '../store'
import { isCommandTool } from '../lib/tool-rows'
import ToolResultCard from './ToolResultCard'

export interface ToolGroupRowProps {
  tool: string
  messages: ChatMessage[]
  outcome: 'ok' | 'warning'
  durationMs: number
  serverId?: string
  /** The server's display name, resolved by the caller from the roster. */
  serverName?: string
}

/** `12345` -> `12.3s`; a group's duration is the sum of its measured calls. */
function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return ''
  return `${(ms / 1000).toFixed(1)}s`
}

/**
 * One row for several consecutive calls to the same tool (v4.3).
 *
 * `4 commands on spmotor · 12.3s · all ok` — collapsed, it is a single line, and the individual
 * cards are one click away. The group is only ever built from calls that all succeeded (see
 * `groupToolRows`): a failed or blocked call is rendered as its own row, so the words "all ok"
 * cannot appear above something that was not.
 *
 * The three facts a reader wants from a run of tools, in the order they want them: **how many**,
 * **where**, **how long**, **did anything go wrong**. Nothing else is on the row.
 */
export default function ToolGroupRow({
  tool,
  messages,
  outcome,
  durationMs,
  serverId,
  serverName
}: ToolGroupRowProps): JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const count = messages.length
  const commands = isCommandTool(tool)
  const where = serverName ?? serverId
  const duration = formatDuration(durationMs)

  const summary = commands
    ? t('chat.toolGroupCommands', {
        count,
        defaultValue: count === 1 ? '{{count}} command' : '{{count}} commands'
      })
    : t('chat.toolGroup', {
        count,
        defaultValue: count === 1 ? '{{count}} call' : '{{count}} calls'
      })

  const outcomeLabel =
    outcome === 'warning'
      ? t('chat.toolGroupWarning', { defaultValue: 'with warnings' })
      : t('chat.toolGroupAllOk', { defaultValue: 'all ok' })

  return (
    <div className="flex justify-start px-4" dir="auto">
      <div
        data-testid="tool-group-row"
        data-tool={tool}
        data-count={count}
        data-outcome={outcome}
        className="w-full max-w-[min(52rem,88%)] overflow-hidden rounded-shape border border-border bg-bg-elevated"
      >
        <button
          type="button"
          data-testid="tool-group-toggle"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-label={t('chat.toolGroupExpand', {
            count,
            defaultValue: 'Show the {{count}} calls'
          })}
          className="ui-row w-full gap-2 px-2.5 text-left text-xs text-fg"
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
          )}
          <span data-testid="tool-group-summary" className="shrink-0 text-fg">
            {summary}
          </span>
          {where ? (
            <span className="min-w-0 shrink truncate font-mono text-3xs text-fg-subtle" dir="ltr">
              {t('chat.toolGroupServer', { server: where, defaultValue: 'on {{server}}' })}
            </span>
          ) : null}
          {duration ? (
            <span data-testid="tool-group-duration" className="shrink-0 text-3xs text-fg-subtle">
              · {duration}
            </span>
          ) : null}
          <span
            data-testid="tool-group-outcome"
            className="ms-auto flex shrink-0 items-center gap-1"
          >
            {outcome === 'warning' ? (
              <AlertTriangle className="h-3 w-3 text-warning" />
            ) : (
              <CheckCircle2 className="h-3 w-3 text-success" />
            )}
            <span className="text-3xs text-fg-muted">{outcomeLabel}</span>
          </span>
        </button>

        {open ? (
          <div
            data-testid="tool-group-list"
            className="flex flex-col gap-1 border-t border-border p-1.5"
          >
            {messages.map((message) =>
              message.toolCall ? (
                <ToolResultCard key={message.id} {...message.toolCall} />
              ) : null
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
