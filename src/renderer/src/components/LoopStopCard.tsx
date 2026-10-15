import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertOctagon,
  ChevronDown,
  ChevronRight,
  CornerDownRight,
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
 * Shown when the agent stops itself to break a loop. Gives the user three
 * concrete next moves instead of leaving the run silently paused, and tailors
 * the hint + highlighted action to why the run got stuck (v2.5.2).
 */
export default function LoopStopCard({ stop, onContinue, onCorrect, onStop }: Props): JSX.Element {
  const { t } = useTranslation()
  const model = buildLoopStopModel(stop)
  const [showRecent, setShowRecent] = useState(false)
  const emphasisClass = (action: LoopStopAction): string =>
    model.emphasis === action ? 'ring-2 ring-warning/70' : ''

  return (
    <div className="mx-4 rounded-xl border border-warning/40 bg-warning/10 p-3 text-start">
      <div className="flex items-start gap-2">
        <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-warning">{t('chat.loopStopTitle')}</p>
          <p className="mt-1 text-2xs leading-relaxed text-warning/90">{stop.message}</p>
          <p className="mt-1 flex items-start gap-1 text-2xs leading-relaxed text-warning/90">
            <Lightbulb className="mt-0.5 h-3 w-3 shrink-0" />
            {t(model.hintKey)}
          </p>

          {/* Actions sit directly under the hint so a long list of recent
              actions can never push them out of view. */}
          <div data-testid="loop-stop-actions" className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onContinue}
              disabled={!model.allowContinue}
              className={`flex items-center gap-1 whitespace-nowrap rounded-lg bg-accent-solid px-2.5 py-1 text-2xs font-medium text-white hover:bg-accent-solid-hover disabled:cursor-not-allowed disabled:opacity-40 ${emphasisClass('continue')}`}
            >
              <RotateCcw className="h-3 w-3" />
              {t('chat.loopStopContinue')}
            </button>
            <button
              type="button"
              onClick={onCorrect}
              className={`flex items-center gap-1 whitespace-nowrap rounded-lg border border-border px-2.5 py-1 text-2xs text-fg hover:bg-bg-tertiary ${emphasisClass('correct')}`}
            >
              <CornerDownRight className="h-3 w-3" />
              {t('chat.loopStopCorrect')}
            </button>
            <button
              type="button"
              onClick={onStop}
              className={`flex items-center gap-1 whitespace-nowrap rounded-lg border border-border px-2.5 py-1 text-2xs text-fg hover:bg-bg-tertiary ${emphasisClass('stop')}`}
            >
              <XOctagon className="h-3 w-3" />
              {t('chat.loopStopStop')}
            </button>
          </div>

          {model.lastAction ? (
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-3xs text-warning/80">
              <span className="uppercase tracking-wide text-warning/70">
                {t('chat.loopStopStuckOn')}
              </span>
              {model.onRemote ? (
                <span className="flex items-center gap-1 rounded bg-warning/20 px-1 py-0.5">
                  <Server className="h-3 w-3" />
                  {t('chat.loopStopRemote')}
                  {model.serverId ? <span className="font-mono">{model.serverId}</span> : null}
                </span>
              ) : (
                <Terminal className="h-3 w-3" />
              )}
              {/* v2.8.1: one readable stage, with the full action on hover. */}
              <code
                className="min-w-0 flex-1 truncate font-mono"
                dir="ltr"
                title={model.lastCommand ?? model.lastAction}
              >
                {summarizeCommand(model.lastCommand ?? model.lastAction ?? '')}
              </code>
            </div>
          ) : null}

          {stop.recentActions.length > 0 ? (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setShowRecent((value) => !value)}
                aria-expanded={showRecent}
                className="flex items-center gap-1 text-3xs uppercase tracking-wide text-warning/70 hover:text-warning"
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
                      className="truncate font-mono text-3xs text-warning/80"
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
