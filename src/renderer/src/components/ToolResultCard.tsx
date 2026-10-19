import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  CornerDownRight,
  Maximize2,
  RotateCcw,
  Server,
  FileText,
  X
} from 'lucide-react'
import type { ToolCallView } from '@shared/ui'
import { toolHeadline } from '../lib/tool-labels'
import { useStore } from '../store'
import Modal from './ui/Modal'

/**
 * How many leading output lines the collapsed card shows (U3-2).
 *
 * A shell result is the one tool output that is routinely hundreds of lines long. The
 * inline level answers "did it work and what did it say first"; the full output is a
 * deliberate step away, not something to scroll past in the transcript.
 */
const PREVIEW_LINES = 3

/**
 * Inline card in the chat for a tool call (v2.4.1; rich detail in v2.5.2).
 *
 * U3-2: three display levels, the same progressive disclosure the trace uses —
 *
 *   inline    the headline, the outcome, the exit code, plus the first few output lines
 *             and "N more lines" when the output is long;
 *   expanded  the whole output, in place, with its own scroll;
 *   full screen  the output in a dialog with its own scroll and a copy action.
 *
 * The third level is only offered for a long output: a one-line result is already
 * whole at level two, and a full-screen button that revealed nothing new would be an
 * interface for a capability that does not exist.
 */
export default function ToolResultCard(props: ToolCallView): JSX.Element {
  const { t } = useTranslation()
  // v2.6.3 T1.3: failed cards open by default so the error is visible at a glance,
  // while successes stay a single compact line.
  const [open, setOpen] = useState(!props.ok)
  const [fullScreen, setFullScreen] = useState(false)
  const [copied, setCopied] = useState(false)

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

  // The output this card is *about*: stdout first (a shell result), stderr as the
  // fallback so a failed command with no stdout is still readable in full.
  const outputText = [stdout, stderr]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join('\n')
  const outputLines = outputText.length > 0 ? outputText.split('\n') : []
  const longOutput = outputLines.length > PREVIEW_LINES
  const hiddenLines = longOutput ? outputLines.length - PREVIEW_LINES : 0
  const preview = longOutput ? outputLines.slice(0, PREVIEW_LINES).join('\n') : ''

  const toggle = (): void => {
    if (hasBody) setOpen((value) => !value)
  }

  const copyOutput = async (): Promise<void> => {
    const clipboard = navigator.clipboard
    if (!clipboard?.writeText) {
      // U-5: a copy that cannot happen says so instead of looking like it worked.
      useStore.getState().pushToast('error', t('toast.copyFailed'))
      return
    }
    try {
      await clipboard.writeText(outputText)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      useStore.getState().pushToast('error', t('toast.copyFailed'))
    }
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
        {/*
          The headline is a sentence ("Ran a command on the server"), so it resolves its own
          direction; the command preview next to it stays LTR like the rest of the card.
        */}
        <span dir="auto" className="shrink-0 text-[13px] text-fg" title={raw ?? name}>
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

      {/*
        U3-2 level 1: the first lines of a long output, and how much is left. It is the
        same content the expanded body shows, cut short, so the reader can tell "this
        printed a table" from "this printed one line" without opening anything.
      */}
      {!open && longOutput ? (
        <div
          data-testid="tool-card-output-preview"
          dir="ltr"
          className="border-t border-border px-2.5 py-1"
        >
          <pre className="overflow-hidden whitespace-pre-wrap font-mono text-2xs leading-snug text-fg-muted">
            {preview}
          </pre>
          <span
            data-testid="tool-card-more-lines"
            className="mt-0.5 block font-mono text-3xs text-fg-subtle"
          >
            {t('disclosure.moreLines', { count: hiddenLines })}
          </span>
        </div>
      ) : null}

      {open && hasBody ? (
        /*
         * The body is where free text lives (an error cause, tool output, a legacy detail) and it
         * may be Persian, so it resolves its own direction instead of inheriting the card's LTR —
         * while every command and path inside keeps an explicit `dir="ltr"` of its own.
         */
        <div
          data-testid="tool-card-body"
          dir="auto"
          className="flex flex-col gap-2 border-t border-border px-3 py-2"
        >
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
                  {t('chat.toolServer')}:{' '}
                  <span dir="ltr" className="font-mono text-fg">
                    {serverId}
                  </span>
                </span>
              ) : null}
              {cwd ? (
                <span className="flex items-center gap-1">
                  <CornerDownRight className="h-3 w-3 shrink-0" />
                  {t('chat.toolCwd')}:{' '}
                  <span dir="ltr" className="font-mono text-fg">
                    {cwd}
                  </span>
                </span>
              ) : null}
              {command && path ? (
                <span className="flex items-center gap-1">
                  <FileText className="h-3 w-3 shrink-0" />
                  {t('chat.toolPath')}:{' '}
                  <span dir="ltr" className="font-mono text-fg">
                    {path}
                  </span>
                </span>
              ) : null}
            </div>
          ) : null}

          {stdout ? (
            <div>
              <div className="mb-0.5 flex items-center justify-between gap-2">
                <p className="text-3xs uppercase tracking-wide text-fg-muted">
                  {t('chat.toolStdout')}
                </p>
                {longOutput ? (
                  <button
                    type="button"
                    data-testid="tool-card-fullscreen"
                    onClick={() => setFullScreen(true)}
                    className="flex shrink-0 items-center gap-1 rounded border border-border px-1.5 py-0.5 text-3xs text-fg-muted hover:border-accent hover:text-accent"
                  >
                    <Maximize2 className="h-3 w-3 shrink-0" />
                    {t('disclosure.fullScreen')}
                  </button>
                ) : null}
              </div>
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

      {/*
        U3-2 level 3: the whole output, in a dialog that owns the viewport. The body is
        `min-h-0 flex-1 overflow-auto`, so the output scrolls inside the dialog instead of
        stretching it, and the header stays reachable for the close and copy actions.
      */}
      <Modal
        open={fullScreen && longOutput}
        onClose={() => setFullScreen(false)}
        maxWidth="min(64rem, 92vw)"
        maxHeight="calc(100vh - 3rem)"
        ariaLabel={`${headline} — ${t('disclosure.outputTitle')}`}
        closeOnBackdrop
      >
        <div data-testid="tool-output-dialog" className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
            <StatusIcon className={`h-3.5 w-3.5 shrink-0 ${ok ? 'text-success' : 'text-danger'}`} />
            <span dir="auto" className="min-w-0 flex-1 truncate text-xs text-fg">
              {headline}
            </span>
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
            <button
              type="button"
              data-testid="tool-output-copy"
              onClick={() => void copyOutput()}
              className="flex shrink-0 items-center gap-1 rounded border border-border px-2 py-0.5 text-3xs text-fg hover:border-accent hover:text-accent"
            >
              {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
              {copied ? t('chat.copied') : t('chat.copy')}
            </button>
            <button
              type="button"
              onClick={() => setFullScreen(false)}
              aria-label={t('common.close')}
              className="shrink-0 rounded p-1 text-fg-muted hover:bg-bg-tertiary hover:text-fg"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {/*
            The output is a command result, never prose: it keeps its own LTR direction and
            its own scroll, so a Persian error line inside it cannot flip a table.
          */}
          <div data-testid="tool-output-text" className="min-h-0 flex-1 overflow-auto bg-bg-primary px-3 py-2">
            <pre dir="ltr" className="whitespace-pre-wrap font-mono text-2xs leading-relaxed text-fg">
              {outputText}
            </pre>
          </div>
        </div>
      </Modal>
    </div>
  )
}
