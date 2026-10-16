import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Brain, Cpu, Eraser, MemoryStick, Sparkles, Trash2 } from 'lucide-react'
import { contextBudget, DEFAULT_CONTEXT_TOKEN_BUDGET } from '@shared/memory'
import {
  factDate,
  factStatus,
  type LearnResultView,
  type ProjectFact
} from '@shared/memory-facts'
import { useStore } from '../store'

/**
 * Settings → Memory: what the current chat costs, and what the app *believes* about this
 * project (v3.1).
 *
 * The fact ledger is the second card on purpose. A memory you cannot read is spooky, and a
 * memory you cannot delete is a liability, so the list shows every fact — including the ones
 * that stopped being true — with the date each one was observed and, for a superseded fact, the
 * date it stopped being true. "Superseded" is collapsed into "deleted" nowhere: seeing what the
 * app *used to* believe is what makes the ledger auditable instead of magical.
 *
 * `Learn from this chat` reports the outcome it actually got. A skipped learn (an empty
 * transcript, a model that found nothing, a failed provider call) is never rendered as success.
 */
export default function SettingsMemory(): JSX.Element {
  const { t } = useTranslation()
  const messages = useStore((state) => state.messages)
  const activeChatId = useStore((state) => state.activeChatId)
  const activeProjectId = useStore((state) => state.settings?.activeProjectId)

  const [facts, setFacts] = useState<ProjectFact[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [learning, setLearning] = useState(false)
  const [outcome, setOutcome] = useState<LearnResultView | null>(null)
  const [learnError, setLearnError] = useState<string | null>(null)
  const [confirmingClear, setConfirmingClear] = useState(false)

  const { tokens, overBudget } = contextBudget(messages)
  const percent = Math.min(100, Math.round((tokens / DEFAULT_CONTEXT_TOKEN_BUDGET) * 100))

  const load = useCallback(async (): Promise<void> => {
    try {
      const list = await window.api.facts.list()
      setFacts(Array.isArray(list) ? list : [])
      setLoadError(null)
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setLoading(false)
    }
  }, [])

  // The ledger belongs to the active project, so a project switch re-reads it.
  useEffect(() => {
    void load()
  }, [load, activeProjectId])

  /** Newest first: the store hands facts back oldest first, and a ledger reads downward in time. */
  const now = Date.now()
  const ledger = [...facts].sort((a, b) => b.validAt - a.validAt || b.createdAt - a.createdAt)
  const live = ledger.filter((fact) => factStatus(fact, now) === 'live')
  const past = ledger.length - live.length

  const learn = async (): Promise<void> => {
    if (!activeChatId || learning) return
    setLearning(true)
    setOutcome(null)
    setLearnError(null)
    try {
      const result = await window.api.facts.learn(activeChatId)
      setOutcome(result)
      await load()
    } catch (caught) {
      setLearnError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setLearning(false)
    }
  }

  const forget = async (factId: string): Promise<void> => {
    try {
      await window.api.facts.forget(factId)
      await load()
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  const forgetAll = async (): Promise<void> => {
    if (!confirmingClear) {
      setConfirmingClear(true)
      return
    }
    setConfirmingClear(false)
    try {
      await window.api.facts.clear()
      setOutcome(null)
      await load()
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  /** One honest line for the outcome of a learn attempt, including why nothing was learned. */
  const renderOutcome = (result: LearnResultView): JSX.Element => {
    if (result.skipped) {
      // An empty chat or a model that found nothing is information, not a fault; only a failed
      // provider call is worth an amber line.
      const message =
        result.skipped === 'no-transcript'
          ? t('settings.factsSkippedNoTranscript')
          : result.skipped === 'no-facts'
            ? t('settings.factsSkippedNoFacts')
            : t('settings.factsSkippedModelError')
      return (
        <>
          <p
            className={`text-3xs ${result.skipped === 'model-error' ? 'text-warning' : 'text-fg-muted'}`}
            dir="auto"
          >
            {message}
          </p>
          {result.error ? (
            <p className="text-3xs text-danger" dir="auto">
              {t('settings.factsErrorDetail', { message: result.error })}
            </p>
          ) : null}
        </>
      )
    }
    if (result.learned === 0) {
      return (
        <p className="text-3xs text-fg-muted">
          {t('settings.factsLearnedNone', { superseded: result.superseded })}
        </p>
      )
    }
    return (
      <p className="text-3xs text-success">
        {t('settings.factsLearned', { learned: result.learned, superseded: result.superseded })}
      </p>
    )
  }

  return (
    <section className="flex flex-col gap-3">
      <h3 className="brutal-label flex items-center gap-2">
        <MemoryStick className="h-3.5 w-3.5" />
        {t('settings.memory')}
      </h3>
      <p className="text-2xs text-fg-muted">{t('settings.memoryHint')}</p>

      <div className="brutal-panel p-3">
        <div className="flex items-center justify-between text-xs text-fg">
          <span className="flex items-center gap-1.5">
            <Cpu className="h-3.5 w-3.5" />
            {t('settings.contextUsage')}
          </span>
          <span className={`brutal-data ${overBudget ? 'text-warning' : 'text-fg-muted'}`}>
            {tokens.toLocaleString()} / {DEFAULT_CONTEXT_TOKEN_BUDGET.toLocaleString()}
          </span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden bg-bg-tertiary">
          <div
            className={`h-full transition-all ease-shape ${overBudget ? 'bg-warning' : 'bg-accent-solid'}`}
            style={{ width: `${percent}%` }}
          />
        </div>
        {overBudget ? (
          <p className="mt-2 text-2xs text-warning">{t('settings.contextOverBudget')}</p>
        ) : null}
      </div>

      {/* The fact ledger: everything the app believes about this project, including the past. */}
      <div className="brutal-panel flex flex-col gap-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-fg">
            <Brain className="h-3.5 w-3.5 text-accent" />
            {t('settings.factsTitle')}
          </span>
          <span className="brutal-data shrink-0 text-3xs text-fg-subtle">
            {t('settings.factsCount', { live: live.length, superseded: past })}
          </span>
        </div>

        <p className="text-3xs text-fg-subtle">{t('settings.factsHint')}</p>

        {loadError ? (
          <p className="text-3xs text-danger" dir="auto">
            {t('settings.factsLoadError', { message: loadError })}
          </p>
        ) : null}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void learn()}
            disabled={!activeChatId || learning}
            className="brutal-btn brutal-primary flex items-center gap-1.5 px-2.5 py-1 text-2xs"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {learning ? t('settings.factsLearning') : t('settings.factsLearn')}
          </button>
          {!activeChatId ? (
            <span className="text-3xs text-fg-subtle">{t('settings.factsNoChat')}</span>
          ) : null}
          {facts.length > 0 ? (
            <button
              type="button"
              onClick={() => void forgetAll()}
              className={`brutal-btn ml-auto flex items-center gap-1.5 px-2.5 py-1 text-2xs ${
                confirmingClear ? 'brutal-danger text-danger' : 'hover:text-danger'
              }`}
            >
              <Eraser className="h-3.5 w-3.5" />
              {confirmingClear ? t('settings.factsClearConfirm') : t('settings.factsForgetAll')}
            </button>
          ) : null}
        </div>

        {outcome ? renderOutcome(outcome) : null}
        {learnError ? (
          <p className="text-3xs text-danger" dir="auto">
            {t('settings.factsLearnError', { message: learnError })}
          </p>
        ) : null}

        {loading ? (
          <p className="text-3xs text-fg-subtle">{t('settings.factsLoading')}</p>
        ) : loadError ? null : ledger.length === 0 ? (
          <p className="text-3xs text-fg-subtle">{t('settings.factsEmpty')}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {ledger.map((fact) => {
              const status = factStatus(fact, now)
              const isLive = status === 'live'
              return (
                <li
                  key={fact.id}
                  data-testid="fact-row"
                  data-status={status}
                  className={`flex items-start gap-2 border px-2 py-1.5 text-2xs ${
                    isLive
                      ? 'border-border bg-bg-secondary'
                      : 'border-border-strong bg-bg-tertiary'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div
                      className={isLive ? 'text-fg' : 'text-fg-subtle line-through'}
                      dir="auto"
                    >
                      {fact.text}
                    </div>
                    <div className="brutal-data mt-0.5 flex flex-wrap items-center gap-1.5 text-3xs text-fg-subtle">
                      <span>
                        {t('settings.factsObserved', { date: factDate(fact.validAt) })}
                      </span>
                      {isLive ? null : (
                        <span className="brutal-chip">
                          {status === 'expired'
                            ? t('settings.factsExpired')
                            : t('settings.factsSuperseded')}
                        </span>
                      )}
                      {isLive || fact.invalidAt === undefined ? null : (
                        <span dir="auto">
                          {t('settings.factsUntil', { date: factDate(fact.invalidAt) })}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void forget(fact.id)}
                    aria-label={t('settings.factsForgetOne')}
                    title={t('settings.factsForgetOne')}
                    className="brutal-btn shrink-0 p-1 text-fg-subtle hover:text-danger"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
