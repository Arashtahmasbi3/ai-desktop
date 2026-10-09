import { useTranslation } from 'react-i18next'
import { Cpu, MemoryStick } from 'lucide-react'
import { contextBudget, DEFAULT_CONTEXT_TOKEN_BUDGET } from '@shared/memory'
import { useStore } from '../store'

/** Settings → Memory: context budget and token accounting. */
export default function SettingsMemory(): JSX.Element {
  const { t } = useTranslation()
  const messages = useStore((state) => state.messages)
  const showTokenCount = useStore((state) => state.showTokenCount)
  const setShowTokenCount = useStore((state) => state.setShowTokenCount)

  const { tokens, overBudget } = contextBudget(messages)
  const percent = Math.min(100, Math.round((tokens / DEFAULT_CONTEXT_TOKEN_BUDGET) * 100))

  return (
    <section className="flex flex-col gap-3">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        <MemoryStick className="h-3.5 w-3.5" />
        {t('settings.memory')}
      </h3>
      <p className="text-[11px] text-neutral-500">{t('settings.memoryHint')}</p>

      <div className="rounded-xl border border-border bg-bg-primary p-3">
        <div className="flex items-center justify-between text-xs text-neutral-300">
          <span className="flex items-center gap-1.5">
            <Cpu className="h-3.5 w-3.5" />
            {t('settings.contextUsage')}
          </span>
          <span className={overBudget ? 'text-amber-400' : 'text-neutral-400'}>
            {tokens.toLocaleString()} / {DEFAULT_CONTEXT_TOKEN_BUDGET.toLocaleString()}
          </span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-bg-tertiary">
          <div
            className={`h-full rounded-full transition-all ${overBudget ? 'bg-amber-400' : 'bg-accent'}`}
            style={{ width: `${percent}%` }}
          />
        </div>
        {overBudget ? (
          <p className="mt-2 text-[11px] text-amber-400">{t('settings.contextOverBudget')}</p>
        ) : null}
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-xs text-neutral-300">
        <input
          type="checkbox"
          checked={showTokenCount}
          onChange={(event) => setShowTokenCount(event.target.checked)}
          className="accent-accent"
        />
        {t('settings.showTokenCount')}
      </label>
    </section>
  )
}
