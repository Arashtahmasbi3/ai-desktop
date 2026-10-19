import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { SandboxManager } from '@shared/sandbox'
import type { AgentEvent, DiagnosticStatus, RemoteStatus, SettingsView, WorkerStatus } from '@shared/ui'
import type { ProjectRecord } from '@shared/ui'
import type { ProviderId } from '@shared/types'
import type { CheckpointMode } from '@shared/decision-checkpoint'
import type { InvestigateScope, SessionProfile } from '@shared/profile'
import type { Persistence } from '@core/agent/persistence'
import type { SessionStore } from '@core/agent/session-store'
import { ApprovedCommands } from '@core/agent/approved-commands'
import { sweepStaleTempFilesInDir } from '@core/atomic-write'
import { RunStore } from '@core/agent/run-store'
import { GoalStore } from '@core/agent/goal-store'
import { classifyLocalProject } from '@shared/paths'
import { SandboxManagerImpl } from '@core/sandbox/manager'
import { WorkerManager } from '@core/worker/worker-manager'
import { RemoteServer } from '@core/remote/remote-server'
import { AgentService } from './agent-service'
import { ApprovalBroker } from './approval-broker'
import { PlanBroker } from './plan-broker'
import { PreflightBroker } from './preflight-broker'
import { QuestionBroker } from './question-broker'
import { SessionProfileService } from './session-profile-service'
import { FileService } from './file-service'
import { app, nativeImage } from 'electron'
import { spawn } from 'node:child_process'
import { AttachmentService } from './attachment-service'
import { FactStore } from './fact-store'
import { CheckpointStore } from './checkpoint-store'
import type { TranscriptMessage } from '@shared/memory-facts'
import { UpdateService, sha256OfFile, streamToFile } from './updater'
import { ChatStore } from './chat-store'
import {
  appDataDir,
  createAuditLog,
  createCustomProviderStore,
  createGitHubService,
  createMcpServerStore,
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
import { toView } from './mcp/store'
import type { McpServerStore } from './mcp/store'
import type { McpServerHandle } from './mcp/client'
import type {
  McpServerConfig,
  McpServerInput,
  McpServerStatus,
  McpServerView
} from '@shared/mcp'
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
  /**
   * X2: how long an unanswered question waits before the run pauses. Configured here, at
   * the composition root, so the deadline is a named value owned by `QuestionBroker` and
   * not a literal buried inside its `ask()`.
   */
  questionPauseAfterMs?: number
  /**
   * X2: how long an unanswered question waits after the pause before the run **ends** with a
   * diagnostic (no listener, closed window, headless worker). Also a named value, configured
   * here rather than hard-coded, so a harness can drive it to a few milliseconds.
   */
  questionAbandonAfterMs?: number
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
  /** Optional injected MCP server store (tests). */
  mcpServers?: McpServerStore
  /**
   * Optional injected MCP connect factory (tests). The app default spawns the configured command
   * over stdio; a test must never start a process for a tool it is only asserting the wiring of.
   */
  mcpConnect?: (config: McpServerConfig) => Promise<McpServerHandle>
}

/**
 * Wires the main-process services together: settings/sessions on disk, the
 * sandbox, the agent, the background worker and the optional remote server.
 */
/** Longest edge of a generated attachment preview, in pixels (v3.0). */
const THUMBNAIL_MAX_EDGE = 160

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
  /**
   * F0-2d: the configured MCP servers. Owned here (not by the agent) because Settings writes to
   * it between runs; the agent only reads it at the start of a run and never persists anything.
   */
  readonly mcpServers: McpServerStore
  readonly files = new FileService()
  /**
   * v2.9.0: desktop files/images the user attached, staged into the run workspace by
   * AgentService. Lives in main so the renderer only ever handles opaque ids.
   */
  /**
   * v3.0: auto-update. Dependency-free on purpose — the app ships exactly one runtime
   * dependency, and an updater that verifies the published SHA-256 before executing an
   * installer is worth more here than one that does not.
   */
  /**
   * v3.1: the project fact ledger. One JSON file per project under <userData>/facts, written
   * atomically; the agent gets a bounded, dated view of it in every system prompt.
   */
  readonly facts = new FactStore({ dir: join(appDataDir(), 'facts') })

  /**
   * v3.1: the append-only decision log. One JSONL per project, written only when the user turns
   * checkpoints on; nothing reads or grows it otherwise.
   */
  readonly checkpoints = new CheckpointStore({ dir: join(appDataDir(), 'checkpoints') })

  readonly updates = new UpdateService({
    currentVersion: app.getVersion(),
    fetchImpl: async (url: string) => {
      const response = await fetch(url, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "ai-desktop-updater" }
      })
      return { ok: response.ok, status: response.status, text: () => response.text() }
    },
    download: streamToFile,
    hashFile: sha256OfFile,
    runInstaller: async (path: string) => {
      // Detached so the installer outlives this process: the NSIS upgrade needs the app to
      // exit before it can replace its own files.
      const child = spawn(path, [], { detached: true, stdio: "ignore" })
      child.unref()
    }
  })

  readonly attachments = new AttachmentService({
    /*
     * v3.0: previews for attached images. nativeImage is Electron's own API (no new
     * dependency) and this callback is the injected seam that keeps AttachmentService
     * testable without a display. A missing or undecodable image yields undefined, which
     * simply means the chip shows no preview.
     */
    thumbnail: (path: string) => {
      const image = nativeImage.createFromPath(path)
      if (image.isEmpty()) return undefined
      const size = image.getSize()
      const longest = Math.max(size.width, size.height)
      // Never upscale: a tiny image is already its own thumbnail.
      const resized =
        longest > THUMBNAIL_MAX_EDGE ? image.resize({ width: THUMBNAIL_MAX_EDGE }) : image
      return resized.toDataURL()
    }
  })
  readonly chats: ChatStore
  readonly sandbox: SandboxManager
  /** Main-side Session Profile + elevation grant authority (v2.6.2, P0-5). */
  readonly sessionProfile: SessionProfileService
  readonly agent: AgentService
  readonly approvals: ApprovalBroker
  readonly plans: PlanBroker
  readonly preflights: PreflightBroker
  /** v2.8.0: mid-run questions from the model. */
  readonly questions: QuestionBroker
  readonly approvedCommands: ApprovedCommands
  /** Run -> project binding for patch isolation (v2.5, P0-1). */
  readonly runs = new RunStore()
  /** Project goals that outlive chats (v2.6.2, T4.1). */
  readonly goals: GoalStore
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
    this.mcpServers = options.mcpServers ?? createMcpServerStore(this.dir)

    this.approvals = new ApprovalBroker({
      emit: (event: AgentEvent) => this.emit('agent:event', event)
    })
    this.plans = new PlanBroker({
      emit: (event: AgentEvent) => this.emit('agent:event', event)
    })
    // v2.6.3 T3.2: interactive preflight override (fail closed to cancel).
    this.preflights = new PreflightBroker({
      emit: (event: AgentEvent) => this.emit('agent:event', event)
    })
    // v2.8.0: the model can ask the user a question mid-run and continue. X2: it is a
    // gate, not a nudge — an unanswered question leaves the run parked (see
    // QuestionBroker.pause) and only an explicit user action settles it. The abandonment
    // ceiling is the bounded last word: a run nobody can answer ends with a reason instead
    // of waiting forever (see QuestionBroker.abandon).
    this.questions = new QuestionBroker({
      emit: (event: AgentEvent) => this.emit('agent:event', event),
      // X2: both deadlines are configuration, not magic numbers inside `ask()`.
      ...(options.questionPauseAfterMs !== undefined
        ? { pauseAfterMs: options.questionPauseAfterMs }
        : {}),
      ...(options.questionAbandonAfterMs !== undefined
        ? { abandonAfterMs: options.questionAbandonAfterMs }
        : {})
    })
    this.sessionProfile = new SessionProfileService(this.persistence, {
      onChanged: (state) => this.emit('session:changed', state)
    })
    this.goals = new GoalStore({ dir: this.dir })
    this.approvedCommands = new ApprovedCommands({
      file: join(this.dir, 'approved-commands.json')
    })
    this.agent = new AgentService({
      facts: this.facts,
      checkpoints: this.checkpoints,
      sandbox: this.sandbox,
      persistence: this.persistence,
      sessionStore: this.sessions,
      userDataDir: this.dir,
      customProviders: this.customProviders,
      vps: this.vps,
      jobs: this.jobs,
      requestApproval: async (runId, action, reason) =>
        this.approvals.request(runId, action, {
          ...(await this.approvalContext()),
          ...(reason ? { reason } : {})
        }),
      cancelApprovals: () => this.approvals.cancelAll(),
      requestPlan: async (runId, plan, warnings) => this.plans.request(runId, plan, warnings),
      cancelPlans: () => this.plans.cancelAll(),
      // v2.6.3 T3.2: interactive preflight override. The broker fails closed to
      // cancel, so a dropped renderer can never silently force an action through.
      requestPreflight: async (runId, action, result, tier, context) =>
        this.preflights.request(runId, action, {
          tier,
          checks: result.checks,
          attempt: context.attempt,
          ...(await this.approvalContext())
        }),
      cancelPreflights: () => this.preflights.cancelAll(),
      // v2.8.0: mid-run questions. X2: this promise settles only on a user action, so an
      // unanswered question blocks the run instead of letting it proceed on its own.
      requestQuestion: (runId, question) => this.questions.ask(runId, question),
      cancelQuestions: () => this.questions.cancelAll(),
      approvedCommands: this.approvedCommands,
      files: this.files,
      attachments: this.attachments,
      runStore: this.runs,
      sessionProfile: this.sessionProfile,
      goalStore: this.goals,
      getDiagnosticPolicy: () => this.getDiagnosticPolicy(),
      resolveVpsName: async (id) => (await this.vpsServers.list()).find((s) => s.id === id)?.name,
      // F0-2c: the run reads the configured servers here and opens them itself; the connect
      // factory is injectable so a test can drive a run without spawning a process.
      mcpServers: this.mcpServers,
      ...(options.mcpConnect ? { mcpConnect: options.mcpConnect } : {}),
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

  /** Switch the Session Profile (v2.6.2, Topic 1). */
  async setSessionProfile(profile: SessionProfile): Promise<SettingsView> {
    await this.sessionProfile.setProfile(profile)
    return this.settingsView()
  }

  /** Choose Investigate's scope (`read-only` | `plan-only`). */
  async setInvestigateScope(scope: InvestigateScope): Promise<SettingsView> {
    await this.sessionProfile.setInvestigateScope(scope)
    return this.settingsView()
  }

  /** Explicit elevation consent: scoped + TTL-bounded, enforced in main. */
  async grantElevation(): Promise<SettingsView> {
    await this.sessionProfile.grantElevation()
    return this.settingsView()
  }

  /** Drop the elevation grant immediately. */
  async revokeElevation(): Promise<SettingsView> {
    await this.sessionProfile.revokeElevation()
    return this.settingsView()
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

  /** Notify the renderer that a project's goals changed (v2.6.2 T4.4). */
  emitGoalChanged(projectId: string, goalId?: string): void {
    this.emit('goal:changed', { projectId, ...(goalId ? { goalId } : {}) })
  }

  private emit(channel: string, payload: unknown): void {
    this.sender?.(channel, payload)
  }

  /** Bring services up (currently: restore the active project). */
  async init(): Promise<void> {
    // v2.7.0: clear the previous writer's orphaned temp files once per launch.
    // The per-target sweep inside `writeFileAtomic` only fires when that store is
    // loaded, so without this a user who never opens a VPS never gets the cleanup
    // and keeps the leftovers from the old writer indefinitely.
    await this.sweepOrphanedWrites()
    await this.persistence.load()
    await this.customProviders.load()
    await this.onboarding.load()
    await this.github.load()
    await this.approvedCommands.load()
    this.jobs.load(await this.jobStore.load())
    const project = this.persistence.getActiveProject()
    this.files.setRoot(project?.path)
    // Re-arm the elevation TTL for a grant persisted before this launch (P0-5).
    await this.sessionProfile.init()
    this.worker.start()
  }

  /**
   * Housekeeping for temp files orphaned by the pre-v2.6.5 writer. Best-effort:
   * a failure here must never stop the app from starting.
   */
  private async sweepOrphanedWrites(): Promise<void> {
    try {
      const removed = await sweepStaleTempFilesInDir(this.dir)
      if (removed > 0) this.emit('app:housekeeping', { removedTempFiles: removed })
    } catch {
      // Never block startup on cleanup.
    }
  }

  async dispose(): Promise<void> {
    this.sessionProfile.dispose()
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
    // v3.1: reported even when off, so the UI shows a choice rather than an empty field.
    view.checkpointMode = settings.checkpointMode ?? 'off'
    // The effective Session Profile (profile + grant-validated mode) travels with
    // the settings snapshot so the renderer never derives it on its own (P0-5).
    view.session = await this.sessionProfile.state()
    for (const [provider, value] of Object.entries(settings.providers)) {
      if (!value) continue
      /*
       * v3.1: a provider's keys can live in the pool (`apiKeysEnc`) rather than in the single-key
       * field, so `hasApiKey` must consider both — reporting "no key" for a provider that has two
       * would be worse than reporting nothing. `keyCount` is the count the Settings panel shows, and
       * it is the only thing about the keys that ever crosses to the renderer.
       */
      const pooled = Array.isArray(value.apiKeysEnc)
        ? value.apiKeysEnc.filter((entry) => typeof entry === 'string' && entry !== '').length
        : 0
      view.providers[provider as keyof SettingsView['providers']] = {
        hasApiKey: Boolean(value.apiKeyEnc) || pooled > 0,
        keyCount: pooled > 0 ? pooled : value.apiKeyEnc ? 1 : 0,
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
  /**
   * v3.1: learn facts from a saved chat.
   *
   * Main reads the chat itself rather than accepting a transcript from the renderer: the text
   * already exists in the chat store, and not shipping it over IPC keeps the bridge's payload
   * small and the source of truth in one place. The task line is the chat title, which is what
   * the user named the session.
   */
  async learnFactsFromChat(chatId: string): Promise<{ learned: number; superseded: number; skipped?: string; error?: string }> {
    const chat = await this.chats.load(chatId)
    if (!chat) return { learned: 0, superseded: 0, skipped: 'no-transcript' }
    const messages: TranscriptMessage[] = chat.messages.map((message) => ({
      role: message.role,
      content: message.content
    }))
    return this.agent.learnFacts({ messages, task: chat.title })
  }

  /** v3.1: set the decision-checkpoint mode and return the settings view. */
  async setCheckpointMode(mode: CheckpointMode): Promise<SettingsView> {
    await this.persistence.setCheckpointMode(mode)
    return this.settingsView()
  }

  /** v3.1: add a key to a provider's pool and return the redacted settings view. */
  async addProviderKey(provider: ProviderId, apiKey: string): Promise<SettingsView> {
    await this.persistence.addApiKey(provider, apiKey)
    return this.settingsView()
  }

  /** v3.1: remove one key from a provider's pool by position. */
  async removeProviderKeyAt(provider: ProviderId, index: number): Promise<SettingsView> {
    await this.persistence.removeApiKeyAt(provider, index)
    return this.settingsView()
  }

  /**
   * The configured MCP servers as Settings sees them (F0-2d): a launch line, the enabled flag and
   * what the last run observed. Never `env` and never the raw command line — a token lives in the
   * environment block, and the renderer has no business seeing it.
   */
  async mcpServerViews(): Promise<McpServerView[]> {
    const servers = await this.mcpServers.list()
    const observed = new Map(this.agent.mcpStatuses().map((status) => [status.serverId, status]))
    return servers.map((server) => {
      const view = toView(server)
      const status = observed.get(server.id)
      // `disconnected` adds nothing to a row that is already visibly not running.
      if (status === undefined || status.state === 'disconnected') return view
      return {
        ...view,
        ...(status.state === 'connected' ? { toolCount: status.toolCount } : {}),
        ...(status.error === undefined ? {} : { error: status.error })
      }
    })
  }

  /**
   * One status per configured server (F0-2d, `mcp:status`). A server no run has connected yet
   * reads as `disconnected`, which is the truth: nothing has opened it.
   */
  async mcpStatuses(): Promise<McpServerStatus[]> {
    const servers = await this.mcpServers.list()
    const observed = new Map(this.agent.mcpStatuses().map((status) => [status.serverId, status]))
    return servers.map(
      (server) =>
        observed.get(server.id) ?? {
          serverId: server.id,
          state: 'disconnected' as const,
          toolCount: 0
        }
    )
  }

  /** Add or edit a server, and return the whole list: the renderer re-renders from one snapshot. */
  async saveMcpServer(input: McpServerInput): Promise<McpServerView[]> {
    await this.mcpServers.save(input)
    return this.mcpServerViews()
  }

  async removeMcpServer(id: string): Promise<McpServerView[]> {
    await this.mcpServers.remove(id)
    return this.mcpServerViews()
  }

  async setMcpServerEnabled(id: string, enabled: boolean): Promise<McpServerView[]> {
    await this.mcpServers.setEnabled(id, enabled)
    return this.mcpServerViews()
  }

  static sessionDir(dir = appDataDir()): string {
    return join(dir, 'sessions')
  }
}
