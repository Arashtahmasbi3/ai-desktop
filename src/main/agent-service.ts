import type { AgentLogEntry, AgentLogger } from '@shared/agent'
import type { AgentRunResult } from '@shared/agent'
import type { ProviderId, ToolDefinition } from '@shared/types'
import type { RemoteFileEntry, VpsExecResult } from '@shared/vps'
import type { AgentEvent, AgentRunRequest, SessionInfo, SessionRecordView } from '@shared/ui'
import { AgentOrchestrator } from '@core/agent-orchestrator'
import type { ProviderEntry } from '@core/agent-orchestrator'
import type { ToolExecutor } from '@core/agent/tools'
import { PROVIDERS, createAdapterForConfig } from '@core/llm-adapters/registry'
import type { AuditEntry } from '@core/agent/audit-log'
import { REMOTE_SHELL_TOOL } from '@core/tools/remote-shell-tool'
import { RemoteShellToolExecutor } from '@core/tools/remote-shell-executor'
import { REMOTE_FS_TOOLS, type RemoteFsDeps } from '@core/tools/remote-fs-tools'
import { RemoteFsToolExecutor } from '@core/tools/remote-fs-executor'
import { CompositeToolExecutor, type ToolRoute } from '@core/tools/composite-executor'
import type { Persistence } from '@core/agent/persistence'
import type { SessionStore } from '@core/agent/session-store'
import type { SandboxManager } from '@shared/sandbox'
import type { CustomProviderStore } from './custom-providers'
import { loadProjectMemory } from './project-memory'

/**
 * The slice of the SSH manager the agent needs to run remote commands. Kept as
 * an interface so tests can inject a fake without a real SSH backend.
 */
export interface RemoteShellHost {
  connectedServers(): string[]
  exec(serverId: string, command: string): Promise<VpsExecResult>
}

/** SFTP surface the remote-fs tools use. Optional so older hosts still work. */
export interface RemoteFsHost {
  readFile(serverId: string, path: string): Promise<string>
  writeFile(serverId: string, path: string, content: string): Promise<void>
  listFiles(serverId: string, path: string): Promise<RemoteFileEntry[]>
  recordAudit?(entry: Omit<AuditEntry, 'at'>): Promise<unknown>
}

export type RemoteHost = RemoteShellHost & Partial<RemoteFsHost>

/** Keywords that make the agent reach for `remote_shell` on a default chat. */
const VPS_KEYWORDS = /\b(vps|ssh|server|remote|سرور|ریموت)\b/i

interface RemoteRuntime {
  extraTools?: ToolDefinition[]
  extraExecutor?: ToolExecutor
  systemHint?: string
}

/**
 * Pure decision function: does this task get the `remote_shell` tool, and if so
 * which server is it pinned to? Exported so it can be unit-tested without a real
 * SSH backend or LLM.
 */
export function planRemoteRuntime(
  task: string,
  vpsServerId: string | undefined,
  vps: RemoteHost | undefined
): RemoteRuntime {
  if (!vps) return {}
  const connected = vps.connectedServers()
  const wants = VPS_KEYWORDS.test(task)

  const pinned = vpsServerId && connected.includes(vpsServerId) ? vpsServerId : undefined
  if (!pinned && !(wants && connected.length > 0)) {
    if (wants && connected.length === 0) {
      return {
        systemHint:
          'The user asked about a VPS / remote server, but none is connected. ' +
          'Explain that they must add a VPS in Settings and connect it first, then retry.'
      }
    }
    return {}
  }

  const target = pinned ?? connected[0]
  const shellTool: ToolDefinition = {
    ...REMOTE_SHELL_TOOL,
    description: `${REMOTE_SHELL_TOOL.description} Use server_id="${target}".`
  }
  const shellExecutor = new RemoteShellToolExecutor(
    {
      exec: (serverId, command) => vps.exec(serverId, command),
      connectedServers: () => vps.connectedServers()
    },
    target
  )

  const extraTools: ToolDefinition[] = [shellTool]
  const routes: ToolRoute[] = [
    { names: new Set([REMOTE_SHELL_TOOL.name]), executor: shellExecutor }
  ]
  let hint =
    `You have access to the "remote_shell" tool on the connected VPS "${target}". ` +
    'Use it for tasks about that server; call it with server_id ' +
    `"${target}" and the shell command to run.`

  // Remote file tools are only offered when the host exposes SFTP.
  if (typeof vps.readFile === 'function') {
    const fsDeps: RemoteFsDeps = {
      connectedServers: () => vps.connectedServers(),
      readFile: (serverId, path) => vps.readFile!(serverId, path),
      writeFile: (serverId, path, content) => vps.writeFile!(serverId, path, content),
      listFiles: (serverId, path) => vps.listFiles!(serverId, path),
      exec: (serverId, command) => vps.exec(serverId, command)
    }
    if (typeof vps.recordAudit === 'function') {
      fsDeps.audit = (entry) => vps.recordAudit!(entry).then(() => undefined)
    }
    const fsTools = REMOTE_FS_TOOLS.map((tool) => ({
      ...tool,
      description: `${tool.description} Target server: "${target}".`
    }))
    extraTools.push(...fsTools)
    routes.push({
      names: new Set(fsTools.map((tool) => tool.name)),
      executor: new RemoteFsToolExecutor(fsDeps, target)
    })
    hint +=
      ` You also have the remote file tools ${fsTools.map((tool) => tool.name).join(', ')} ` +
      'for reading, writing, listing, grepping and checking git status on that server.'
  }

  const executor: ToolExecutor =
    routes.length === 1 ? shellExecutor : new CompositeToolExecutor(routes)

  return { extraTools, extraExecutor: executor, systemHint: hint }
}

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
  /** Optional: enables the `remote_shell` / remote-fs tools against connected VPS servers. */
  vps?: RemoteHost
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
  private readonly vps?: RemoteHost
  private readonly controllers = new Set<AbortController>()
  private runCounter = 0

  constructor(options: AgentServiceOptions) {
    this.sandbox = options.sandbox
    this.persistence = options.persistence
    this.sessionStore = options.sessionStore
    this.emit = options.emit
    this.now = options.now ?? (() => Date.now())
    if (options.customProviders) this.customProviders = options.customProviders
    if (options.vps) this.vps = options.vps
  }

  isRunning(): boolean {
    return this.controllers.size > 0
  }

  /**
   * Decide whether this run gets the `remote_shell` tool and, if so, build the
   * runtime that pins it to a server.
   */
  private buildRemoteRuntime(task: string, vpsServerId?: string): RemoteRuntime {
    return planRemoteRuntime(task, vpsServerId, this.vps)
  }

  /**
   * System hint built from the active project's AI_CONTEXT.md / AGENTS.md.
   * Remote projects are skipped (their files are not on this machine).
   */
  private async projectMemoryHint(): Promise<string | undefined> {
    try {
      const settings = await this.persistence.load()
      const active = settings.projects.find(
        (project) => project.id === settings.activeProjectId
      )
      if (!active || active.type === 'remote') return undefined
      return await loadProjectMemory(active.path)
    } catch {
      return undefined
    }
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
    const remote = this.buildRemoteRuntime(request.task, request.vpsServerId)
    const memory = await this.projectMemoryHint()
    const systemHint = [remote.systemHint, memory].filter(Boolean).join('\n\n')
    const orchestrator = new AgentOrchestrator({
      sandbox: this.sandbox,
      providers,
      logger: new EmittingLogger(this.emit),
      sessionStore: this.sessionStore,
      ...(request.sessionId ? { sessionId: request.sessionId } : {}),
      ...remote,
      ...(systemHint ? { systemHint } : {})
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
