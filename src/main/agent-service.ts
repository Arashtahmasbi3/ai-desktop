import type { AgentLogEntry, AgentLogger } from '@shared/agent'
import type { AgentRunResult } from '@shared/agent'
import type { ProviderId } from '@shared/types'
import type { AgentEvent, AgentRunRequest, SessionInfo, SessionRecordView } from '@shared/ui'
import { AgentOrchestrator } from '@core/agent-orchestrator'
import type { ProviderEntry } from '@core/agent-orchestrator'
import { PROVIDERS, createAdapterForConfig } from '@core/llm-adapters/registry'
import type { Persistence } from '@core/agent/persistence'
import type { SessionStore } from '@core/agent/session-store'
import type { SandboxManager } from '@shared/sandbox'

/** Forwards orchestrator log entries to a sink (the renderer, in the app). */
class EmittingLogger implements AgentLogger {
  constructor(private readonly emit: (event: AgentEvent) => void) {}

  log(entry: AgentLogEntry): void {
    this.emit({ type: 'log', entry })
  }
}

export interface AgentServiceOptions {
  sandbox: SandboxManager
  persistence: Persistence
  sessionStore: SessionStore
  emit: (event: AgentEvent) => void
  now?: () => number
}

export function providerOrder(
  ids: ProviderId[],
  preferred?: ProviderId,
  active?: ProviderId
): ProviderId[] {
  const order: ProviderId[] = []
  for (const id of [preferred, active, ...ids]) {
    if (id && !order.includes(id)) order.push(id)
  }
  return order
}

/**
 * Runs the agent orchestrator on behalf of the renderer: builds provider
 * entries from the encrypted settings, streams events, and supports abort.
 */
export class AgentService {
  private readonly sandbox: SandboxManager
  private readonly persistence: Persistence
  private readonly sessionStore: SessionStore
  private readonly emit: (event: AgentEvent) => void
  private readonly now: () => number
  private readonly controllers = new Set<AbortController>()
  private runCounter = 0

  constructor(options: AgentServiceOptions) {
    this.sandbox = options.sandbox
    this.persistence = options.persistence
    this.sessionStore = options.sessionStore
    this.emit = options.emit
    this.now = options.now ?? (() => Date.now())
  }

  isRunning(): boolean {
    return this.controllers.size > 0
  }

  /** Build provider entries (with keys) ordered by preference. */
  async buildProviders(preferred?: ProviderId): Promise<ProviderEntry[]> {
    const settings = await this.persistence.load()
    const ids = Object.keys(PROVIDERS) as ProviderId[]
    const order = providerOrder(ids, preferred, settings.activeProvider)
    const entries: ProviderEntry[] = []

    for (const id of order) {
      const stored = settings.providers[id]
      if (!stored?.apiKeyEnc) continue
      const apiKey = await this.persistence.getApiKey(id)
      if (!apiKey) continue
      const descriptor = PROVIDERS[id]
      const config = {
        provider: id,
        apiKey,
        model: stored.model ?? descriptor.defaultModel,
        baseUrl: stored.baseUrl ?? descriptor.defaultBaseUrl
      }
      entries.push({ provider: id, adapter: createAdapterForConfig(config), config })
    }

    if (entries.length === 0) {
      throw new Error('No API key configured. Add one in Settings.')
    }
    return entries
  }

  async run(request: AgentRunRequest, externalSignal?: AbortSignal): Promise<AgentRunResult> {
    const providers = await this.buildProviders(request.provider)
    const orchestrator = new AgentOrchestrator({
      sandbox: this.sandbox,
      providers,
      logger: new EmittingLogger(this.emit),
      sessionStore: this.sessionStore,
      ...(request.sessionId ? { sessionId: request.sessionId } : {})
    })

    const controller = new AbortController()
    this.controllers.add(controller)
    const onExternalAbort = (): void => controller.abort()
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true })

    const runId = `run-${++this.runCounter}`
    this.emit({ type: 'run:start', runId, task: request.task, at: this.now() })

    try {
      const result = await orchestrator.run(request.task, {
        signal: controller.signal,
        ...(request.resumeSessionId ? { resumeSessionId: request.resumeSessionId } : {})
      })
      this.emit({
        type: 'run:end',
        runId: result.runId,
        status: result.status,
        finalAnswer: result.finalAnswer,
        message: result.message,
        warnings: result.warnings,
        at: this.now()
      })
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.emit({ type: 'error', runId, message })
      throw error
    } finally {
      externalSignal?.removeEventListener('abort', onExternalAbort)
      this.controllers.delete(controller)
    }
  }

  abort(): void {
    for (const controller of this.controllers) controller.abort()
  }

  async loadSession(id: string): Promise<SessionRecordView | null> {
    const session = await this.sessionStore.load(id)
    if (!session) return null
    return {
      id: session.id,
      task: session.task,
      status: session.status,
      summary: session.summary ?? null,
      messages: session.messages
    }
  }

  async listSessions(): Promise<SessionInfo[]> {
    const sessions = await this.sessionStore.list()
    return sessions.map((session) => ({
      id: session.id,
      task: session.task,
      status: session.status,
      updatedAt: session.updatedAt
    }))
  }
}
