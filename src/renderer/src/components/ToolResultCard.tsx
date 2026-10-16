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
import { toolHeadline } from '../lib/tool-labels'

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
  // v2.8.1: the header names the work ("Ran a command on the server") instead of
  // printing the raw tool id above a whole pipeline. The raw command and the exact
  // tool name stay in the expanded body (`raw` feeds the tooltip meanwhile).
  const { headline, detail: shortDetail, raw } = toolHeadline(
    { name, ok, command, path, serverId },
    t
  )
  const hasBody = Boolean(
    legacyDetail || error || stdout || stderr || serverId || cwd || recovery || command || path
  )

  const seconds = durationMs !== undefined ? `${(durationMs / 1000).toFixed(2)}s` : undefined

  const toggle = (): void => {
    if (hasBody) setOpen((value) => !value)
  }

  return (
    <div
      className={`brutal-card flex max-w-[min(52rem,88%)] flex-col overflow-hidden ${
        ok ? '' : 'border border-danger/40'
      }`}
      dir="ltr"
    >
      <button
        type="button"
        onClick={toggle}
        data-testid="tool-card-header"
        className="flex w-full items-center gap-2 px-2.5 py-1 text-left"
        aria-expanded={open}
        aria-label={`${headline} ${ok ? 'ok' : 'error'}`}
      >
        <StatusIcon
          className={`h-3.5 w-3.5 shrink-0 ${ok ? 'text-success' : 'text-danger'}`}
        />
        <span className="shrink-0 text-[13px] text-fg" title={raw ?? name}>
          {headline}
        </span>
        <span className={`shrink-0 text-3xs ${ok ? 'text-success' : 'text-danger'}`}>
          {ok ? t('chat.toolOk') : t('chat.toolError')}
        </span>
        {shortDetail ? (
          <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-fg-muted" title={raw}>
            {shortDetail}
          </span>
        ) : (
          <span className="flex-1" />
        )}
        {code ? (
          <span className="shrink-0 rounded bg-bg-primary px-1 font-mono text-3xs text-fg-muted">
            {code}
          </span>
        ) : null}
        {exitCode !== undefined ? (
          <span
            className={`shrink-0 rounded px-1 font-mono text-3xs ${
              exitCode === 0 ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'
            }`}
            title={t('chat.toolExit')}
          >
            exit {exitCode}
          </span>
        ) : null}
        {seconds ? <span className="shrink-0 text-3xs text-fg-subtle">{seconds}</span> : null}
        {hasBody ? (
          <span className="shrink-0 text-fg-muted">
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </span>
        ) : null}
      </button>

      {open && hasBody ? (
        <div className="flex flex-col gap-2 border-t border-border px-3 py-2">
          {error ? (
            <div>
              <p className="mb-0.5 text-3xs uppercase tracking-wide text-danger">
                {t('chat.toolCause')}
              </p>
              <pre className="whitespace-pre-wrap break-words font-mono text-2xs text-danger">
                {error}
              </pre>
            </div>
          ) : null}

          {recovery ? (
            <p className="flex items-center gap-1 text-2xs text-fg-muted">
              <RotateCcw className="h-3 w-3 shrink-0" />
              {recovery.decision === 'retry'
                ? recovery.recovered
                  ? t('chat.toolRecovered', { count: recovery.attempts })
                  : t('chat.toolRetryFailed', { count: recovery.attempts })
                : t('chat.toolNoRetry')}
            </p>
          ) : null}

          {/* v2.8.1: the exact tool id and the raw command stay one click away, so
              power users lose nothing while the header stays readable. */}
          {name ? (
            <p className="flex items-center gap-1 text-2xs text-fg-muted">
              {t('chat.approvalTool')}:{' '}
              <span className="font-mono text-fg" dir="ltr">
                {name}
              </span>
            </p>
          ) : null}

          {raw ? (
            <div>
              <p className="mb-0.5 text-3xs uppercase tracking-wide text-fg-muted">
                {t('chat.toolRawCommand')}
              </p>
              <pre
                data-testid="tool-card-raw-command"
                dir="ltr"
                className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-bg-primary px-2 py-1.5 font-mono text-2xs text-fg"
              >
                {raw}
              </pre>
            </div>
          ) : null}

          {serverId || cwd || (command && path) ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-2xs text-fg-muted">
              {serverId ? (
                <span className="flex items-center gap-1">
                  <Server className="h-3 w-3 shrink-0 text-info" />
                  {t('chat.toolServer')}: <span className="font-mono text-fg">{serverId}</span>
                </span>
              ) : null}
              {cwd ? (
                <span className="flex items-center gap-1">
                  <CornerDownRight className="h-3 w-3 shrink-0" />
                  {t('chat.toolCwd')}: <span className="font-mono text-fg">{cwd}</span>
                </span>
              ) : null}
              {command && path ? (
                <span className="flex items-center gap-1">
                  <FileText className="h-3 w-3 shrink-0" />
                  {t('chat.toolPath')}: <span className="font-mono text-fg">{path}</span>
                </span>
              ) : null}
            </div>
          ) : null}

          {stdout ? (
            <div>
              <p className="mb-0.5 text-3xs uppercase tracking-wide text-fg-muted">
                {t('chat.toolStdout')}
              </p>
              <pre className="max-h-56 overflow-auto rounded bg-bg-primary px-2 py-1.5 font-mono text-2xs whitespace-pre-wrap text-fg">
                {stdout}
              </pre>
            </div>
          ) : null}

          {stderr ? (
            <div>
              <p className="mb-0.5 text-3xs uppercase tracking-wide text-warning">
                {t('chat.toolStderr')}
              </p>
              <pre className="max-h-40 overflow-auto rounded bg-bg-primary px-2 py-1.5 font-mono text-2xs whitespace-pre-wrap text-warning/90">
                {stderr}
              </pre>
            </div>
          ) : null}

          {attempts !== undefined && attempts > 1 ? (
            <p className="text-3xs text-fg-muted">{t('chat.toolAttempts', { count: attempts })}</p>
          ) : null}

          {legacyDetail ? (
            <pre className="max-h-48 overflow-auto font-mono text-2xs whitespace-pre-wrap text-fg-muted">
              {legacyDetail}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
