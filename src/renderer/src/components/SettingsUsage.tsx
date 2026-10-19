import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BarChart3, Download, Gauge, RotateCcw } from 'lucide-react'
import { contextBudget, DEFAULT_CONTEXT_TOKEN_BUDGET } from '@shared/memory'
import { estimateTrimmedTokens } from '@shared/tokens'
import { useStore } from '../store'
import {
  aggregateUsage,
  dailyUsage,
  formatCost,
  toCsv,
  type DailyUsage,
  type UsageBreakdown,
  type UsageTotals
} from '../lib/usage'
import {
  budgetState,
  normalizeBudget,
  readBudget,
  writeBudget,
  type BudgetLevel,
  type BudgetSettings
} from '../lib/budget'
import EmptyState from './ui/EmptyState'

/*
 * Settings → Usage, rebuilt as a dashboard (O4-5).
 *
 * The section could already answer "what have I spent", and nothing else. The question a user
 * actually asks is *"where did this month's spend go?"* — per day, per provider, per model, and
 * how close today is to the cap that refuses a send.
 *
 * Every number below comes from what is **already recorded**: `UsageRecord[]` (provider, model,
 * input/output tokens, timestamp), one record per completed call, persisted by the store, priced
 * with the table in `lib/usage.ts` that the spend cap itself uses. No estimate is invented here —
 * where a figure does not exist, the panel says so (see the cap-events card).
 *
 * Deliberately plain: bars are a div with a width, data is monospace (`ui-data`), there
 * is no chart library and no soft gradient.
 */

type Translator = (key: string, options?: Record<string, unknown>) => string

/** A hard-edged bar: one div, a width, no blur. */
function Bar({
  percent,
  tone = 'accent',
  testId
}: {
  percent: number
  tone?: 'accent' | 'ok' | 'warn' | 'over'
  testId?: string
}): JSX.Element {
  const fill =
    tone === 'over' ? 'bg-danger' : tone === 'warn' ? 'bg-warning' : tone === 'ok' ? 'bg-success' : 'bg-accent-solid'
  return (
    <span className="block h-2 w-full bg-bg-tertiary" aria-hidden="true">
      <span
        data-testid={testId}
        data-tone={tone}
        className={`block h-full ${fill}`}
        style={{ width: `${Math.min(100, Math.max(0, Math.round(percent)))}%` }}
      />
    </span>
  )
}

function TotalsRow({
  label,
  totals,
  t
}: {
  label: string
  totals: UsageTotals
  t: Translator
}): JSX.Element {
  return (
    <div className="ui-inset px-3 py-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-2xs font-semibold text-fg">{label}</span>
        <span className="ui-data text-xs">
          {totals.cost === null ? t('settings.usageUnknownCost') : formatCost(totals.cost)}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-2xs text-fg-muted">
        <span>
          {t('settings.usageInput')}:{' '}
          <span className="ui-data">{totals.inputTokens.toLocaleString()}</span>
        </span>
        <span>
          {t('settings.usageOutput')}:{' '}
          <span className="ui-data">{totals.outputTokens.toLocaleString()}</span>
        </span>
        <span>
          {t('settings.usageCalls')}: <span className="ui-data">{totals.calls.toLocaleString()}</span>
        </span>
      </div>
      {totals.costUnknown ? (
        <p className="mt-1 text-3xs text-warning">{t('settings.usageUnknownCost')}</p>
      ) : null}
    </div>
  )
}

/**
 * Spend and tokens for one provider or model. The cost is `null` when no call in the group was
 * priced — the row then says "unpriced" instead of showing a zero, because a zero would read as
 * "this was free".
 */
function BreakdownList({
  title,
  hint,
  rows,
  testId,
  t
}: {
  title: string
  hint: string
  rows: UsageBreakdown[]
  testId: string
  t: Translator
}): JSX.Element | null {
  if (rows.length === 0) return null
  return (
    <div data-testid={testId}>
      <p className="ui-label text-fg">{title}</p>
      <p className="mb-1 text-3xs text-fg-subtle">{hint}</p>
      <ul className="flex flex-col gap-1">
        {rows.map((row) => (
          <li
            key={row.key}
            className="ui-inset flex items-center gap-2 px-2.5 py-1.5 text-2xs"
            data-testid={`${testId}-row`}
            data-key={row.key}
          >
            <span className="ui-data min-w-0 flex-1 truncate text-fg">{row.key}</span>
            <span className="ui-data shrink-0 text-fg-muted">
              {row.inputTokens.toLocaleString()} / {row.outputTokens.toLocaleString()}
            </span>
            <span className="ui-data w-16 shrink-0 text-end text-fg-muted">
              {row.calls.toLocaleString()} {t('settings.usageCalls')}
            </span>
            <span className="ui-data w-20 shrink-0 text-end text-fg">
              {row.cost === null ? t('usage.unpriced') : formatCost(row.cost)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** One day of the 14-day strip: a bar, the day's spend and its tokens. */
function DayRow({
  day,
  maxTokens,
  t
}: {
  day: DailyUsage
  maxTokens: number
  t: Translator
}): JSX.Element {
  const tokens = day.inputTokens + day.outputTokens
  // A day with calls but rounding to zero still gets a visible stub, so "quiet" and "broken" differ.
  const percent = maxTokens > 0 ? Math.max(day.calls > 0 ? 3 : 0, (tokens / maxTokens) * 100) : 0
  return (
    <li
      className="flex items-center gap-2 text-2xs"
      data-testid={`usage-day-${day.day}`}
      data-calls={day.calls}
    >
      <span className="ui-data w-20 shrink-0 text-fg-muted">{day.day}</span>
      <span className="min-w-0 flex-1">
        <Bar percent={percent} testId={`usage-day-bar-${day.day}`} />
      </span>
      <span className="ui-data w-20 shrink-0 text-end text-fg">
        {day.calls === 0
          ? '—'
          : day.cost === null
            ? t('usage.unpriced')
            : formatCost(day.cost)}
      </span>
      <span className="ui-data w-16 shrink-0 text-end text-fg-muted">
        {tokens.toLocaleString()}
      </span>
      <span className="w-16 shrink-0 text-end text-3xs text-fg-subtle">
        {day.calls === 0 ? t('usage.noCalls') : t('usage.dayCalls', { calls: day.calls })}
      </span>
    </li>
  )
}

function levelLabel(level: BudgetLevel, t: Translator): string {
  if (level === 'over') return t('usage.capLevelOver')
  if (level === 'warn') return t('usage.capLevelWarn')
  if (level === 'ok') return t('usage.capLevelOk')
  return t('usage.capLevelOff')
}

/** Settings → Usage: the spend dashboard (O4-5), built on the records the app already keeps. */
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

  const summary = useMemo(() => aggregateUsage(usageRecords), [usageRecords])
  const session = useMemo(
    () => aggregateUsage(usageRecords.filter((record) => record.timestamp >= sessionStartedAt)),
    [usageRecords, sessionStartedAt]
  )
  /*
   * 14 days, from the same bucketing function the 7-day summary uses. `now` is read once here so
   * every row on one render agrees about which day is today.
   */
  const days = useMemo(() => dailyUsage(usageRecords, 14), [usageRecords])
  const busiestDay = days.reduce(
    (max, day) => Math.max(max, day.inputTokens + day.outputTokens),
    0
  )
  const context = useMemo(() => contextBudget(messages), [messages])
  const contextPercent = Math.min(100, Math.round(context.ratio * 100))

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

  const rows: Array<[string, string]> = [
    [t('settings.usageMessages'), String(stats.messages)],
    [t('settings.usageTokens'), stats.tokens.toLocaleString()],
    [t('settings.usageTools'), String(stats.tools)],
    [t('settings.usageErrors'), String(stats.errors)]
  ]

  return (
    <section className="flex flex-col gap-3">
      {/* 1. Today against the cap — the number that can stop a send. */}
      <div className="ui-card p-3" data-testid="usage-today">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-fg">
            <Gauge className="h-3.5 w-3.5 text-accent" />
            {t('usage.todayTitle')}
          </span>
          <span
            className={`ui-chip ${
              budgetNow.level === 'over'
                ? 'border-danger text-danger'
                : budgetNow.level === 'warn'
                  ? 'border-warning text-warning'
                  : budgetNow.level === 'ok'
                    ? 'border-success text-success'
                    : ''
            }`}
            data-testid="usage-today-level"
          >
            {levelLabel(budgetNow.level, t)}
          </span>
        </div>

        <p className="ui-data mt-2 text-base" data-testid="budget-today">
          {formatCost(budgetNow.spentToday)}
          {budgetNow.cap > 0 ? (
            <span className="text-fg-muted"> / {formatCost(budgetNow.cap)}</span>
          ) : null}
        </p>

        {budgetNow.cap > 0 ? (
          <>
            <Bar
              percent={budgetNow.fraction * 100}
              tone={budgetNow.level === 'over' ? 'over' : budgetNow.level === 'warn' ? 'warn' : 'ok'}
              testId="usage-cap-bar"
            />
            <p className="ui-data mt-1 text-2xs text-fg-muted" data-testid="usage-cap-fraction">
              {t('usage.capFraction', { percent: Math.round(budgetNow.fraction * 100) })}
            </p>
          </>
        ) : (
          <p className="mt-2 text-2xs text-fg-muted">{t('usage.capNotSet')}</p>
        )}

        {/*
          An unpriced model means the total is a lower bound. Saying so is the difference between
          a guard the user can trust and one that quietly under-counts — the cap has said this
          since v3.1, and the dashboard inherits it rather than reporting a different number.
        */}
        {budgetNow.unknownModels ? (
          <p className="mt-1 text-3xs text-warning" data-testid="usage-unpriced">
            {t('settings.budgetUnpriced')}
          </p>
        ) : null}

        <label className="mt-3 flex items-center justify-between gap-2 text-2xs text-fg-muted">
          {t('settings.budgetCap')}
          <input
            type="number"
            min={0}
            step={0.5}
            value={budget.dailyCap || ''}
            placeholder="0"
            onChange={(event) => updateBudget({ dailyCap: Number(event.target.value) })}
            className="ui-inset ui-focus ui-data w-20 px-2 py-1 text-right text-2xs"
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
      </div>

      {usageRecords.length === 0 ? (
        <EmptyState
          testId="usage-empty"
          title={t('settings.usageEmpty')}
          body={t('usage.emptyBody')}
        />
      ) : (
        <>
          {/* 2. The last 14 days, as a bar list. */}
          <div data-testid="usage-days">
            <p className="ui-label text-fg">{t('usage.daysTitle')}</p>
            <p className="mb-1 text-3xs text-fg-subtle">{t('usage.daysHint')}</p>
            <ol className="flex flex-col gap-1">
              {days.map((day) => (
                <DayRow key={day.day} day={day} maxTokens={busiestDay} t={t} />
              ))}
            </ol>
          </div>

          {/* 3. Where the money actually went. */}
          <BreakdownList
            title={t('settings.usageByProvider')}
            hint={t('usage.byProviderHint')}
            rows={summary.byProvider}
            testId="usage-by-provider"
            t={t}
          />
          <BreakdownList
            title={t('settings.usageByModel')}
            hint={t('usage.byModelHint')}
            rows={summary.byModel}
            testId="usage-by-model"
            t={t}
          />

          {/* 4. Cap events — and the honest gap. */}
          <div className="ui-card p-3" data-testid="usage-cap-events">
            <div className="flex items-center justify-between gap-2">
              <span className="ui-label text-fg">{t('usage.capEventsTitle')}</span>
              <span className="ui-data text-2xs text-warning" data-testid="usage-cap-events-value">
                {t('usage.capEventsUnknown')}
              </span>
            </div>
            <p className="mt-1 text-2xs leading-relaxed text-fg-muted" data-testid="usage-cap-events-body">
              {t('usage.capEventsBody')}
            </p>
            <p className="ui-data mt-2 text-2xs text-fg-muted">
              {t('usage.capEventsLevel')}:{' '}
              <span data-testid="usage-cap-level">{levelLabel(budgetNow.level, t)}</span>
            </p>
          </div>

          {/* Recorded totals, for the questions the list above cannot answer. */}
          <div className="flex flex-col gap-2" data-testid="usage-totals">
            <TotalsRow label={t('settings.usageSession')} totals={session.total} t={t} />
            <TotalsRow label={t('settings.usageAllTime')} totals={summary.total} t={t} />
          </div>
        </>
      )}

      <h3 className="ui-label flex items-center gap-2">
        <BarChart3 className="h-3.5 w-3.5" />
        {t('settings.usage')}
      </h3>
      <p className="text-2xs text-fg-muted">{t('settings.usageHint')}</p>
      <dl className="flex flex-col gap-2">
        {rows.map(([label, value]) => (
          <div key={label} className="ui-card flex items-center justify-between px-3 py-2">
            <dt className="text-xs text-fg-muted">{label}</dt>
            <dd className="ui-data text-xs">{value}</dd>
          </div>
        ))}
      </dl>

      <div data-testid="usage-context-window" className="ui-inset px-3 py-2">
        <div className="flex items-center justify-between text-xs text-fg">
          <span>{t('settings.contextUsage')}</span>
          <span className={`ui-data ${context.overBudget ? 'text-warning' : 'text-fg-muted'}`}>
            {context.tokens.toLocaleString()} / {DEFAULT_CONTEXT_TOKEN_BUDGET.toLocaleString()} ·{' '}
            {contextPercent}%
          </span>
        </div>
        <div className="mt-2">
          <Bar
            percent={contextPercent}
            tone={context.overBudget ? 'warn' : 'accent'}
            testId="usage-context-bar"
          />
        </div>
      </div>

      <div className="flex items-center justify-between border-t-2 border-border pt-2">
        <span className="text-2xs font-medium text-fg-muted">{t('settings.usageAllTime')}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={exportCsv}
            disabled={usageRecords.length === 0}
            title={t('settings.usageExport')}
            className="ui-btn flex items-center gap-1"
          >
            <Download className="h-3 w-3" />
            {t('settings.usageExport')}
          </button>
          <button
            type="button"
            onClick={resetUsage}
            disabled={usageRecords.length === 0}
            title={t('settings.usageReset')}
            className="ui-btn flex items-center gap-1"
          >
            <RotateCcw className="h-3 w-3" />
            {t('settings.usageReset')}
          </button>
        </div>
      </div>
    </section>
  )
}
