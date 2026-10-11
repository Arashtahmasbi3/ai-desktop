import { useTranslation } from 'react-i18next'
import { AlertOctagon, CornerDownRight, Lightbulb, RotateCcw, Server, Terminal, XOctagon } from 'lucide-react'
import type { LoopStopInfo } from '@shared/agent'
import { buildLoopStopModel, type LoopStopAction } from '../lib/loop-stop'

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
  const emphasisClass = (action: LoopStopAction): string =>
    model.emphasis === action ? 'ring-2 ring-amber-400/70' : ''

  return (
    <div className="mx-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-start">
      <div className="flex items-start gap-2">
        <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-amber-200">{t('chat.loopStopTitle')}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-amber-100/90">{stop.message}</p>
          <p className="mt-2 flex items-start gap-1 text-[11px] leading-relaxed text-amber-200/90">
            <Lightbulb className="mt-0.5 h-3 w-3 shrink-0" />
            {t(model.hintKey)}
          </p>
          {model.lastAction ? (
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-amber-100/80">
              <span className="uppercase tracking-wide text-amber-300/70">
                {t('chat.loopStopStuckOn')}
              </span>
              {model.onRemote ? (
                <span className="flex items-center gap-1 rounded bg-amber-500/20 px-1 py-0.5">
                  <Server className="h-3 w-3" />
                  {t('chat.loopStopRemote')}
                  {model.serverId ? <span className="font-mono">{model.serverId}</span> : null}
                </span>
              ) : (
                <Terminal className="h-3 w-3" />
              )}
              <code className="truncate font-mono" dir="ltr" title={model.lastAction}>
                {model.lastCommand ?? model.lastAction}
              </code>
            </div>
          ) : null}
          {stop.recentActions.length > 0 ? (
            <div className="mt-2">
              <p className="text-[10px] uppercase tracking-wide text-amber-300/70">
                {t('chat.loopStopRecent')}
              </p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {stop.recentActions.map((action, index) => (
                  <li
                    key={`${action}-${index}`}
                    dir="ltr"
                    className="truncate font-mono text-[10px] text-amber-100/80"
                  >
                    <CornerDownRight className="mr-1 inline h-3 w-3" />
                    {action}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onContinue}
              disabled={!model.allowContinue}
              className={`flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1 text-[11px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 ${emphasisClass('continue')}`}
            >
              <RotateCcw className="h-3 w-3" />
              {t('chat.loopStopContinue')}
            </button>
            <button
              type="button"
              onClick={onCorrect}
              className={`flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11px] text-neutral-200 hover:bg-bg-tertiary ${emphasisClass('correct')}`}
            >
              <CornerDownRight className="h-3 w-3" />
              {t('chat.loopStopCorrect')}
            </button>
            <button
              type="button"
              onClick={onStop}
              className={`flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11px] text-neutral-300 hover:bg-bg-tertiary ${emphasisClass('stop')}`}
            >
              <XOctagon className="h-3 w-3" />
              {t('chat.loopStopStop')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
