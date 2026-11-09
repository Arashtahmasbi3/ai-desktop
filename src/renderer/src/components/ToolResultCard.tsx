import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  CornerDownRight,
  Maximize2,
  RotateCcw,
  Server,
  ShieldAlert,
  FileText,
  X
} from 'lucide-react'
import type { ToolCallView } from '@shared/ui'
import { toolHeadline } from '../lib/tool-labels'
import { firstLineOf, isSuccessOutcome, toolOutcome } from '../lib/tool-outcome'
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
  // X9: any state that is not a clean success opens, so a failed exit is visible at a glance.
  const [open, setOpen] = useState(toolOutcome(props) !== 'ok')
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

  /*
   * X9: what the card may claim comes from the result, not from its `ok` flag alone. `ok` can be
   * true while the command exited non-zero, and an approval refusal is neither a success nor a
   * failure — it never ran. One pure helper decides between the four states.
   */
  const outcome = toolOutcome({ code, ok, exitCode, stderr })
  const succeeded = isSuccessOutcome(outcome)
  const StatusIcon =
    outcome === 'failed' ? AlertCircle : outcome === 'blocked' ? ShieldAlert : CheckCircle2
  const statusTone = succeeded
    ? 'text-success'
    : outcome === 'blocked'
      ? 'text-warning'
      : 'text-danger'
  const statusLabel =
    outcome === 'blocked'
      ? t('chat.toolBlocked')
      : outcome === 'failed'
        ? t('chat.toolError')
        : t('chat.toolOk')
  const stderrWarn = outcome === 'warning'
  // A failed command carries its reason on the collapsed row, not only inside the body.
  const stderrLine = outcome === 'failed' ? firstLineOf(stderr) : undefined
  const failureText = stderrLine ?? (outcome === 'failed' ? firstLineOf(error) : undefined)
  const failureLabel = stderrLine !== undefined ? t('chat.toolStderr') : t('chat.toolError')
  const exitTone =
    exitCode === 0
      ? 'bg-success/10 text-success'
      : outcome === 'blocked'
        ? 'bg-warning/10 text-warning'
        : 'bg-danger/10 text-danger'
  // `blocked` is already the state word, so the code chip would say it twice.
  const showCode = code !== undefined && !(code === 'blocked' && outcome === 'blocked')
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
      className={`ui-card flex max-w-[min(52rem,88%)] flex-col overflow-hidden ${
        succeeded ? '' : outcome === 'blocked' ? 'border border-warning/40' : 'border border-danger/40'
      }`}
      dir="ltr"
    >
      <button
        type="button"
        onClick={toggle}
        data-testid="tool-card-header"
        className="flex h-8 w-full items-center gap-2 px-2.5 text-left"
        aria-expanded={open}
        aria-label={`${headline} ${statusLabel}`}
      >
        <StatusIcon className={`h-3.5 w-3.5 shrink-0 ${statusTone}`} />
        {/*
          The headline is a sentence ("Ran a command on the server"), so it resolves its own
          direction; the command preview next to it stays LTR like the rest of the card.
        */}
        <span dir="auto" className="shrink-0 text-[13px] text-fg" title={raw ?? name}>
          {headline}
        </span>
        {/*
          X9: the state word, the tone and the icon all come from `toolOutcome`, so a non-zero exit
          can never render as a green "ok" — not even when the result arrived with `ok: true`.
        */}
        <span data-testid="tool-card-state" className={`shrink-0 text-3xs ${statusTone}`}>
          {statusLabel}
        </span>
        {stderrWarn ? (
          /* A command that exited 0 but wrote to stderr succeeded *with warnings*: it keeps "ok"
             and gains this marker, instead of being reported as a failure it was not. */
          <span
            data-testid="tool-card-stderr"
            className="flex shrink-0 items-center gap-0.5 text-3xs text-warning"
            title={t('chat.toolStderrWarnHint')}
          >
            <AlertTriangle className="h-3 w-3 shrink-0" />
            {t('chat.toolStderr')}
          </span>
        ) : null}
        {shortDetail ? (
          <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-fg-muted" title={raw}>
            {shortDetail}
          </span>
        ) : (
          <span className="flex-1" />
        )}
        {showCode ? (
          <span className="shrink-0 rounded bg-bg-primary px-1 font-mono text-3xs text-fg-muted">
            {code}
          </span>
        ) : null}
        {failureText ? (
          /* What happened, on the collapsed row: the exit code sits beside this, and the reason is
             the first line of stderr (or of the cause) — `max-w` keeps it from crowding the row. */
          <span
            data-testid="tool-card-outcome"
            className="max-w-[45%] shrink-0 truncate font-mono text-3xs text-danger"
            title={`${failureLabel}: ${failureText}`}
          >
            {failureLabel}: {failureText}
          </span>
        ) : null}
        {exitCode !== undefined ? (
          <span
            data-testid="tool-card-exit"
            className={`shrink-0 rounded px-1 font-mono text-3xs ${exitTone}`}
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
              <p className="mb-0.5 text-3xs text-danger">
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
              <p className="mb-0.5 text-3xs text-fg-muted">
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
                <p className="text-3xs text-fg-muted">
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
              <p className="mb-0.5 text-3xs text-warning">
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
            <StatusIcon className={`h-3.5 w-3.5 shrink-0 ${statusTone}`} />
            <span dir="auto" className="min-w-0 flex-1 truncate text-xs text-fg">
              {headline}
            </span>
            {exitCode !== undefined ? (
              <span
                className={`shrink-0 rounded px-1 font-mono text-3xs ${exitTone}`}
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
