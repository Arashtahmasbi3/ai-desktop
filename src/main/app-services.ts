import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { SandboxManager } from '@shared/sandbox'
import type { AgentEvent, RemoteStatus, SettingsView, WorkerStatus } from '@shared/ui'
import type { Persistence } from '@core/agent/persistence'
import type { SessionStore } from '@core/agent/session-store'
import { SandboxManagerImpl } from '@core/sandbox/manager'
import { WorkerManager } from '@core/worker/worker-manager'
import { RemoteServer } from '@core/remote/remote-server'
import { AgentService } from './agent-service'
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
  readonly files = new FileService()
  readonly chats: ChatStore
  readonly sandbox: SandboxManager
  readonly agent: AgentService
  readonly worker: WorkerManager
  readonly remote: RemoteServer

  private sender?: EventSender

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

    this.agent = new AgentService({
      sandbox: this.sandbox,
      persistence: this.persistence,
      sessionStore: this.sessions,
      customProviders: this.customProviders,
      vps: this.vps,
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

  private emit(channel: string, payload: unknown): void {
    this.sender?.(channel, payload)
  }

  /** Bring services up (currently: restore the active project). */
  async init(): Promise<void> {
    await this.persistence.load()
    await this.customProviders.load()
    await this.onboarding.load()
    await this.github.load()
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
      projects: settings.projects.map((project) => ({
        ...project,
        // Keep the record even when missing; the UI marks it instead of deleting.
        // Remote projects count as present while their VPS is connected.
        exists:
          project.type === 'remote'
            ? Boolean(project.vpsId && this.vps.isConnected(project.vpsId))
            : existsSync(project.path)
      }))
    }
    if (settings.activeProvider) view.activeProvider = settings.activeProvider
    if (activeId) view.activeProjectId = activeId
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
