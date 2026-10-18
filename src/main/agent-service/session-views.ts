import type { SessionStore } from '@core/agent/session-store'
import type { PlanTrustRegistry } from '@core/agent/plan-trust'
import type { AgentEvent, SessionInfo, SessionMemoryView, SessionRecordView } from '@shared/ui'

/**
 * Read-only views of a stored session, for the Sources panel and the session list (F0-4).
 *
 * Split out of `agent-service.ts`. These are pure projections of the session store plus the
 * in-memory plan trust, so they need no service state of their own.
 */

export async function loadSessionView(
  sessionStore: SessionStore,
  id: string
): Promise<SessionRecordView | null> {
  const session = await sessionStore.load(id)
  if (!session) return null
  return {
    id: session.id,
    task: session.task,
    status: session.status,
    summary: session.summary ?? null,
    messages: session.messages
  }
}

export async function listSessionViews(sessionStore: SessionStore): Promise<SessionInfo[]> {
  const sessions = await sessionStore.list()
  return sessions.map((session) => ({
    id: session.id,
    task: session.task,
    status: session.status,
    updatedAt: session.updatedAt
  }))
}

/** v2.6.1 Fix 5: what this chat still remembers, for the Sources tab panel. */
export async function sessionMemoryView(
  sessionStore: SessionStore,
  planTrust: PlanTrustRegistry,
  id: string
): Promise<SessionMemoryView> {
  let session: Awaited<ReturnType<SessionStore['load']>> = null
  try {
    session = await sessionStore.load(id)
  } catch {
    // An unknown/invalid id just means there is nothing stored yet.
  }
  const plan = planTrust.get(id)
  return {
    sessionId: id,
    messages: session?.messages.length ?? 0,
    turns: session?.messages.filter((message) => message.role === 'user').length ?? 0,
    summary: session?.summary ?? null,
    updatedAt: session?.updatedAt ?? 0,
    trustedPlan: plan ? { steps: plan.stepIds.length, expiresAt: plan.expiresAt } : null
  }
}

/**
 * v2.6.1 Fix 5: forget a chat — drop its stored transcript and trusted plan, so
 * the next message starts with no history. The renderer's visible messages stay.
 */
export async function clearSessionMemory(
  sessionStore: SessionStore,
  planTrust: PlanTrustRegistry,
  emit: (event: AgentEvent) => void,
  now: () => number,
  id: string
): Promise<boolean> {
  let removed = false
  try {
    await sessionStore.delete(id)
    removed = true
  } catch {
    removed = false
  }
  const trustCleared = planTrust.clear(id)
  if (trustCleared) emit({ type: 'plan:inactive', at: now() })
  return removed || trustCleared
}