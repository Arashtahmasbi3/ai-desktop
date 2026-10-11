import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { SandboxManager } from '@shared/sandbox'
import type { AgentEvent, DiagnosticStatus, RemoteStatus, SettingsView, WorkerStatus } from '@shared/ui'
import type { ProjectRecord } from '@shared/ui'
import type { Persistence } from '@core/agent/persistence'
import type { SessionStore } from '@core/agent/session-store'
import { ApprovedCommands } from '@core/agent/approved-commands'
import { RunStore } from '@core/agent/run-store'
import { classifyLocalProject } from '@shared/paths'
import { SandboxManagerImpl } from '@core/sandbox/manager'
import { WorkerManager } from '@core/worker/worker-manager'
import { RemoteServer } from '@core/remote/remote-server'
import { AgentService } from './agent-service'
import { ApprovalBroker } from './approval-broker'
import { PlanBroker } from './plan-broker'
import { FileService } from './file-service'
import { ChatStore } from './chat-store'
import {
  appDataDir,
  createAuditLog,
  createCustomProviderStore,
  createGitHubService,
  createOnboardingStore,
  createSessionStore,
  createSettingsStore,
  createVpsServerStore,
  sandboxDir
} from './stores'
import type { CustomProviderStore } from './custom-providers'
import type { OnboardingStore } from './onboarding-store'
import type { GitHubService } from './github/service'
import { SshManager } from './ssh/ssh-manager'
import { Ssh2Backend } from './ssh/ssh2-backend'
import type { VpsServerStore } from './ssh/server-store'
import { JobManager } from '@core/agent/job-manager'
import {
  createDiagnosticPolicy,
  diagnosticRemainingMs,
  isDiagnosticActive,
  DEFAULT_DIAGNOSTIC_PATHS,
  type DiagnosticPolicy
} from '@core/remote/diagnostic-policy'
import { createJobStore } from './job-store'

export type EventSender = (channel: string, payload: unknown) => void

export interface AppServicesOptions {
  sender?: EventSender
  sandbox?: SandboxManager
  dir?: string
  /** Optional remote port; 0 lets the OS choose a free port. */
  remotePort?: number
  /** Optional injected custom-provider store (tests). */
  customProviders?: CustomProviderStore
  /** Optional injected onboarding store (tests). */
  onboarding?: OnboardingStore
  /** Optional injected GitHub service (tests). */
  github?: GitHubService
  /** Optional injected SSH manager (tests). */
  vps?: SshManager
  /** Optional injected VPS store (tests). */
  vpsServers?: VpsServerStore
  /** Optional injected job manager (tests). */
  jobs?: JobManager
}

/**
 * Wires the main-process services together: settings/sessions on disk, the
 * sandbox, the agent, the background worker and the optional remote server.
 */
export class AppServices {
  readonly dir: string
  readonly persistence: Persistence
  readonly sessions: SessionStore
  readonly customProviders: CustomProviderStore
  readonly onboarding: OnboardingStore
  readonly github: GitHubService
  readonly vpsServers: VpsServerStore
  readonly vps: SshManager
  readonly jobs: JobManager
  readonly files = new FileService()
  readonly chats: ChatStore
  readonly sandbox: SandboxManager
  readonly agent: AgentService
  readonly approvals: ApprovalBroker
  readonly plans: PlanBroker
  readonly approvedCommands: ApprovedCommands
  /** Run -> project binding for patch isolation (v2.5, P0-1). */
  readonly runs = new RunStore()
  readonly worker: WorkerManager
  readonly remote: RemoteServer

  private sender?: EventSender
  private readonly jobStore: ReturnType<typeof createJobStore>
  /**
   * User-enabled, read-only widening of P0-2 (v2.5.3). Held in memory only, so it
   * never survives an app restart; the 30-minute window is enforced on read.
   */
  private diagnosticPolicy: DiagnosticPolicy | null = null

  constructor(options: AppServicesOptions = {}) {
    this.sender = options.sender
    this.dir = options.dir ?? appDataDir()
    this.persistence = createSettingsStore(this.dir)
    this.sessions = createSessionStore(this.dir)
    this.customProviders = options.customProviders ?? createCustomProviderStore(this.dir)
    this.chats = new ChatStore(this.dir)
    this.onboarding = options.onboarding ?? createOnboardingStore(this.dir)
    this.github = options.github ?? createGitHubService(this.dir)
    this.vpsServers = options.vpsServers ?? createVpsServerStore(this.dir)
    this.vps =
      options.vps ??
      new SshManager({
        store: this.vpsServers,
        backend: new Ssh2Backend(),
        audit: createAuditLog(this.dir),
        onStatus: (state) => this.emit('vps:status', state),
        onData: (sessionId, chunk) => this.emit('vps:data', { sessionId, chunk })
      })
    this.sandbox =
      options.sandbox ??
      new SandboxManagerImpl({ baseDir: sandboxDir(this.dir) })

    this.jobStore = createJobStore(this.dir)
    this.jobs =
      options.jobs ??
      new JobManager({
        exec: (serverId, command) => this.vps.exec(serverId, command),
        persist: (jobs) => {
          void this.jobStore.save(jobs).catch(() => undefined)
        }
      })

    this.approvals = new ApprovalBroker({
      emit: (event: AgentEvent) => this.emit('agent:event', event)
    })
    this.plans = new PlanBroker({
      emit: (event: AgentEvent) => this.emit('agent:event', event)
    })
    this.approvedCommands = new ApprovedCommands({
      file: join(this.dir, 'approved-commands.json')
    })
    this.agent = new AgentService({
      sandbox: this.sandbox,
      persistence: this.persistence,
      sessionStore: this.sessions,
      customProviders: this.customProviders,
      vps: this.vps,
      jobs: this.jobs,
      requestApproval: async (runId, action) =>
        this.approvals.request(runId, action, await this.approvalContext()),
      cancelApprovals: () => this.approvals.cancelAll(),
      requestPlan: async (runId, plan, warnings) => this.plans.request(runId, plan, warnings),
      cancelPlans: () => this.plans.cancelAll(),
      approvedCommands: this.approvedCommands,
      files: this.files,
      runStore: this.runs,
      getDiagnosticPolicy: () => this.getDiagnosticPolicy(),
      resolveVpsName: async (id) => (await this.vpsServers.list()).find((s) => s.id === id)?.name,
      emit: (event: AgentEvent) => this.emit('agent:event', event)
    })

    this.worker = new WorkerManager({
      sandbox: this.sandbox,
      runTask: (task, signal) => this.agent.run({ task }, signal),
      onStatus: (status: WorkerStatus) => this.emit('worker:status', status)
    })

    this.remote = new RemoteServer({
      port: options.remotePort ?? 0,
      onStatus: (status: RemoteStatus) => this.emit('remote:status', status),
      onRequest: (method, params) => this.handleRemote(method, params)
    })
  }

  setSender(sender: EventSender | undefined): void {
    this.sender = sender
  }

  /**
   * The active Diagnostic Policy for this run, or null. The object carries its own
   * expiry, so a stale-but-not-yet-cleared policy is still a no-op. We clear it on
   * read once expired so memory never holds a dead policy.
   */
  getDiagnosticPolicy(): DiagnosticPolicy | null {
    if (this.diagnosticPolicy && !isDiagnosticActive(this.diagnosticPolicy)) {
      this.diagnosticPolicy = null
    }
    return this.diagnosticPolicy
  }

  /** Snapshot for the renderer (Settings toggle + chat badge). */
  diagnosticStatus(): DiagnosticStatus {
    const policy = this.getDiagnosticPolicy()
    const remainingMs = diagnosticRemainingMs(policy)
    return {
      active: isDiagnosticActive(policy),
      expiresAt: policy?.expiresAt ?? null,
      remainingMs,
      allowedPaths: policy?.allowedPaths ?? DEFAULT_DIAGNOSTIC_PATHS
    }
  }

  /** Enable Diagnostic Mode for the next 30 minutes and broadcast the change. */
  enableDiagnosticMode(): DiagnosticStatus {
    this.diagnosticPolicy = createDiagnosticPolicy()
    const status = this.diagnosticStatus()
    this.emit('diagnostic:status', status)
    return status
  }

  /** Disable Diagnostic Mode immediately. */
  disableDiagnosticMode(): DiagnosticStatus {
    this.diagnosticPolicy = null
    const status = this.diagnosticStatus()
    this.emit('diagnostic:status', status)
    return status
  }

  /** Working directory / server shown in the approval dialog. */
  private async approvalContext(): Promise<{ workingDirectory?: string; server?: string }> {
    const context: { workingDirectory?: string; server?: string } = {}
    const project = this.persistence.getActiveProject()
    if (project) {
      context.workingDirectory = project.path
      if (project.type === 'remote' && project.vpsId) {
        const server = (await this.vpsServers.list()).find((entry) => entry.id === project.vpsId)
        if (server) context.server = `${server.name} (${server.host})`
      }
    }
    return context
  }

  private emit(channel: string, payload: unknown): void {
    this.sender?.(channel, payload)
  }

  /** Bring services up (currently: restore the active project). */
  async init(): Promise<void> {
    await this.persistence.load()
    await this.customProviders.load()
    await this.onboarding.load()
    await this.github.load()
    await this.approvedCommands.load()
    this.jobs.load(await this.jobStore.load())
    const project = this.persistence.getActiveProject()
    this.files.setRoot(project?.path)
    this.worker.start()
  }

  async dispose(): Promise<void> {
    await this.vps.disconnectAll().catch(() => undefined)
    await this.remote.stop().catch(() => undefined)
    await this.worker.stop().catch(() => undefined)
    await this.sandbox.destroyAll().catch(() => undefined)
  }

  async settingsView(): Promise<SettingsView> {
    const settings = await this.persistence.load()
    const activeId = settings.activeProjectId
    const view: SettingsView = {
      platform: process.platform,
      providers: {},
      projects: settings.projects.map((project) => {
        // Keep the record even when missing; the UI marks it instead of deleting.
        // Remote projects count as present while their VPS is connected.
        const exists =
          project.type === 'remote'
            ? Boolean(project.vpsId && this.vps.isConnected(project.vpsId))
            : existsSync(project.path)
        return {
          ...project,
          exists,
          osMismatch:
            project.type !== 'remote' &&
            classifyLocalProject(project.path, process.platform, exists) === 'os-mismatch'
        }
      })
    }
    if (settings.activeProvider) view.activeProvider = settings.activeProvider
    if (activeId) view.activeProjectId = activeId
    if (settings.approvalMode) view.approvalMode = settings.approvalMode
    if (settings.planModeDefault !== undefined) view.planModeDefault = settings.planModeDefault
    if (settings.rememberApprovalMode !== undefined) {
      view.rememberApprovalMode = settings.rememberApprovalMode
    }
    for (const [provider, value] of Object.entries(settings.providers)) {
      if (!value) continue
      view.providers[provider as keyof SettingsView['providers']] = {
        hasApiKey: Boolean(value.apiKeyEnc),
        ...(value.model ? { model: value.model } : {}),
        ...(value.baseUrl ? { baseUrl: value.baseUrl } : {})
      }
    }
    return view
  }

  /** One project's metadata (with computed `exists`), or undefined when unknown. */
  getProjectMetadata(id: string): ProjectRecord | undefined {
    const project = this.persistence.listProjects().find((entry) => entry.id === id)
    if (!project) return undefined
    const exists =
      project.type === 'remote'
        ? Boolean(project.vpsId && this.vps.isConnected(project.vpsId))
        : existsSync(project.path)
    return { ...project, exists }
  }

  /** Open the active project in the file service and notify the renderer. */
  async openActiveProject(): Promise<void> {
    const project = this.persistence.getActiveProject()
    this.files.setRoot(project?.path)
    if (project) this.emit('files:changed', { root: project.path })
  }

  /** Handlers exposed to the remote server (already token-authenticated). */
  private async handleRemote(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case 'status':
        return { worker: this.worker.getStatus(), remote: this.remote.getStatus() }
      case 'worker.submit':
        return this.worker.enqueue(params as never)
      case 'worker.cancel':
        return this.worker.cancel(String((params as { id?: string })?.id ?? ''))
      case 'files.list': {
        const { path } = (params ?? {}) as { path?: string }
        return this.files.list(path ?? '.')
      }
      case 'files.read': {
        const { path } = (params ?? {}) as { path?: string }
        if (!path) throw new Error('path is required')
        return this.files.read(path)
      }
      default:
        throw new Error(`Unknown remote method: ${method}`)
    }
  }

  /** Convenience for tests and diagnostics. */
  static sessionDir(dir = appDataDir()): string {
    return join(dir, 'sessions')
  }
}
