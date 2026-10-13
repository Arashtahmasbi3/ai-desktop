import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  RotateCcw,
  Server,
  FileText
} from 'lucide-react'
import type { ToolCallView } from '@shared/ui'

/** Inline card in the chat for a tool call (v2.4.1; rich detail in v2.5.2). */
export default function ToolResultCard(props: ToolCallView): JSX.Element {
  const { t } = useTranslation()
  // v2.6.3 T1.3: failed cards open by default so the error is visible at a glance,
  // while successes stay a single compact line.
  const [open, setOpen] = useState(!props.ok)

  const {
    name,
    ok,
    code,
    detail,
    error,
    command,
    serverId,
    cwd,
    path,
    stdout,
    stderr,
    exitCode,
    durationMs,
    attempts,
    recovery
  } = props

  const StatusIcon = ok ? CheckCircle2 : AlertCircle
  // `detail` duplicates `error` when the event carried a technical cause.
  const legacyDetail = detail && detail !== error ? detail : undefined
  const primary = command ?? path
  const hasBody = Boolean(
    legacyDetail || error || stdout || stderr || serverId || cwd || recovery
  )

  const seconds = durationMs !== undefined ? `${(durationMs / 1000).toFixed(2)}s` : undefined

  const toggle = (): void => {
    if (hasBody) setOpen((value) => !value)
  }

  return (
    <div
      className={`flex max-w-[min(52rem,88%)] flex-col overflow-hidden rounded-xl border bg-bg-secondary ${
        ok ? 'border-border' : 'border-red-500/40'
      }`}
      dir="ltr"
    >
      <button
        type="button"
        onClick={toggle}
        data-testid="tool-card-header"
        className="flex w-full items-center gap-2 px-2.5 py-1 text-left"
        aria-expanded={open}
        aria-label={`${name} ${ok ? 'ok' : 'error'}`}
      >
        <StatusIcon
          className={`h-3.5 w-3.5 shrink-0 ${ok ? 'text-emerald-400' : 'text-red-400'}`}
        />
        <span className="shrink-0 font-mono text-[13px] text-neutral-200">{name}</span>
        <span className={`shrink-0 text-[10px] ${ok ? 'text-emerald-400' : 'text-red-400'}`}>
          {ok ? t('chat.toolOk') : t('chat.toolError')}
        </span>
        {primary ? (
          <span
            className="min-w-0 flex-1 truncate font-mono text-[13px] text-neutral-500"
            title={primary}
          >
            {primary}
          </span>
        ) : (
          <span className="flex-1" />
        )}
        {code ? (
          <span className="shrink-0 rounded bg-bg-primary px-1 font-mono text-[10px] text-neutral-500">
            {code}
          </span>
        ) : null}
        {exitCode !== undefined ? (
          <span
            className={`shrink-0 rounded px-1 font-mono text-[10px] ${
              exitCode === 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
            }`}
            title={t('chat.toolExit')}
          >
            exit {exitCode}
          </span>
        ) : null}
        {seconds ? <span className="shrink-0 text-[10px] text-neutral-600">{seconds}</span> : null}
        {hasBody ? (
          <span className="shrink-0 text-neutral-500">
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </span>
        ) : null}
      </button>

      {open && hasBody ? (
        <div className="flex flex-col gap-2 border-t border-border px-3 py-2">
          {error ? (
            <div>
              <p className="mb-0.5 text-[10px] uppercase tracking-wide text-red-400">
                {t('chat.toolCause')}
              </p>
              <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-red-300">
                {error}
              </pre>
            </div>
          ) : null}

          {recovery ? (
            <p className="flex items-center gap-1 text-[11px] text-neutral-400">
              <RotateCcw className="h-3 w-3 shrink-0" />
              {recovery.decision === 'retry'
                ? recovery.recovered
                  ? t('chat.toolRecovered', { count: recovery.attempts })
                  : t('chat.toolRetryFailed', { count: recovery.attempts })
                : t('chat.toolNoRetry')}
            </p>
          ) : null}

          {serverId || cwd || (command && path) ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-neutral-400">
              {serverId ? (
                <span className="flex items-center gap-1">
                  <Server className="h-3 w-3 shrink-0 text-sky-400" />
                  {t('chat.toolServer')}: <span className="font-mono text-neutral-300">{serverId}</span>
                </span>
              ) : null}
              {cwd ? (
                <span className="flex items-center gap-1">
                  <CornerDownRight className="h-3 w-3 shrink-0" />
                  {t('chat.toolCwd')}: <span className="font-mono text-neutral-300">{cwd}</span>
                </span>
              ) : null}
              {command && path ? (
                <span className="flex items-center gap-1">
                  <FileText className="h-3 w-3 shrink-0" />
                  {t('chat.toolPath')}: <span className="font-mono text-neutral-300">{path}</span>
                </span>
              ) : null}
            </div>
          ) : null}

          {stdout ? (
            <div>
              <p className="mb-0.5 text-[10px] uppercase tracking-wide text-neutral-500">
                {t('chat.toolStdout')}
              </p>
              <pre className="max-h-56 overflow-auto rounded bg-bg-primary px-2 py-1.5 font-mono text-[11px] whitespace-pre-wrap text-neutral-300">
                {stdout}
              </pre>
            </div>
          ) : null}

          {stderr ? (
            <div>
              <p className="mb-0.5 text-[10px] uppercase tracking-wide text-amber-400">
                {t('chat.toolStderr')}
              </p>
              <pre className="max-h-40 overflow-auto rounded bg-bg-primary px-2 py-1.5 font-mono text-[11px] whitespace-pre-wrap text-amber-200/90">
                {stderr}
              </pre>
            </div>
          ) : null}

          {attempts !== undefined && attempts > 1 ? (
            <p className="text-[10px] text-neutral-500">{t('chat.toolAttempts', { count: attempts })}</p>
          ) : null}

          {legacyDetail ? (
            <pre className="max-h-48 overflow-auto font-mono text-[11px] whitespace-pre-wrap text-neutral-400">
              {legacyDetail}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
