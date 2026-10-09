import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { BarChart3 } from 'lucide-react'
import { estimateTokens } from '@shared/memory'
import { useStore } from '../store'

/** Settings → Usage: lightweight run/session statistics from the store. */
export default function SettingsUsage(): JSX.Element {
  const { t } = useTranslation()
  const messages = useStore((state) => state.messages)
  const logs = useStore((state) => state.logs)

  const stats = useMemo(() => {
    const tokens = messages.reduce((sum, message) => sum + estimateTokens(message.content), 0)
    const tools = logs.filter((entry) => entry.event === 'action.ok').length
    const errors = logs.filter(
      (entry) => entry.event === 'action.error' || entry.event === 'run.error'
    ).length
    return { messages: messages.length, tokens, tools, errors }
  }, [messages, logs])

  const rows: Array<[string, string]> = [
    [t('settings.usageMessages'), String(stats.messages)],
    [t('settings.usageTokens'), stats.tokens.toLocaleString()],
    [t('settings.usageTools'), String(stats.tools)],
    [t('settings.usageErrors'), String(stats.errors)]
  ]

  return (
    <section className="flex flex-col gap-3">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        <BarChart3 className="h-3.5 w-3.5" />
        {t('settings.usage')}
      </h3>
      <p className="text-[11px] text-neutral-500">{t('settings.usageHint')}</p>
      <dl className="flex flex-col gap-2">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex items-center justify-between rounded-xl border border-border bg-bg-primary px-3 py-2"
          >
            <dt className="text-xs text-neutral-400">{label}</dt>
            <dd className="font-mono text-xs text-neutral-200">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
