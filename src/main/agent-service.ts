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
import type { CustomProviderStore } from './custom-providers'

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
  /** Optional: enables user-defined OpenAI-compatible providers. */
  customProviders?: CustomProviderStore
}

/** Which provider/model to put first for an agent run. */
export interface ProviderSelection {
  preferred?: ProviderId
  model?: string
  customProviderId?: string
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
  private readonly customProviders?: CustomProviderStore
  private readonly controllers = new Set<AbortController>()
  private runCounter = 0

  constructor(options: AgentServiceOptions) {
    this.sandbox = options.sandbox
    this.persistence = options.persistence
    this.sessionStore = options.sessionStore
    this.emit = options.emit
    this.now = options.now ?? (() => Date.now())
    if (options.customProviders) this.customProviders = options.customProviders
  }

  isRunning(): boolean {
    return this.controllers.size > 0
  }

  /** Build provider entries (with keys) ordered by preference. */
  async buildProviders(options: ProviderSelection = {}): Promise<ProviderEntry[]> {
    const settings = await this.persistence.load()
    const ids = Object.keys(PROVIDERS) as ProviderId[]
    const order = providerOrder(ids, options.preferred, settings.activeProvider)

    const entries: ProviderEntry[] = []
    let primaryIsCustom = false

    if (options.customProviderId) {
      const custom = this.customProviders
        ? await this.customProviders.getDecrypted(options.customProviderId)
        : null
      if (!custom) {
        throw new Error('Selected custom provider was not found. Re-add it in Settings.')
      }
      // Custom endpoints speak the OpenAI protocol, so they reuse that adapter.
      const config = {
        provider: 'openai' as ProviderId,
        apiKey: custom.apiKey,
        model: options.model ?? custom.model,
        baseUrl: custom.baseUrl,
        ...(custom.headers ? { headers: custom.headers } : {})
      }
      entries.push({ provider: 'openai', adapter: createAdapterForConfig(config), config })
      primaryIsCustom = true
    }

    const candidates: Array<{
      id: ProviderId
      apiKey: string
      model?: string
      baseUrl?: string
    }> = []
    for (const id of order) {
      const stored = settings.providers[id]
      if (!stored?.apiKeyEnc) continue
      const apiKey = await this.persistence.getApiKey(id)
      if (!apiKey) continue
      candidates.push({
        id,
        apiKey,
        ...(stored.model ? { model: stored.model } : {}),
        ...(stored.baseUrl ? { baseUrl: stored.baseUrl } : {})
      })
    }

    entries.push(
      ...candidates.map((candidate, index) => {
        const descriptor = PROVIDERS[candidate.id]
        // The model chosen in the chat header overrides only the primary entry;
        // fallback providers keep their own configured model.
        const model =
          !primaryIsCustom && index === 0 && options.model
            ? options.model
            : (candidate.model ?? descriptor.defaultModel)
        const config = {
          provider: candidate.id,
          apiKey: candidate.apiKey,
          model,
          baseUrl: candidate.baseUrl ?? descriptor.defaultBaseUrl
        }
        return { provider: candidate.id, adapter: createAdapterForConfig(config), config }
      })
    )

    if (entries.length === 0) {
      throw new Error('No API key configured. Add one in Settings.')
    }

    return entries
  }

  async run(request: AgentRunRequest, externalSignal?: AbortSignal): Promise<AgentRunResult> {
    const providers = await this.buildProviders({
      ...(request.provider ? { preferred: request.provider } : {}),
      ...(request.model ? { model: request.model } : {}),
      ...(request.customProviderId ? { customProviderId: request.customProviderId } : {})
    })
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
        provider: providers[0].provider,
        model: providers[0].config.model,
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
