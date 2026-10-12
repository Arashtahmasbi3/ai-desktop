import { useTranslation } from 'react-i18next'
import {
  Brain,
  Check,
  FileSearch,
  Loader2,
  Pencil,
  Search,
  SquareTerminal,
  type LucideIcon
} from 'lucide-react'
import { useStore } from '../store'
import type { TraceDecision, TracePhase } from '@shared/trace'

/** Tools whose phase maps to a more specific status than the phase alone. */
const READ_TOOLS = new Set([
  'read_file',
  'list_dir',
  'remote_read_file',
  'remote_list_dir',
  'remote_exists'
])
const SEARCH_TOOLS = new Set(['remote_grep', 'get_service_logs', 'get_process_list'])
const WRITE_TOOLS = new Set(['write_file', 'remote_write_file'])

interface Status {
  icon: LucideIcon
  key: string
  params?: Record<string, string>
}

const PHASE_STATUS: Record<TracePhase, Status> = {
  planning: { icon: Brain, key: 'chat.livePlanning' },
  inspecting: { icon: Search, key: 'chat.liveInspecting' },
  executing: { icon: SquareTerminal, key: 'chat.liveExecuting' },
  verifying: { icon: Pencil, key: 'chat.liveVerifying' },
  done: { icon: Check, key: 'chat.liveDone' }
}

/** Step index encoded in a decision id (`${runId}:${step}`). */
function stepOf(decision: TraceDecision): number | undefined {
  const index = decision.id.lastIndexOf(':')
  if (index < 0) return undefined
  const step = Number(decision.id.slice(index + 1))
  return Number.isFinite(step) ? step : undefined
}

/**
 * Derive the running-turn status (v2.6.3, Fix E). The phase alone is coarse, so
 * when the latest step's tool is known we name the action: reading a file,
 * searching, or writing. Falls back to the phase label, then to "typing".
 */
function statusFor(phase: TracePhase, tool: string | undefined): Status {
  if (tool) {
    if (phase === 'inspecting') {
      if (READ_TOOLS.has(tool)) {
        return { icon: FileSearch, key: 'chat.liveReading', params: { tool } }
      }
      if (SEARCH_TOOLS.has(tool)) return { icon: Search, key: 'chat.liveSearching' }
    }
    if (phase === 'executing') {
      return WRITE_TOOLS.has(tool)
        ? { icon: Pencil, key: 'chat.liveWriting', params: { tool } }
        : { icon: SquareTerminal, key: 'chat.liveRunning', params: { tool } }
    }
  }
  return PHASE_STATUS[phase]
}

/**
 * Live, phase-aware status for the running turn (v2.6.3, Fix E). Replaces the
 * static "typing" line: it reads the phase (and the step's tool, when known) off
 * the latest trace decision, so the user sees what the agent is doing instead of
 * a generic spinner. Falls back to "typing" before the first decision.
 */
export default function LiveStatus(): JSX.Element | null {
  const { t } = useTranslation()
  const running = useStore((state) => state.running)
  const decisions = useStore((state) => state.decisions)
  const messages = useStore((state) => state.messages)

  if (!running) return null

  const latest = decisions[decisions.length - 1]
  let status: Status | undefined
  if (latest) {
    const step = stepOf(latest)
    const tool =
      step === undefined
        ? undefined
        : messages.find(
            (message) =>
              message.role === 'tool' &&
              message.runId === latest.runId &&
              message.toolCall?.step === step
          )?.toolCall?.name
    status = statusFor(latest.phase, tool)
  }
  const Icon = status?.icon

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
      {status ? t(status.key, status.params) : t('chat.typing')}
    </div>
  )
}
