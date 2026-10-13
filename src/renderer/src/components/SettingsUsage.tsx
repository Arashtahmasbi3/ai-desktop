import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { BarChart3, Download, RotateCcw } from 'lucide-react'
import { estimateTokens, contextBudget, DEFAULT_CONTEXT_TOKEN_BUDGET } from '@shared/memory'
import { useStore } from '../store'
import {
  aggregateUsage,
  formatCost,
  toCsv,
  type UsageBreakdown,
  type UsageTotals
} from '../lib/usage'

function TotalsRow({
  label,
  totals,
  t
}: {
  label: string
  totals: UsageTotals
  t: (key: string, options?: Record<string, unknown>) => string
}): JSX.Element {
  return (
    <div className="rounded-xl border border-border bg-bg-primary px-3 py-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium text-neutral-300">{label}</span>
        <span className="font-mono text-xs text-neutral-200">{formatCost(totals.cost)}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-2xs text-neutral-500">
        <span>
          {t('settings.usageInput')}:{' '}
          <span className="font-mono text-neutral-300">{totals.inputTokens.toLocaleString()}</span>
        </span>
        <span>
          {t('settings.usageOutput')}:{' '}
          <span className="font-mono text-neutral-300">{totals.outputTokens.toLocaleString()}</span>
        </span>
        <span>
          {t('settings.usageCalls')}:{' '}
          <span className="font-mono text-neutral-300">{totals.calls.toLocaleString()}</span>
        </span>
      </div>
      {totals.costUnknown ? (
        <p className="mt-1 text-3xs text-amber-400">{t('settings.usageUnknownCost')}</p>
      ) : null}
    </div>
  )
}

function BreakdownList({
  title,
  rows
}: {
  title: string
  rows: UsageBreakdown[]
}): JSX.Element | null {
  if (rows.length === 0) return null
  return (
    <div>
      <p className="mb-1 text-2xs font-medium text-neutral-400">{title}</p>
      <ul className="flex flex-col gap-1">
        {rows.map((row) => (
          <li
            key={row.key}
            className="flex items-center justify-between rounded-lg bg-bg-primary px-2.5 py-1.5 text-2xs"
          >
            <span className="truncate text-neutral-300">{row.key}</span>
            <span className="shrink-0 font-mono text-neutral-500">
              {row.inputTokens.toLocaleString()} / {row.outputTokens.toLocaleString()} ·{' '}
              {formatCost(row.cost)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Settings → Usage: chat stats (v2.3.2) plus token accounting (v2.5.4). */
export default function SettingsUsage(): JSX.Element {
  const { t } = useTranslation()
  const messages = useStore((state) => state.messages)
  const logs = useStore((state) => state.logs)
  const usageRecords = useStore((state) => state.usageRecords)
  const sessionStartedAt = useStore((state) => state.sessionStartedAt)
  const resetUsage = useStore((state) => state.resetUsage)
  const pushToast = useStore((state) => state.pushToast)

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

  const summary = useMemo(() => aggregateUsage(usageRecords), [usageRecords])
  const session = useMemo(
    () => aggregateUsage(usageRecords.filter((record) => record.timestamp >= sessionStartedAt)),
    [usageRecords, sessionStartedAt]
  )
  const context = useMemo(() => contextBudget(messages), [messages])
  const contextPercent = Math.min(100, Math.round(context.ratio * 100))
  const maxDaily = Math.max(1, ...summary.last7Days.map((day) => day.inputTokens + day.outputTokens))

  const exportCsv = (): void => {
    try {
      const blob = new Blob([toCsv(usageRecords)], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'ai-desktop-usage.csv'
      anchor.click()
      URL.revokeObjectURL(url)
    } catch {
      pushToast('error', t('settings.usageExport'))
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        <BarChart3 className="h-3.5 w-3.5" />
        {t('settings.usage')}
      </h3>
      <p className="text-2xs text-neutral-500">{t('settings.usageHint')}</p>
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

      <div
        data-testid="usage-context-window"
        className="rounded-xl border border-border bg-bg-primary px-3 py-2"
      >
        <div className="flex items-center justify-between text-xs text-neutral-300">
          <span>{t('settings.contextUsage')}</span>
          <span className={`font-mono ${context.overBudget ? 'text-amber-400' : 'text-neutral-400'}`}>
            {context.tokens.toLocaleString()} / {DEFAULT_CONTEXT_TOKEN_BUDGET.toLocaleString()} ·{' '}
            {contextPercent}%
          </span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-bg-tertiary">
          <div
            className={`h-full rounded-full transition-all ${
              context.overBudget ? 'bg-amber-400' : 'bg-accent'
            }`}
            style={{ width: `${contextPercent}%` }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-border pt-2">
        <span className="text-2xs font-medium text-neutral-400">
          {t('settings.usageAllTime')}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={exportCsv}
            disabled={usageRecords.length === 0}
            title={t('settings.usageExport')}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-2xs text-neutral-400 hover:bg-bg-tertiary hover:text-neutral-200 disabled:opacity-40"
          >
            <Download className="h-3 w-3" />
            {t('settings.usageExport')}
          </button>
          <button
            type="button"
            onClick={resetUsage}
            disabled={usageRecords.length === 0}
            title={t('settings.usageReset')}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-2xs text-neutral-400 hover:bg-bg-tertiary hover:text-neutral-200 disabled:opacity-40"
          >
            <RotateCcw className="h-3 w-3" />
            {t('settings.usageReset')}
          </button>
        </div>
      </div>

      {usageRecords.length === 0 ? (
        <p className="rounded-xl border border-border bg-bg-primary px-3 py-2 text-2xs text-neutral-500">
          {t('settings.usageEmpty')}
        </p>
      ) : (
        <>
          <TotalsRow label={t('settings.usageSession')} totals={session.total} t={t} />
          <TotalsRow label={t('settings.usageAllTime')} totals={summary.total} t={t} />

          <BreakdownList title={t('settings.usageByProvider')} rows={summary.byProvider} />
          <BreakdownList title={t('settings.usageByModel')} rows={summary.byModel} />

          <div>
            <p className="mb-1 text-2xs font-medium text-neutral-400">
              {t('settings.usageLast7Days')}
            </p>
            <div className="flex h-16 items-end gap-1">
              {summary.last7Days.map((day) => {
                const tokens = day.inputTokens + day.outputTokens
                const height = Math.round((tokens / maxDaily) * 100)
                return (
                  <div
                    key={day.day}
                    className="flex flex-1 flex-col items-center gap-1"
                    title={`${day.day}: ${tokens.toLocaleString()}`}
                  >
                    <div className="flex h-12 w-full items-end">
                      <div
                        className="w-full rounded-sm bg-accent/70"
                        style={{ height: `${Math.max(tokens > 0 ? 6 : 0, height)}%` }}
                      />
                    </div>
                    <span className="text-4xs text-neutral-600">{day.day.slice(5)}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </section>
  )
}
