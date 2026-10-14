import { useTranslation } from 'react-i18next'

/**
 * v2.6.2 T5.1: the composer's quiet "context is filling up" hint. It replaces
 * the old always-on token counter — nothing is shown until the conversation
 * crosses {@link CONTEXT_NEAR_LIMIT_RATIO}, and it turns red once over budget.
 * Presentational, so it can be unit-tested without the IPC bridge.
 */
export default function ContextWarning({
  percent,
  overBudget,
  running,
  onCompact
}: {
  percent: number
  overBudget: boolean
  running: boolean
  onCompact: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const tone = overBudget ? 'text-danger' : 'text-warning'
  const dot = overBudget ? 'bg-danger' : 'bg-warning'

  return (
    <div data-testid="context-warning" className="flex items-center gap-1.5">
      <span
        title={t('chat.contextNearLimit', { percent })}
        aria-label={t('chat.contextNearLimit', { percent })}
        className={`flex items-center gap-1 font-mono text-3xs ${tone}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        {percent}%
      </span>
      <button
        type="button"
        onClick={onCompact}
        disabled={running}
        className="rounded border border-border px-1.5 py-0.5 text-3xs text-fg hover:bg-bg-tertiary disabled:opacity-40"
      >
        {t('chat.compact')}
      </button>
    </div>
  )
}
