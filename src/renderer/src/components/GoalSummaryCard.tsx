import { useTranslation } from 'react-i18next'
import { Target } from 'lucide-react'
import { goalProgress } from '@shared/goal'
import { useStore } from '../store'

/**
 * The goal the next turn will serve, shown inside the chat (v2.9.0).
 *
 * The reference design keeps the ongoing goal visible while it works — the answer to "what
 * is it actually trying to finish?" should not require opening a panel. The panel still
 * exists and still owns editing; this is a one-line summary with a progress count.
 *
 * Renders nothing unless a goal is genuinely resolved for the next run, so a chat with no
 * goal (or an ambiguous one, which the panel already asks the user to disambiguate) stays
 * uncluttered.
 */
export default function GoalSummaryCard(): JSX.Element | null {
  const { t } = useTranslation()
  const resolution = useStore((state) => state.goalResolution)
  const goals = useStore((state) => state.goals)

  if (!resolution || resolution.kind !== 'resolved') return null
  const goal = goals.find((entry) => entry.id === resolution.goalId)
  if (!goal) return null

  const { met, total } = goalProgress(goal)

  return (
    <section
      data-testid="goal-summary"
      dir="auto"
      className="mx-4 mb-1 flex items-center gap-2 rounded-lg border border-accent/40 bg-accent-solid/10 px-2.5 py-1.5"
    >
      <Target className="h-3.5 w-3.5 shrink-0 text-accent" />
      <span className="shrink-0 text-3xs font-medium text-fg-muted">{t('goal.summaryTitle')}</span>
      <span className="min-w-0 flex-1 truncate text-xs text-fg" title={goal.title}>
        {goal.title}
      </span>
      {total > 0 ? (
        <span
          data-testid="goal-summary-progress"
          className="shrink-0 rounded bg-bg-tertiary px-1 font-mono text-3xs text-fg-muted"
        >
          {met}/{total}
        </span>
      ) : null}
    </section>
  )
}
