import { useTranslation } from 'react-i18next'
import { AlertTriangle, Ban, Check, Clock, Loader2, Pause, XCircle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  isThreadState,
  stateLabelKey,
  stateTone,
  stateWaitingKey,
  waitingReasonOf,
  type StateTone,
  type ThreadState,
  type ThreadStateView
} from '../lib/thread-state'

/**
 * The single way this app says "what is happening" (redesign decision D-25).
 *
 * Why a component and not three Tailwind classes at each call site: the app currently reports the
 * same fact in four places with four vocabularies, and every new surface invented its own dot. A
 * state is now a value from `THREAD_STATES`, and this chip is the only renderer of it.
 *
 * Two rules are enforced by shape rather than by review:
 *  - `D-23`: an icon *and* a text label always render, so colour is never the only signal.
 *  - `D-26`: a `waiting` state names its blocker; the reason is part of the visible text and of the
 *    accessible name, which is what makes a stalled run findable instead of "stuck".
 */

const ICONS: Record<ThreadState, LucideIcon> = {
  queued: Clock,
  running: Loader2,
  waiting: AlertTriangle,
  paused: Pause,
  done: Check,
  failed: XCircle,
  cancelled: Ban
}

/**
 * Tones map onto the existing themed tokens (`danger`, `success`, `info`, `accent`), so this adds no
 * new colour and cannot drift from the theme contract that `theme-tokens.test.ts` enforces.
 */
const TONE_CLASSES: Record<StateTone, string> = {
  neutral: 'border-border text-fg-muted',
  flow: 'border-info/40 text-info',
  attention: 'border-accent/50 bg-accent/5 text-accent',
  success: 'border-success/40 text-success',
  failure: 'border-danger/40 text-danger'
}

const SIZE_CLASSES = {
  sm: 'gap-1 px-1.5 py-0.5 text-3xs',
  md: 'gap-1.5 px-2 py-0.5 text-2xs'
} as const

const ICON_SIZES = {
  sm: 'h-3 w-3',
  md: 'h-3.5 w-3.5'
} as const

export interface StateChipProps extends ThreadStateView {
  size?: keyof typeof SIZE_CLASSES
  /** Rendered as a trailing count — for an inbox badge or "3 waiting". */
  count?: number
  /** Overrides the default test id, for a surface that renders several chips. */
  testId?: string
  className?: string
}

export default function StateChip({
  state,
  waitingReason,
  size = 'sm',
  count,
  testId,
  className = ''
}: StateChipProps): JSX.Element {
  const { t } = useTranslation()

  // A caller can only pass a `ThreadState` at compile time; this keeps a malformed IPC payload from
  // rendering as a colour with no meaning (the failure mode this component exists to end).
  const safeState: ThreadState = isThreadState(state) ? state : 'queued'
  const reason = waitingReasonOf({ state: safeState, waitingReason })

  const label = t(stateLabelKey(safeState))
  const reasonLabel = reason ? t(stateWaitingKey(reason)) : null
  const visible = reasonLabel ? `${label} · ${reasonLabel}` : label

  const Icon = ICONS[safeState]
  const tone = stateTone(safeState)

  return (
    <span
      data-testid={testId ?? `state-chip-${safeState}`}
      data-state={safeState}
      data-tone={tone}
      data-waiting-reason={reason ?? undefined}
      role="status"
      aria-label={visible}
      title={visible}
      className={`inline-flex shrink-0 items-center rounded-shape-pill border font-medium ${SIZE_CLASSES[size]} ${TONE_CLASSES[tone]} ${className}`}
    >
      <Icon
        aria-hidden="true"
        className={`${ICON_SIZES[size]} ${safeState === 'running' ? 'animate-spin' : ''}`}
      />
      <span className="whitespace-nowrap">{visible}</span>
      {typeof count === 'number' && count > 0 ? (
        <span
          data-testid="state-chip-count"
          className="ml-0.5 rounded-shape-pill bg-fg/10 px-1 tabular-nums"
        >
          {count}
        </span>
      ) : null}
    </span>
  )
}
