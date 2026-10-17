import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertOctagon,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  CornerDownRight,
  HelpCircle,
  Lightbulb,
  RotateCcw,
  Server,
  Terminal,
  XOctagon
} from 'lucide-react'
import type { LoopStopInfo } from '@shared/agent'
import { buildLoopStopModel, type LoopStopAction } from '../lib/loop-stop'
import { summarizeCommand, truncateMiddle } from '../lib/tool-labels'

interface Props {
  stop: LoopStopInfo
  onContinue: () => void
  onCorrect: () => void
  onStop: () => void
}

/**
 * Shown when a run stops itself (v2.5.2, rebuilt in v4.1).
 *
 * The old card had two problems that made it feel like a dead end:
 *
 *  - Its heading was hard-coded to "The agent paused to avoid a loop", even when the cause was a clock, so a
 *    user read "loop" and went looking for a repetition that had never happened.
 *  - Its explanation was a generic "I got stuck". The app knew which tool failed and why, and said none of it,
 *    so the only way forward was to ask a human.
 *
 * It now leads with a deterministic verdict — what happened, the observations that prove it, and one next step.
 * When the agent was simply waiting on a question, it asks the question instead of calling it a fault.
 */
export default function LoopStopCard({ stop, onContinue, onCorrect, onStop }: Props): JSX.Element {
  const { t } = useTranslation()
  const model = buildLoopStopModel(stop)
  const [showRecent, setShowRecent] = useState(false)
  const [copied, setCopied] = useState(false)
  const emphasisClass = (action: LoopStopAction): string =>
    model.emphasis === action ? 'ring-2 ring-warning/70' : ''
  const isQuestion = model.kind === 'question'

  const copyCommand = async (command: string): Promise<void> => {
    try {
      await navigator.clipboard?.writeText(command)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div
      data-testid="loop-stop-card"
      data-kind={model.kind}
      className="mx-4 rounded-shape border-2 border-warning bg-warning/10 p-3 text-start"
    >
      <div className="flex items-start gap-2">
        {isQuestion ? (
          <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        ) : (
          <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        )}
        <div className="min-w-0 flex-1">
          <p className="brutal-label text-warning">{t(model.titleKey)}</p>

          {isQuestion ? (
            <div data-testid="loop-stop-question" className="mt-1">
              <p dir="auto" className="text-sm leading-relaxed text-fg">
                {model.question}
              </p>
              <p className="mt-1 flex items-start gap-1 text-3xs text-fg-muted">
                <HelpCircle className="mt-0.5 h-3 w-3 shrink-0" />
                {t(model.hintKey)}
              </p>
            </div>
          ) : (
            <>
              <p dir="auto" className="mt-1 text-2xs leading-relaxed text-fg-muted">
                {stop.message}
              </p>
              {/* The hint says what to try; the verdict below says what happened. Both are needed. */}
              <p className="mt-1 flex items-start gap-1 text-2xs leading-relaxed text-fg-muted">
                <Lightbulb className="mt-0.5 h-3 w-3 shrink-0 text-warning" />
                {t(model.hintKey)}
              </p>
            </>
          )}

          {/* The verdict: what happened, the evidence, and one next step (v4.1). */}
          {model.verdict ? (
            <div data-testid="loop-stop-verdict" className="mt-2 border-t-2 border-warning/40 pt-2">
              <p className="brutal-label">{t('chat.verdictTitle')}</p>
              <p dir="auto" className="mt-0.5 text-2xs leading-relaxed text-fg">
                {t(model.verdict.textKey, model.verdict.params ?? {})}
              </p>
              {model.verdict.evidence.length > 0 ? (
                <ul className="mt-1 flex flex-col gap-0.5">
                  {model.verdict.evidence.map((item, index) => (
                    <li
                      key={`${item.textKey}-${index}`}
                      dir="auto"
                      className="text-3xs leading-relaxed text-fg-muted"
                    >
                      <CornerDownRight className="mr-1 inline h-3 w-3" />
                      {t(item.textKey, item.params ?? {})}
                    </li>
                  ))}
                </ul>
              ) : null}
              {model.verdict.actionKey ? (
                <>
                  <p className="brutal-label mt-2">{t('chat.verdictNext')}</p>
                  <p dir="auto" className="mt-0.5 text-2xs leading-relaxed text-fg">
                    {t(model.verdict.actionKey)}
                  </p>
                </>
              ) : null}
              {model.verdict.actionCommand ? (
                <div className="mt-1 flex min-w-0 items-start gap-1">
                  <code
                    dir="ltr"
                    className="min-w-0 flex-1 break-all rounded-shape-sm border border-border bg-bg-primary px-1.5 py-1 font-mono text-3xs text-fg"
                  >
                    {model.verdict.actionCommand}
                  </code>
                  <button
                    type="button"
                    onClick={() => void copyCommand(model.verdict?.actionCommand ?? '')}
                    className="brutal-btn shrink-0 px-1.5 py-1 text-3xs"
                    aria-label={t('chat.copy')}
                  >
                    {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          <div data-testid="loop-stop-actions" className="mt-2 flex flex-wrap gap-2">
            {isQuestion ? (
              <button
                type="button"
                onClick={onStop}
                className="brutal-btn flex items-center gap-1 whitespace-nowrap px-2.5 py-1 text-2xs"
              >
                <XOctagon className="h-3 w-3" />
                {t('chat.loopStopStop')}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onContinue}
                  disabled={!model.allowContinue}
                  className={`brutal-primary flex items-center gap-1 whitespace-nowrap px-2.5 py-1 text-2xs font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${emphasisClass('continue')}`}
                >
                  <RotateCcw className="h-3 w-3" />
                  {t('chat.loopStopContinue')}
                </button>
                <button
                  type="button"
                  onClick={onCorrect}
                  className={`brutal-btn flex items-center gap-1 whitespace-nowrap px-2.5 py-1 text-2xs ${emphasisClass('correct')}`}
                >
                  <CornerDownRight className="h-3 w-3" />
                  {t('chat.loopStopCorrect')}
                </button>
                <button
                  type="button"
                  onClick={onStop}
                  className={`brutal-btn flex items-center gap-1 whitespace-nowrap px-2.5 py-1 text-2xs ${emphasisClass('stop')}`}
                >
                  <XOctagon className="h-3 w-3" />
                  {t('chat.loopStopStop')}
                </button>
              </>
            )}
          </div>

          {model.lastAction && !isQuestion ? (
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-3xs text-fg-muted">
              <span className="brutal-label">{t('chat.loopStopStuckOn')}</span>
              {model.onRemote ? (
                <span className="brutal-chip flex items-center gap-1 px-1 py-0.5">
                  <Server className="h-3 w-3" />
                  {t('chat.loopStopRemote')}
                  {model.serverId ? <span className="font-mono">{model.serverId}</span> : null}
                </span>
              ) : (
                <Terminal className="h-3 w-3" />
              )}
              <code
                className="min-w-0 flex-1 truncate font-mono"
                dir="ltr"
                title={model.lastCommand ?? model.lastAction}
              >
                {summarizeCommand(model.lastCommand ?? model.lastAction ?? '')}
              </code>
            </div>
          ) : null}

          {stop.recentActions.length > 0 && !isQuestion ? (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setShowRecent((value) => !value)}
                aria-expanded={showRecent}
                className="flex items-center gap-1 text-3xs uppercase tracking-label text-fg-muted hover:text-fg"
              >
                {showRecent ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                {t('chat.loopStopRecent')} ({stop.recentActions.length})
              </button>
              {showRecent ? (
                <ul className="mt-1 flex flex-col gap-0.5">
                  {stop.recentActions.map((action, index) => (
                    <li
                      key={`${action}-${index}`}
                      dir="ltr"
                      className="truncate font-mono text-3xs text-fg-muted"
                      title={action}
                    >
                      <CornerDownRight className="mr-1 inline h-3 w-3" />
                      {truncateMiddle(action, 96)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
