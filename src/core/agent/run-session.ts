/**
 * Loading and saving the run session (F0-4 extraction).
 *
 * The session is the one thing that outlives a run, so both directions are
 * best-effort and neither can fail the run: a broken store costs history, not the
 * answer.
 */
import type { AgentRunResult } from '@shared/agent'
import type { ContextManager } from './context-manager'
import type { OrchestratorLog } from './orchestrator-log'
import { SESSION_SCHEMA_VERSION, type AgentSession, type SessionStore } from './session-store'
import { stripAttachmentParts } from './transcript'

/** What persistence needs from the orchestrator, passed explicitly. */
export interface PersistSessionDeps {
  store?: SessionStore
  /** Base session id, reused across runs so resumes update the same session. */
  sessionId?: string
  metadata?: () => Record<string, unknown> | undefined
  log: OrchestratorLog
}

/** Persist the run's session (best-effort) when a store is configured. */
export async function persistRunSession(
  deps: PersistSessionDeps,
  context: ContextManager,
  task: string,
  result: AgentRunResult,
  resumeSessionId?: string
): Promise<void> {
  const store = deps.store
  if (!store) return
  const snapshot = context.snapshot()
  const metadata = deps.metadata?.()
  const session: AgentSession = {
    id: deps.sessionId ?? resumeSessionId ?? result.runId,
    version: SESSION_SCHEMA_VERSION,
    task,
    status: result.status,
    createdAt: result.startedAt,
    updatedAt: result.finishedAt,
    messages: snapshot.messages.map(stripAttachmentParts),
    summary: snapshot.summary,
    result,
    ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {})
  }
  try {
    await store.save(session)
    deps.log('info', 'session.saved', result.runId, { sessionId: session.id })
  } catch (error) {
    deps.log('warn', 'session.save_failed', result.runId, {
      sessionId: session.id,
      message: error instanceof Error ? error.message : String(error)
    })
  }
}

/**
 * Load a stored session into the context before the new task (best-effort).
 *
 * A failed load is logged and the run continues with an empty history, exactly as the
 * inline block it replaces did.
 */
export interface ResumeSessionDeps {
  store?: SessionStore
  resumeId?: string
  context: ContextManager
  log: OrchestratorLog
  runId: string
}

export async function resumeSessionIntoContext(deps: ResumeSessionDeps): Promise<void> {
  if (!deps.resumeId || !deps.store) return
  const store = deps.store
  const resumeId = deps.resumeId
  try {
    const session = await store.load(resumeId)
    if (session) {
      deps.context.restore({
        messages: session.messages,
        summary: session.summary ?? null,
        droppedCount: 0
      })
      deps.log('info', 'session.resumed', deps.runId, {
        sessionId: resumeId,
        messages: session.messages.length
      })
    }
  } catch (error) {
    deps.log('warn', 'session.resume_failed', deps.runId, {
      sessionId: resumeId,
      message: error instanceof Error ? error.message : String(error)
    })
  }
}
