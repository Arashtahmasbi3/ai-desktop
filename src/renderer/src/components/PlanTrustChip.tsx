import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ClipboardCheck, X } from 'lucide-react'
import { useStore } from '../store'

/** Milliseconds left before the trust expires (never negative). */
function remainingMs(expiresAt: number, now: number): number {
  return Math.max(0, expiresAt - now)
}

/**
 * Header chip shown while a trusted plan is auto-approving its steps (v2.5.5).
 * Counts down to expiry and lets the user stop the trust early.
 */
export default function PlanTrustChip(): JSX.Element | null {
  const { t } = useTranslation()
  const activePlan = useStore((state) => state.activePlan)
  const stopPlan = useStore((state) => state.stopPlan)
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!activePlan) return
    const check = (): void => {
      if (remainingMs(activePlan.expiresAt, Date.now()) <= 0) stopPlan()
      else setTick((value) => value + 1)
    }
    const timer = setInterval(check, 30_000)
    return () => clearInterval(timer)
  }, [activePlan, stopPlan])

  if (!activePlan) return null
  const minutes = Math.ceil(remainingMs(activePlan.expiresAt, Date.now()) / 60_000)
  if (minutes <= 0) return null

  return (
    <span className="flex items-center gap-1 rounded bg-accent/20 px-1.5 py-0.5 text-accent">
      <ClipboardCheck className="h-3 w-3" />
      {t('plan.active')} ({t('plan.activeRemaining', { count: minutes })})
      <button
        type="button"
        onClick={stopPlan}
        title={t('plan.stop')}
        aria-label={t('plan.stop')}
        className="ml-0.5 rounded p-0.5 hover:bg-accent/30"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  )
}
