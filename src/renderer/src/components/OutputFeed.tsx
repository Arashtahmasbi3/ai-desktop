import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { useStore } from '../store'
import type { ToolCallView } from '@shared/ui'

function OutputEntry({ call }: { call: ToolCallView }): JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(call.ok === false || Boolean(call.stderr))
  const StatusIcon = call.ok ? CheckCircle2 : AlertCircle
  const label = call.command ?? call.path ?? call.name
  const hasBody = Boolean(call.stdout || call.stderr || call.error)

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-bg-primary">
      <button
        type="button"
        onClick={() => hasBody && setOpen((value) => !value)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-[11px]"
      >
        {hasBody ? (
          open ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-neutral-600" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-neutral-600" />
          )
        ) : (
          <span className="w-3" />
        )}
        <StatusIcon
          className={`h-3.5 w-3.5 shrink-0 ${call.ok ? 'text-emerald-400' : 'text-red-400'}`}
        />
        <code className="min-w-0 flex-1 truncate font-mono text-neutral-300" dir="ltr" title={label}>
          {label}
        </code>
        {call.exitCode !== undefined ? (
          <span className={`shrink-0 font-mono ${call.exitCode === 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {t('workspace.exit', { code: call.exitCode })}
          </span>
        ) : null}
      </button>
      {open && hasBody ? (
        <pre className="max-h-56 overflow-auto border-t border-border bg-black/40 p-2 text-[10px] leading-relaxed">
          {call.stdout ? (
            <code dir="ltr" className="block whitespace-pre-wrap text-neutral-300">
              {call.stdout}
            </code>
          ) : null}
          {call.stderr ? (
            <code dir="ltr" className="block whitespace-pre-wrap text-red-400">
              {call.stderr}
            </code>
          ) : null}
          {call.error && !call.stderr ? (
            <code dir="ltr" className="block whitespace-pre-wrap text-red-400">
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
    return <p className="text-xs text-neutral-600">{t('workspace.outputEmpty')}</p>
  }

  return (
    <div className="flex flex-col gap-2">
      {running ? (
        <div className="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/10 px-2 py-1.5 text-[11px] text-accent">
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
