import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { useStore } from '../store'
import { toolHeadline } from '../lib/tool-labels'
import type { ToolCallView } from '@shared/ui'

function OutputEntry({ call }: { call: ToolCallView }): JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(call.ok === false || Boolean(call.stderr))
  const StatusIcon = call.ok ? CheckCircle2 : AlertCircle
  // v2.8.1: the row names the work and shows a short stage, not the whole pipeline.
  const { headline, detail, raw } = toolHeadline(call, t)
  const label = detail ?? headline
  const hasBody = Boolean(call.stdout || call.stderr || call.error || call.command)

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-bg-primary">
      <button
        type="button"
        onClick={() => hasBody && setOpen((value) => !value)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-2xs"
      >
        {hasBody ? (
          open ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-fg-subtle" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-fg-subtle" />
          )
        ) : (
          <span className="w-3" />
        )}
        <StatusIcon
          className={`h-3.5 w-3.5 shrink-0 ${call.ok ? 'text-success' : 'text-danger'}`}
        />
        <code className="min-w-0 flex-1 truncate font-mono text-fg" dir="ltr" title={raw ?? call.name}>
          {label}
        </code>
        {call.exitCode !== undefined ? (
          <span className={`shrink-0 font-mono ${call.exitCode === 0 ? 'text-success' : 'text-danger'}`}>
            {t('workspace.exit', { code: call.exitCode })}
          </span>
        ) : null}
      </button>
      {open && hasBody ? (
        <pre className="max-h-56 overflow-auto border-t border-border bg-black/40 p-2 text-3xs leading-relaxed">
          {/* v2.8.1: the header preview is truncated; the real command is here. */}
          {call.command ? (
            <code
              dir="ltr"
              data-testid="output-raw-command"
              className="mb-1 block whitespace-pre-wrap text-fg-muted"
            >
              {call.command}
            </code>
          ) : null}
          {call.stdout ? (
            <code dir="ltr" className="block whitespace-pre-wrap text-fg">
              {call.stdout}
            </code>
          ) : null}
          {call.stderr ? (
            <code dir="ltr" className="block whitespace-pre-wrap text-danger">
              {call.stderr}
            </code>
          ) : null}
          {call.error && !call.stderr ? (
            <code dir="ltr" className="block whitespace-pre-wrap text-danger">
              {call.error}
            </code>
          ) : null}
        </pre>
      ) : null}
    </div>
  )
}

/** Chronological tool output for the active chat (v2.6.0, B.4). */
export default function OutputFeed(): JSX.Element {
  const { t } = useTranslation()
  const messages = useStore((state) => state.messages)
  const running = useStore((state) => state.running)
  const calls = messages.flatMap((message) =>
    message.role === 'tool' && message.toolCall ? [message.toolCall] : []
  )

  if (calls.length === 0 && !running) {
    return <p className="text-xs text-fg-subtle">{t('workspace.outputEmpty')}</p>
  }

  return (
    <div className="flex flex-col gap-2">
      {running ? (
        <div className="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent-solid/10 px-2 py-1.5 text-2xs text-accent">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t('workspace.running')}
        </div>
      ) : null}
      {calls.map((call, index) => (
        <OutputEntry key={`${call.name}-${index}`} call={call} />
      ))}
    </div>
  )
}
