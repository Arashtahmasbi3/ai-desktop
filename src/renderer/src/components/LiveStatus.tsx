import { useTranslation } from 'react-i18next'
import { Brain, Check, Loader2, Pencil, Search, SquareTerminal } from 'lucide-react'
import { useStore } from '../store'
import type { TracePhase } from '@shared/trace'

const PHASE: Record<TracePhase, { icon: typeof Brain; key: string }> = {
  planning: { icon: Brain, key: 'chat.livePlanning' },
  inspecting: { icon: Search, key: 'chat.liveInspecting' },
  executing: { icon: SquareTerminal, key: 'chat.liveExecuting' },
  verifying: { icon: Pencil, key: 'chat.liveVerifying' },
  done: { icon: Check, key: 'chat.liveDone' }
}

/**
 * Live, phase-aware status for the running turn (v2.6.3, Fix E). Replaces the
 * static "typing" line: it reads the phase off the latest trace decision, so the
 * user sees what the agent is doing (thinking / inspecting / executing / verifying)
 * instead of a generic spinner. Falls back to "typing" before the first decision.
 */
export default function LiveStatus(): JSX.Element | null {
  const { t } = useTranslation()
  const running = useStore((state) => state.running)
  const decisions = useStore((state) => state.decisions)

  if (!running) return null

  const latest = decisions[decisions.length - 1]
  const entry = latest ? PHASE[latest.phase] : undefined
  const Icon = entry?.icon

  return (
    <div
      data-testid="live-status"
      className="flex items-center gap-2 px-4 text-xs text-neutral-400"
    >
      {Icon ? (
        <Icon className="h-3.5 w-3.5 shrink-0 text-accent" />
      ) : (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />
      )}
      {entry ? t(entry.key) : t('chat.typing')}
    </div>
  )
}
