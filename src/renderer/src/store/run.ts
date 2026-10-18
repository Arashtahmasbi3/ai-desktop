import i18n from '../i18n'
import { redact } from '@core/agent/redact'
import { buildRunIntentBlock } from '@shared/run-outputs'
import type { TaskPlan } from '@shared/task-plan'
import type { TraceDecision } from '@shared/trace'
import type { PreflightNotice, ToolCallView, ToolResultView } from '@shared/ui'
import { budgetBlockMessage, budgetState, readBudget } from '../lib/budget'
import { diffStat } from '../lib/diff-stat'
import { readEnabledTools } from '../lib/tool-toggles'
import { newId } from './helpers'
import type { StoreSet, StoreGet } from './helpers'
import type { ChatMessage, AppState } from './types'

/** Project a `tool:result` event into the compact shape stored on a message. */
function toolCallFromView(view: ToolResultView): ToolCallView {
  return {
    name: view.name,
    ok: view.ok,
    ...(view.code ? { code: view.code } : {}),
    ...(view.error !== undefined ? { error: view.error, detail: view.error } : {}),
    ...(view.command !== undefined ? { command: view.command } : {}),
    ...(view.serverId !== undefined ? { serverId: view.serverId } : {}),
    ...(view.cwd !== undefined ? { cwd: view.cwd } : {}),
    ...(view.path !== undefined ? { path: view.path } : {}),
    ...(view.stdout !== undefined ? { stdout: view.stdout } : {}),
    ...(view.stderr !== undefined ? { stderr: view.stderr } : {}),
    ...(view.exitCode !== undefined ? { exitCode: view.exitCode } : {}),
    ...(view.durationMs !== undefined ? { durationMs: view.durationMs } : {}),
    ...(view.attempts !== undefined ? { attempts: view.attempts } : {}),
    ...(view.step !== undefined ? { step: view.step } : {}),
    ...(view.recovery ? { recovery: view.recovery } : {})
  }
}

const MAX_LOGS = 500
/** v2.6.2 T3.2: keep the timeline bounded too. */
const MAX_DECISIONS = 200

/**
 * U-10: `messages` used to grow without bound — every `tool:result` appends one
 * and `ChatPanel` renders all of them eagerly — so a long run leaked memory and
 * painted thousands of rows. Cap the in-memory history at the newest
 * MAX_MESSAGES (the on-disk chat/session still holds the full transcript, and
 * the agent's own ContextManager compacts the prompt independently). The
 * tradeoff is that a very old tail disappears from the UI until the chat is
 * reloaded from disk.
 */
const MAX_MESSAGES = 500
/** U-10: `taskPlans` only ever grew; bound it the same way. */
const MAX_TASK_PLANS = 50

/**
 * U-10: trim `messages` to the newest MAX_MESSAGES, but never drop a message
 * that belongs to the run currently producing them.
 */
function capMessages(messages: ChatMessage[], runId: string | null): ChatMessage[] {
  if (messages.length <= MAX_MESSAGES) return messages
  const cutoff = messages.length - MAX_MESSAGES
  if (runId) {
    const firstInFlight = messages.findIndex((message) => message.runId === runId)
    if (firstInFlight >= 0 && firstInFlight < cutoff) return messages.slice(firstInFlight)
  }
  return messages.slice(cutoff)
}

/** U-10: insert a plan into the map, dropping the oldest entries past the cap. */
function withTaskPlan(
  plans: Record<string, TaskPlan>,
  plan: TaskPlan
): Record<string, TaskPlan> {
  const next = { ...plans, [plan.id]: plan }
  const ids = Object.keys(next)
  if (ids.length <= MAX_TASK_PLANS) return next
  for (const id of ids.slice(0, ids.length - MAX_TASK_PLANS)) delete next[id]
  return next
}

export function runActions(
  set: StoreSet,
  get: StoreGet
): Pick<
  AppState,
  | 'setPlanMode'
  | 'applyEvent'
  | 'setTaskPlan'
  | 'pauseTaskPlan'
  | 'resumeTaskPlan'
  | 'stopTaskPlan'
  | 'send'
  | 'abort'
  | 'dismissLoopStop'
> {
  return {
    setPlanMode: (value) => set({ planMode: value }),

    applyEvent(event) {
      switch (event.type) {
        case 'run:start':
          set({
            running: true,
            currentRunId: event.runId,
            error: null,
            logs: [],
            decisions: [],
            pendingApproval: null,
            pendingPlan: null,
            pendingPreflight: null,
            pendingQuestion: null,
            activePlan: null,
            taskPlan: null,
            taskPaused: false,
            loopStop: null,
            preflightNotice: null
          })
          break
        case 'approval:request':
          set({ pendingApproval: event.request })
          break
        case 'approval:resolved':
          // v2.8.0: the dialog closes as soon as the decision is made, instead of
          // lingering with a dead Approve button after a timeout denied the action.
          if (get().pendingApproval?.id === event.id) set({ pendingApproval: null })
          break
        case 'plan:request':
          set({ pendingPlan: event.request })
          break
        case 'question:request':
          set({ pendingQuestion: event.request })
          break
        case 'question:resolved':
          if (get().pendingQuestion?.id === event.id) set({ pendingQuestion: null })
          break
        case 'preflight:request':
          set({ pendingPreflight: event.request })
          break
        case 'preflight:resolved':
          if (get().pendingPreflight?.id === event.id) set({ pendingPreflight: null })
          break
        case 'plan:resolved':
          if (get().pendingPlan?.id === event.id) set({ pendingPlan: null })
          break
        case 'plan:active':
          set({ activePlan: event.plan })
          break
        case 'plan:inactive':
          set({ activePlan: null })
          break
        case 'task:plan':
        case 'task:step':
        case 'task:complete':
        case 'task:failed':
          set({
            taskPlan: event.plan,
            taskPlans: withTaskPlan(get().taskPlans, event.plan),
            ...(event.type === 'task:complete' || event.type === 'task:failed'
              ? { taskPaused: false }
              : {})
          })
          break
        case 'approval:suggestion':
          set({ approvalSuggestion: { tool: event.tool, count: event.count } })
          get().pushToast(
            'warning',
            `You approved ${event.tool} ${event.count} times. Remember it to skip prompts?`
          )
          break
        case 'file:change': {
          // Durable record: `fileChanges` itself is emptied when the change is
          // applied or rejected, so the answer to "what did it change?" would be
          // gone by the time the user looks.
          const stats = diffStat(event.change.before, event.change.after)
          const known = get().changedFiles.find((entry) => entry.path === event.change.path)
          set({
            changedFiles: known
              ? get().changedFiles.map((entry) =>
                  entry.path === event.change.path
                    ? { ...entry, added: stats.added, removed: stats.removed, edits: entry.edits + 1 }
                    : entry
                )
              : [...get().changedFiles, { path: event.change.path, ...stats, edits: 1 }],
            // v2.9.1: a direct-write run has nothing left to review — the edit is on
            // disk — so it goes into the durable summary only.
            fileChanges: event.change.applied
              ? get().fileChanges
              : [...get().fileChanges, event.change]
          })
          break
        }
        case 'file:change:resolved':
          set({ fileChanges: get().fileChanges.filter((change) => change.id !== event.id) })
          break
        case 'log': {
          const logs = [...get().logs, event.entry]
          if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS)
          // v2.6.2 T3.2: a 'decision' entry is also the live timeline's input.
          if (event.entry.event === 'decision' && event.entry.decision) {
            const decisions = [...get().decisions, event.entry.decision as TraceDecision]
            if (decisions.length > MAX_DECISIONS) {
              decisions.splice(0, decisions.length - MAX_DECISIONS)
            }
            set({ logs, decisions })
          } else if (event.entry.event === 'step.reasoning' && typeof event.entry.reasoning === 'string') {
            /*
             * v2.8.0: the model's own reasoning for a step, keyed by `${runId}:${step}`
             * — the same key a trace decision uses, so the trace can show it inline.
             * Kept out of `messages` on purpose: it is not part of the conversation and
             * must never be replayed to the provider as an assistant turn.
             */
            const step = typeof event.entry.step === 'number' ? event.entry.step : undefined
            const runId = event.entry.runId
            if (step !== undefined && typeof runId === 'string') {
              set({
                logs,
                reasoningByStep: {
                  ...get().reasoningByStep,
                  [`${runId}:${step}`]: event.entry.reasoning
                }
              })
            } else {
              set({ logs })
            }
          } else if (event.entry.event === 'preflight' && Array.isArray(event.entry.checks)) {
            // v2.6.3 T3.1: the orchestrator emits one tiered entry per non-ok check.
            set({
              logs,
              preflightNotice: {
                tool: String(event.entry.tool ?? ''),
                ...(typeof event.entry.step === 'number' ? { step: event.entry.step } : {}),
                tier: (event.entry.tier as PreflightNotice['tier']) ?? 'warn',
                checks: event.entry.checks as PreflightNotice['checks'],
                blocked: Boolean(event.entry.blocked),
                at: Date.now()
              }
            })
          } else {
            set({ logs })
          }
          break
        }
        case 'tool:result': {
          const toolCall = toolCallFromView(event.result)
          set({
            messages: capMessages(
              [
                ...get().messages,
                {
                  id: newId(),
                  role: 'tool',
                  // v2.8.1: just the tool name — the error code already lives on
                  // `toolCall.code`, and the raw name is a fallback label only.
                  content: toolCall.name,
                  at: event.at,
                  runId: event.runId,
                  toolCall
                }
              ],
              event.runId
            )
          })
          break
        }
        case 'run:end': {
          const text = event.finalAnswer ?? event.message ?? ''
          const messages = [...get().messages]
          const usedRemote = get().logs.some(
            (entry) => entry.event === 'action.ok' && entry.tool === 'remote_shell'
          )
          if (text) {
            messages.push({
              id: newId(),
              role: 'assistant',
              content: text,
              at: event.at,
              runId: event.runId,
              ...(event.model ? { model: event.model } : {}),
              ...(usedRemote ? { usedRemote: true } : {})
            })
          }
          set({
            running: false,
            currentRunId: null,
            warnings: event.warnings,
            loopStop: event.stop ?? null,
            pendingApproval: null,
            pendingPlan: null,
            pendingPreflight: null,
            activePlan: null,
            messages: capMessages(messages, null)
          })
          const explain = get().queuedExplain
          if (explain) {
            set({ queuedExplain: null })
            void get().send(explain)
          }
          if (event.usage) {
            get().recordUsage({
              provider: event.provider ?? get().selection.provider,
              model: event.model ?? get().selection.model,
              inputTokens: event.usage.promptTokens,
              outputTokens: event.usage.completionTokens,
              timestamp: event.at
            })
          }
          void get().persistChat()
          void get().refreshSessions()
          void get().refreshMemory()
          break
        }
        case 'error':
          set({
            running: false,
            currentRunId: null,
            pendingApproval: null,
            pendingPlan: null,
            pendingPreflight: null,
            activePlan: null,
            error: redact(event.message),
            loopStop: null,
            messages: capMessages(
              [
                ...get().messages,
                { id: newId(), role: 'system', content: `Error: ${redact(event.message)}`, at: Date.now() }
              ],
              get().currentRunId
            )
          })
          get().pushToast('error', event.message)
          break
      }
    },

    setTaskPlan(plan) {
      set({
        taskPlan: plan,
        ...(plan ? { taskPlans: withTaskPlan(get().taskPlans, plan) } : {})
      })
    },

    pauseTaskPlan() {
      set({ taskPaused: true })
    },

    resumeTaskPlan() {
      set({ taskPaused: false })
    },

    stopTaskPlan() {
      const plan = get().taskPlan
      if (!plan) {
        set({ taskPaused: false })
        return
      }
      const stopped: TaskPlan = { ...plan, status: 'failed' }
      set({
        taskPlan: stopped,
        taskPlans: withTaskPlan(get().taskPlans, stopped),
        taskPaused: false
      })
    },

    async send(text, attachments) {
      const trimmed = text.trim()
      const files = (attachments ?? []).filter((id) => typeof id === 'string' && id !== '')
      if ((!trimmed && files.length === 0) || get().running) return
      /*
       * v3.1: the spend guard acts BEFORE the call. Checking afterwards would report a cost the
       * user already paid, which is the one thing a budget is supposed to prevent. The message
       * names the numbers and the way out rather than just refusing.
       */
      const budget = budgetState(get().usageRecords, readBudget(), Date.now())
      if (budget.blocks) {
        get().pushToast('warning', budgetBlockMessage(budget))
        return
      }
      /**
       * v3.0: the Sources/Outputs panel declares intent, and that intent is prompt
       * text — the attachments keep travelling as ids, so this adds no IPC. The
       * block is `''` when nothing was declared, which keeps an ordinary send
       * byte-for-byte what it was before the panel existed.
       */
      const intent = buildRunIntentBlock(get().runOutputs, get().runSources)
      const task = intent ? (trimmed ? `${trimmed}\n\n${intent}` : intent) : trimmed
      const selection = get().selection
      // Fix 1 (v2.6.1): pin a stable chat id *before* the first run. Without this
      // a new chat sent message 1 under the throwaway `sessionId`, then
      // `persistChat()` assigned a different server-generated `activeChatId`, so
      // message 2 ran under a different session id. Reusing `sessionId` as the
      // chat id keeps `sessionId === activeChatId` for the chat's whole life.
      const activeChatId = get().activeChatId ?? get().sessionId
      if (!get().activeChatId) set({ activeChatId })
      set({
        messages: [
          ...get().messages,
          {
            id: newId(),
            role: 'user',
            // The transcript names the attachments so the user can see what was sent,
            // while the agent receives them as staged files rather than as this text.
            content:
              files.length > 0
                ? `${trimmed ? `${trimmed}\n\n` : ''}${i18n.t('chat.attachmentSent', { count: files.length })}`
                : trimmed,
            at: Date.now()
          }
        ],
        running: true,
        error: null
      })
      void get().persistChat()
      try {
        await window.api.agent.run({
          task,
          sessionId: activeChatId,
          // Fix 2 (v2.6.1): load the stored session so the model sees the whole
          // conversation, not just this turn. The agent persists each run under
          // this same id, so the history accumulates across messages.
          resumeSessionId: activeChatId,
          provider: selection.provider,
          model: selection.model,
          ...(selection.customProviderId ? { customProviderId: selection.customProviderId } : {}),
          ...(get().vpsServerId ? { vpsServerId: get().vpsServerId } : {}),
          enabledTools: readEnabledTools(),
          planMode: get().planMode,
          ...(files.length > 0 ? { attachments: files } : {})
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        set({ running: false, error: message })
        get().pushToast('error', message)
      }
    },

    abort() {
      void window.api.agent.abort()
    },

    dismissLoopStop: () => set({ loopStop: null })
  }
}
