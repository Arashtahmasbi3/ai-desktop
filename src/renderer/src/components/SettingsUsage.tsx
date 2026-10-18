import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BarChart3, Download, Gauge, RotateCcw } from 'lucide-react'
import { contextBudget, DEFAULT_CONTEXT_TOKEN_BUDGET } from '@shared/memory'
import { estimateTrimmedTokens } from '@shared/tokens'
import { useStore } from '../store'
import {
  aggregateUsage,
  formatCost,
  toCsv,
  type UsageBreakdown,
  type UsageTotals
} from '../lib/usage'
import {
  budgetState,
  normalizeBudget,
  readBudget,
  writeBudget,
  type BudgetSettings
} from '../lib/budget'

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
    <div className="brutal-card px-3 py-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium text-fg">{label}</span>
        <span className="brutal-data text-xs">{formatCost(totals.cost)}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-2xs text-fg-muted">
        <span>
          {t('settings.usageInput')}:{' '}
          <span className="brutal-data">{totals.inputTokens.toLocaleString()}</span>
        </span>
        <span>
          {t('settings.usageOutput')}:{' '}
          <span className="brutal-data">{totals.outputTokens.toLocaleString()}</span>
        </span>
        <span>
          {t('settings.usageCalls')}:{' '}
          <span className="brutal-data">{totals.calls.toLocaleString()}</span>
        </span>
      </div>
      {totals.costUnknown ? (
        <p className="mt-1 text-3xs text-warning">{t('settings.usageUnknownCost')}</p>
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
      <p className="brutal-label mb-1">{title}</p>
      <ul className="flex flex-col gap-1">
        {rows.map((row) => (
          <li
            key={row.key}
            className="brutal-inset flex items-center justify-between px-2.5 py-1.5 text-2xs"
          >
            <span className="brutal-data truncate">{row.key}</span>
            <span className="brutal-data shrink-0 text-fg-muted">
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
    const tokens = messages.reduce((sum, message) => sum + estimateTrimmedTokens(message.content), 0)
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

  // v3.1: the spend guard. The cap lives in localStorage like the other renderer preferences,
  // and the state is recomputed from the recorded calls, so nothing has to be kept in sync.
  const [budget, setBudget] = useState<BudgetSettings>(() => readBudget())
  const budgetNow = useMemo(
    () => budgetState(usageRecords, budget, Date.now()),
    [usageRecords, budget]
  )
  const updateBudget = (next: Partial<BudgetSettings>): void => {
    const merged = normalizeBudget({ ...budget, ...next })
    setBudget(merged)
    writeBudget(merged)
  }

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
      {/* v3.1: the cap that makes the totals act. */}
      <div className="brutal-card p-2.5 text-2xs" data-testid="budget-guard">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-fg">
            <Gauge className="h-3.5 w-3.5 text-accent" />
            {t('settings.budgetTitle')}
          </span>
          <span
            className={`brutal-data text-2xs ${
              budgetNow.level === 'over'
                ? 'text-danger'
                : budgetNow.level === 'warn'
                  ? 'text-warning'
                  : 'text-fg-muted'
            }`}
            data-testid="budget-today"
          >
            {budgetNow.label}
          </span>
        </div>

        {budgetNow.cap > 0 ? (
          <div className="mt-2 h-1.5 w-full overflow-hidden bg-bg-tertiary">
            <div
              className={`h-full ease-shape ${
                budgetNow.level === 'over' ? 'bg-danger' : budgetNow.level === 'warn' ? 'bg-warning' : 'bg-success'
              }`}
              style={{ width: `${Math.min(100, Math.round(budgetNow.fraction * 100))}%` }}
            />
          </div>
        ) : null}

        <label className="mt-2 flex items-center justify-between gap-2 text-2xs text-fg-muted">
          {t('settings.budgetCap')}
          <input
            type="number"
            min={0}
            step={0.5}
            value={budget.dailyCap || ''}
            placeholder="0"
            onChange={(event) => updateBudget({ dailyCap: Number(event.target.value) })}
            className="brutal-inset brutal-focus brutal-data w-20 px-2 py-1 text-right text-2xs"
          />
        </label>

        <label className="mt-2 flex cursor-pointer items-center gap-2 text-2xs text-fg-muted">
          <input
            type="checkbox"
            checked={budget.blockWhenExceeded}
            onChange={(event) => updateBudget({ blockWhenExceeded: event.target.checked })}
            className="accent-accent"
          />
          {t('settings.budgetBlock')}
        </label>

        <p className="mt-2 text-3xs text-fg-subtle">{t('settings.budgetHint')}</p>
        {/*
          An unpriced model means the total is a lower bound. Saying so is the difference between
          a guard the user can trust and one that quietly under-counts.
        */}
        {budgetNow.unknownModels ? (
          <p className="mt-1 text-3xs text-warning" data-testid="budget-unpriced">
            {t('settings.budgetUnpriced')}
          </p>
        ) : null}
      </div>
      <h3 className="brutal-label flex items-center gap-2">
        <BarChart3 className="h-3.5 w-3.5" />
        {t('settings.usage')}
      </h3>
      <p className="text-2xs text-fg-muted">{t('settings.usageHint')}</p>
      <dl className="flex flex-col gap-2">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="brutal-card flex items-center justify-between px-3 py-2"
          >
            <dt className="text-xs text-fg-muted">{label}</dt>
            <dd className="brutal-data text-xs">{value}</dd>
          </div>
        ))}
      </dl>

      <div
        data-testid="usage-context-window"
        className="brutal-inset px-3 py-2"
      >
        <div className="flex items-center justify-between text-xs text-fg">
          <span>{t('settings.contextUsage')}</span>
          <span className={`brutal-data ${context.overBudget ? 'text-warning' : 'text-fg-muted'}`}>
            {context.tokens.toLocaleString()} / {DEFAULT_CONTEXT_TOKEN_BUDGET.toLocaleString()} ·{' '}
            {contextPercent}%
          </span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden bg-bg-primary">
          <div
            className={`h-full ease-shape ${
              context.overBudget ? 'bg-warning' : 'bg-accent-solid'
            }`}
            style={{ width: `${contextPercent}%` }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between border-t-2 border-border pt-2">
        <span className="text-2xs font-medium text-fg-muted">
          {t('settings.usageAllTime')}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={exportCsv}
            disabled={usageRecords.length === 0}
            title={t('settings.usageExport')}
            className="brutal-btn flex items-center gap-1"
          >
            <Download className="h-3 w-3" />
            {t('settings.usageExport')}
          </button>
          <button
            type="button"
            onClick={resetUsage}
            disabled={usageRecords.length === 0}
            title={t('settings.usageReset')}
            className="brutal-btn flex items-center gap-1"
          >
            <RotateCcw className="h-3 w-3" />
            {t('settings.usageReset')}
          </button>
        </div>
      </div>

      {usageRecords.length === 0 ? (
        <p className="brutal-inset px-3 py-2 text-2xs text-fg-muted">
          {t('settings.usageEmpty')}
        </p>
      ) : (
        <>
          <TotalsRow label={t('settings.usageSession')} totals={session.total} t={t} />
          <TotalsRow label={t('settings.usageAllTime')} totals={summary.total} t={t} />

          <BreakdownList title={t('settings.usageByProvider')} rows={summary.byProvider} />
          <BreakdownList title={t('settings.usageByModel')} rows={summary.byModel} />

          <div>
            <p className="brutal-label mb-1">
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
                        className="w-full bg-accent-solid/70"
                        style={{ height: `${Math.max(tokens > 0 ? 6 : 0, height)}%` }}
                      />
                    </div>
                    <span className="brutal-data text-4xs text-fg-subtle">{day.day.slice(5)}</span>
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
