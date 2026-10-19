import type { TraceDecision } from '@shared/trace'
import type { ChatMessage } from '../store'
import { isSuccessOutcome, toolOutcome } from './tool-outcome'

/** Step index encoded in a decision id (`${runId}:${step}`). */
function stepOf(decision: TraceDecision): number | undefined {
  const index = decision.id.lastIndexOf(':')
  if (index < 0) return undefined
  const step = Number(decision.id.slice(index + 1))
  return Number.isFinite(step) ? step : undefined
}

/**
 * True when a tool row is already represented by an inline decision card: same
 * run and same loop step. Those rows are the `✓ tool ok` lines that used to
 * litter the chat, so they are hidden unless the debug toggle is on (v2.6.3).
 */
export function isGroupedInTrace(message: ChatMessage, decisions: TraceDecision[]): boolean {
  if (message.role !== 'tool' || !message.toolCall || !message.runId) return false
  const step = message.toolCall.step
  if (step === undefined) return false
  return decisions.some(
    (decision) => decision.runId === message.runId && stepOf(decision) === step
  )
}

/**
 * The messages the chat should render: every message, minus the raw tool rows
 * already shown inside the inline trace. `showRawToolRows` (Settings → General)
 * disables the suppression for debugging.
 */
export function visibleChatMessages(
  messages: ChatMessage[],
  decisions: TraceDecision[],
  showRawToolRows: boolean
): ChatMessage[] {
  if (showRawToolRows) return messages
  return messages.filter((message) => !isGroupedInTrace(message, decisions))
}

/** The tool names whose rows read as "4 commands", not as "4 calls". */
const COMMAND_TOOLS = ['run_command', 'remote_shell', 'shell', 'terminal', 'exec']

export function isCommandTool(name: string | undefined): boolean {
  return name !== undefined && COMMAND_TOOLS.includes(name)
}

/** One transcript row: an ordinary message, or a run of same-tool calls collapsed into one. */
export type ToolRow =
  | { kind: 'message'; key: string; message: ChatMessage }
  | {
      kind: 'group'
      key: string
      tool: string
      messages: ChatMessage[]
      /** `ok` when every call was quiet, `warning` when one of them wrote to stderr. */
      outcome: 'ok' | 'warning'
      durationMs: number
      /** The server the calls ran on, when they all name the same one. */
      serverId?: string
    }

/**
 * Collapse consecutive calls to the **same tool** into one row (v4.3).
 *
 * The reason is the transcript the user actually complained about: a single run of four remote
 * commands produced four nearly identical cards, each with its own "ok", its own exit chip and its
 * own duration, so a screen of tool output said one thing four times. The row now says it once —
 * `4 commands on spmotor · 12.3s · all ok` — and expands to the individual cards.
 *
 * Three rules, and each exists because the alternative is a lie:
 *
 *  1. **Only consecutive calls.** Two `remote_shell` runs separated by a reply are two events in
 *     the conversation, not one.
 *  2. **Only calls to the same tool.** Grouping `grep` with `git push` because they happened
 *     together would name the wrong thing.
 *  3. **A failed or blocked call is never folded in.** It stays its own row and it ends the run:
 *     a group that says "all ok" must contain nothing that was not ok. `blocked` is treated the
 *     same way as `failed` here, because an approval refusal also needs to be read, not counted.
 */
export function groupToolRows(messages: ChatMessage[]): ToolRow[] {
  const rows: ToolRow[] = []
  let pending: ChatMessage[] = []

  const flush = (): void => {
    if (pending.length === 0) return
    if (pending.length === 1) {
      const message = pending[0]!
      rows.push({ kind: 'message', key: message.id, message })
      pending = []
      return
    }
    const outcomes = pending.map((message) =>
      toolOutcome({
        ...(message.toolCall?.ok === undefined ? {} : { ok: message.toolCall.ok }),
        ...(message.toolCall?.code === undefined ? {} : { code: message.toolCall.code }),
        ...(message.toolCall?.exitCode === undefined ? {} : { exitCode: message.toolCall.exitCode }),
        ...(message.toolCall?.stderr === undefined ? {} : { stderr: message.toolCall.stderr })
      })
    )
    const servers = new Set(
      pending.map((message) => message.toolCall?.serverId).filter((id): id is string => !!id)
    )
    rows.push({
      kind: 'group',
      key: 'group:' + pending[0]!.id,
      tool: pending[0]!.toolCall?.name ?? '',
      messages: [...pending],
      outcome: outcomes.some((outcome) => outcome === 'warning') ? 'warning' : 'ok',
      durationMs: pending.reduce(
        (sum, message) =>
          sum + (typeof message.toolCall?.durationMs === 'number' ? message.toolCall.durationMs : 0),
        0
      ),
      ...(servers.size === 1 ? { serverId: [...servers][0]! } : {})
    })
    pending = []
  }

  for (const message of messages) {
    const call = message.role === 'tool' ? message.toolCall : undefined
    const outcome = call
      ? toolOutcome({
          ...(call.ok === undefined ? {} : { ok: call.ok }),
          ...(call.code === undefined ? {} : { code: call.code }),
          ...(call.exitCode === undefined ? {} : { exitCode: call.exitCode }),
          ...(call.stderr === undefined ? {} : { stderr: call.stderr })
        })
      : undefined
    const groupable = call !== undefined && call.name !== undefined && isSuccessOutcome(outcome!)
    if (!groupable) {
      flush()
      rows.push({ kind: 'message', key: message.id, message })
      continue
    }
    const current = pending[0]?.toolCall?.name
    if (current !== undefined && current !== call.name) flush()
    pending.push(message)
  }
  flush()
  return rows
}
