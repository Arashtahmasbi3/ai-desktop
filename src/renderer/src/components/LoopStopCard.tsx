import { useTranslation } from 'react-i18next'
import { AlertOctagon, CornerDownRight, RotateCcw, XOctagon } from 'lucide-react'
import type { LoopStopInfo } from '@shared/agent'

interface Props {
  stop: LoopStopInfo
  onContinue: () => void
  onCorrect: () => void
  onStop: () => void
}

/**
 * Shown when the agent stops itself to break a loop. Gives the user three
 * concrete next moves instead of leaving the run silently paused.
 */
export default function LoopStopCard({ stop, onContinue, onCorrect, onStop }: Props): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="mx-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-start">
      <div className="flex items-start gap-2">
        <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-amber-200">{t('chat.loopStopTitle')}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-amber-100/90">{stop.message}</p>
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
              className="flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1 text-[11px] font-medium text-white hover:bg-accent-hover"
            >
              <RotateCcw className="h-3 w-3" />
              {t('chat.loopStopContinue')}
            </button>
            <button
              type="button"
              onClick={onCorrect}
              className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11px] text-neutral-200 hover:bg-bg-tertiary"
            >
              <CornerDownRight className="h-3 w-3" />
              {t('chat.loopStopCorrect')}
            </button>
            <button
              type="button"
              onClick={onStop}
              className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11px] text-neutral-300 hover:bg-bg-tertiary"
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
