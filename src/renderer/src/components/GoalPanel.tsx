import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CheckCircle2,
  Circle,
  CircleDot,
  Link2,
  Loader2,
  Plus,
  Target,
  Trash2
} from 'lucide-react'
import { goalProgress, type Goal, type GoalStatus } from '@shared/goal'
import { useStore } from '../store'

const STATUS_CLASS: Record<GoalStatus, string> = {
  active: 'bg-info/15 text-info',
  achieved: 'bg-success/15 text-success',
  abandoned: 'bg-bg-tertiary/60 text-fg-muted',
  blocked: 'bg-warning/15 text-warning'
}

const STATUS_LABEL: Record<GoalStatus, string> = {
  active: 'goals.statusActive',
  achieved: 'goals.statusAchieved',
  abandoned: 'goals.statusAbandoned',
  blocked: 'goals.statusBlocked'
}

function ProgressBar({ met, total }: { met: number; total: number }): JSX.Element {
  const pct = total === 0 ? 0 : Math.round((met / total) * 100)
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-tertiary">
      <div
        className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-success' : 'bg-accent-solid'}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

function GoalCard({ goal }: { goal: Goal }): JSX.Element {
  const { t } = useTranslation()
  const activeGoalId = useStore((state) =>
    state.goalResolution?.kind === 'resolved' ? state.goalResolution.goalId : null
  )
  const busy = useStore((state) => state.goalsBusy)
  const setActiveGoal = useStore((state) => state.setActiveGoal)
  const toggleGoalCriterion = useStore((state) => state.toggleGoalCriterion)
  const achieveGoal = useStore((state) => state.achieveGoal)
  const abandonGoal = useStore((state) => state.abandonGoal)
  const removeGoal = useStore((state) => state.removeGoal)

  const { met, total } = goalProgress(goal)
  const isActive = goal.id === activeGoalId
  const open = goal.status === 'active'

  return (
    <li
      data-testid="goal-card"
      className={`rounded-lg border bg-bg-secondary p-3 ${
        isActive ? 'border-accent/60' : 'border-border'
      }`}
    >
      <div className="flex items-start gap-2">
        <Target
          className={`mt-0.5 h-4 w-4 shrink-0 ${isActive ? 'text-accent' : 'text-fg-muted'}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm text-fg-strong">{goal.title}</span>
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-3xs uppercase ${STATUS_CLASS[goal.status]}`}
            >
              {t(STATUS_LABEL[goal.status])}
            </span>
            {isActive ? (
              <span className="shrink-0 rounded bg-accent-solid/15 px-1.5 py-0.5 text-3xs uppercase text-accent">
                {t('goals.pinned')}
              </span>
            ) : null}
          </div>

          <div className="mt-2 flex items-center gap-2">
            <ProgressBar met={met} total={total} />
            <span className="shrink-0 font-mono text-3xs text-fg-muted">
              {t('goals.progress', { met, total })}
            </span>
          </div>

          {goal.criteria.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {goal.criteria.map((criterion) => (
                <li key={criterion.id}>
                  <button
                    type="button"
                    disabled={busy || !open}
                    onClick={() => void toggleGoalCriterion(goal.id, criterion.id, !criterion.met)}
                    className="flex w-full items-start gap-2 rounded px-1 py-0.5 text-left text-xs text-fg hover:bg-bg-tertiary disabled:opacity-60"
                  >
                    {criterion.met ? (
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                    ) : (
                      <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                    )}
                    <span className={criterion.met ? 'line-through opacity-70' : ''}>
                      {criterion.text}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {open ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void setActiveGoal(isActive ? null : goal.id)}
                className="rounded border border-border px-2 py-0.5 text-2xs text-fg hover:border-accent/60 hover:text-accent disabled:opacity-60"
              >
                {isActive ? t('goals.unpin') : t('goals.pin')}
              </button>
            ) : null}
            {open ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void achieveGoal(goal.id)}
                className="rounded border border-border px-2 py-0.5 text-2xs text-success hover:border-success/60 disabled:opacity-60"
              >
                {t('goals.achieve')}
              </button>
            ) : null}
            {open ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void abandonGoal(goal.id)}
                className="rounded border border-border px-2 py-0.5 text-2xs text-fg hover:border-warning/60 disabled:opacity-60"
              >
                {t('goals.abandon')}
              </button>
            ) : null}
            <button
              type="button"
              disabled={busy}
              aria-label={t('goals.remove')}
              onClick={() => {
                // U-4: deleting a goal also drops its links to past runs.
                if (window.confirm(t('goals.removeConfirm', { title: goal.title }))) {
                  void removeGoal(goal.id)
                }
              }}
              className="ms-auto rounded border border-border p-1 text-fg-muted hover:border-danger/60 hover:text-danger disabled:opacity-60"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>

          {goal.links.length > 0 ? (
            <p className="mt-2 flex items-center gap-1 text-3xs text-fg-muted">
              <Link2 className="h-3 w-3" />
              {t('goals.linkedRuns', { count: goal.links.length })}
            </p>
          ) : null}
          {goal.note ? (
            <p className="mt-1 text-2xs text-fg-muted">{goal.note}</p>
          ) : null}
        </div>
      </div>
    </li>
  )
}

/**
 * The active project's goals (v2.6.2, T4.4). A goal is the stable statement of
 * what the user wants: it survives chats and every run attaches itself to it, so
 * this panel is where the outcome — criteria, progress and status — is managed.
 */
export default function GoalPanel(): JSX.Element {
  const { t } = useTranslation()
  const goals = useStore((state) => state.goals)
  const resolution = useStore((state) => state.goalResolution)
  const busy = useStore((state) => state.goalsBusy)
  const refreshGoals = useStore((state) => state.refreshGoals)
  const createGoal = useStore((state) => state.createGoal)
  const settings = useStore((state) => state.settings)
  const [title, setTitle] = useState('')
  const [criteria, setCriteria] = useState('')

  useEffect(() => {
    void refreshGoals()
  }, [refreshGoals])

  const project = settings?.projects.find((entry) => entry.id === settings.activeProjectId)
  const ambiguous = resolution?.kind === 'ambiguous'

  const submit = (): void => {
    const trimmed = title.trim()
    if (!trimmed || busy) return
    const lines = criteria
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    void createGoal(trimmed, lines)
    setTitle('')
    setCriteria('')
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label={t('goals.title')}>
      <header className="border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-medium text-fg-strong">
          <Target className="h-4 w-4 text-accent" />
          {t('goals.title')}
        </h2>
        <p className="mt-0.5 text-xs text-fg-muted">
          {project ? t('goals.subtitle', { project: project.name }) : t('goals.noProject')}
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <form
          className="mb-4 rounded-lg border border-border bg-bg-secondary p-3"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t('goals.titlePlaceholder')}
            aria-label={t('goals.titlePlaceholder')}
            className="w-full rounded border border-border bg-bg-primary px-2 py-1.5 text-sm text-fg-strong outline-none focus:border-accent"
          />
          <textarea
            value={criteria}
            onChange={(event) => setCriteria(event.target.value)}
            placeholder={t('goals.criteriaPlaceholder')}
            aria-label={t('goals.criteriaPlaceholder')}
            rows={3}
            className="mt-2 w-full resize-y rounded border border-border bg-bg-primary px-2 py-1.5 text-xs text-fg outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={busy || title.trim().length === 0}
            className="mt-2 flex items-center gap-1.5 rounded bg-accent-solid/90 px-3 py-1.5 text-xs font-medium text-bg-primary hover:bg-accent-solid disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            {t('goals.create')}
          </button>
        </form>

        {ambiguous ? (
          <p
            role="status"
            className="mb-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning"
          >
            <CircleDot className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {t('goals.ambiguous')}
          </p>
        ) : null}

        {goals.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <Target className="h-8 w-8 text-fg-subtle" />
            <p className="text-sm text-fg-muted">{t('goals.empty')}</p>
            <p className="max-w-sm text-xs text-fg-subtle">{t('goals.emptyHint')}</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {goals.map((goal) => (
              <GoalCard key={goal.id} goal={goal} />
            ))}
          </ul>
        )}
      </div>

      <footer className="border-t border-border px-4 py-2 text-3xs text-fg-subtle">
        {t('goals.footerHint')}
      </footer>
    </section>
  )
}
