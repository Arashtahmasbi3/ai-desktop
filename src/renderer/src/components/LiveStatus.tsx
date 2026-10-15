import { useEffect, useMemo, useState } from 'react'
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
import { toolLabel, type Translate } from '../lib/tool-labels'
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
 *
 * v2.8.0: the tool is interpolated as a human label, never as `remote_shell`.
 */
function statusFor(phase: TracePhase, tool: string | undefined, t: Translate): Status {
  if (tool) {
    const label = toolLabel(tool, t)
    if (phase === 'inspecting') {
      if (READ_TOOLS.has(tool)) {
        return { icon: FileSearch, key: 'chat.liveReading', params: { tool: label } }
      }
      if (SEARCH_TOOLS.has(tool)) return { icon: Search, key: 'chat.liveSearching' }
    }
    if (phase === 'executing') {
      return WRITE_TOOLS.has(tool)
        ? { icon: Pencil, key: 'chat.liveWriting', params: { tool: label } }
        : { icon: SquareTerminal, key: 'chat.liveRunning', params: { tool: label } }
    }
  }
  return PHASE_STATUS[phase]
}

/**
 * Live, phase-aware status for the running turn (v2.6.3, Fix E; v2.8.0 labels).
 *
 * Reads the phase (and the step's tool, when known) off the latest trace decision.
 * The tool is shown through `toolLabel` rather than raw, because the raw name was
 * literally what the user saw: "Running remote_shell…" for every server command.
 * Falls back to "typing" before the first decision.
 */
export default function LiveStatus(): JSX.Element | null {
  const { t } = useTranslation()
  const running = useStore((state) => state.running)
  // v2.9.0: the reference design shows how long the current turn has been working, which
  // is the difference between "it is thinking" and "it is stuck".
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const decisions = useStore((state) => state.decisions)
  const messages = useStore((state) => state.messages)
  const logs = useStore((state) => state.logs)

  // v2.9.0: start the clock when a run begins and stop it when the run ends, so the
  // elapsed time is the current turn's and not the app's uptime.
  useEffect(() => {
    if (!running) {
      setStartedAt(null)
      return
    }
    setStartedAt((current) => current ?? Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])

  // v2.9.0: the model's own reasoning for the newest step, shown as a one-line excerpt —
  // the reference design puts "Analysing the request …" right under the status.
  const reasoning = useStore((state) => {
    const latest = state.decisions[state.decisions.length - 1]
    return latest ? state.reasoningByStep[latest.id] : undefined
  })

  // U-11: this scans the whole message list, so memoize it instead of redoing
  // the walk on every unrelated store update.
  const status = useMemo(() => {
    const latest = decisions[decisions.length - 1]
    if (!latest) {
      // Before the first decision the log stream already knows: `step.start` and
      // `context.sent` mean the model is being asked, `step.execution` names the
      // tools that are about to run. Without this the line stayed a generic spinner
      // for the whole first step.
      const last = logs[logs.length - 1]
      if (!last) return undefined
      if (last.event === 'step.execution') {
        const actions = Array.isArray(last.actions) ? (last.actions as unknown[]) : []
        const first = actions.find((action): action is string => typeof action === 'string')
        if (first) {
          return {
            icon: SquareTerminal,
            key: 'chat.liveStarting',
            params: { tool: toolLabel(first, t) }
          }
        }
      }
      if (last.event === 'step.start' || last.event === 'context.sent') {
        return PHASE_STATUS.planning
      }
      return undefined
    }
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
    return statusFor(latest.phase, tool, t)
  }, [decisions, messages, logs, t])

  if (!running) return null

  const Icon = status?.icon
  const elapsedSeconds =
    startedAt === null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000))
  const excerpt = reasoning ? reasoning.replace(/\s+/g, ' ').trim().slice(0, 160) : ''

  return (
    <div
      data-testid="live-status"
      className="mx-4 mb-1 flex flex-col items-end gap-0.5 text-xs text-fg-muted"
    >
      <div className="flex items-center gap-2">
        {Icon ? (
          <Icon className="h-3.5 w-3.5 shrink-0 text-accent" />
        ) : (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />
        )}
        {status ? t(status.key, status.params) : t('chat.typing')}
        {elapsedSeconds >= 2 ? (
          <span data-testid="live-elapsed" className="text-fg-subtle">
            {t('chat.liveElapsedSuffix', { seconds: elapsedSeconds })}
          </span>
        ) : null}
      </div>
      {excerpt ? (
        <p
          data-testid="live-reasoning"
          dir="auto"
          className="max-w-[42rem] truncate text-right text-3xs text-fg-subtle"
          title={reasoning}
        >
          {excerpt}
        </p>
      ) : null}
    </div>
  )
}
