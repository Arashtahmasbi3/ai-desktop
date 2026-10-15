import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { CustomProviderInput, CustomProviderTestResult, CustomProviderView, ProviderId } from '@shared/types'
import type { OnboardingStatus } from '@shared/onboarding'
import type { ApprovalMode, ApprovalHistoryEntry, ApprovalOutcome, ApprovedCommandView } from '@shared/approval'
import type { InvestigateScope, ResolvedProfile, SessionProfile } from '@shared/profile'
import type { PlanDecision } from '@shared/plan'
import type { PreflightChoice } from '@shared/preflight'
import type { ChatSaveInput, ChatSummary, StoredChat } from '@shared/chat'
import type {
  AuditEntryView,
  HealthCheckConfig,
  HealthCheckOutcome,
  RemoteFileEntry,
  SshConfigHost,
  VpsConnectionState,
  VpsExecResult,
  VpsServerInput,
  VpsServerView
} from '@shared/vps'
import type {
  GitCommitInput,
  GitOpResult,
  GitRepoStatus,
  GitHubAuthPollResult,
  GitHubAuthStatus,
  GitHubDeviceCode,
  GitHubIssue,
  GitHubPull,
  GitHubRepo
} from '@shared/github'
import type {
  AgentRunRequest,
  AppEventMap,
  DiagnosticStatus,
  RemoteStatus,
  SessionInfo,
  CodeMatch,
  LocalShellResult,
  ProjectRecord,
  SessionRecordView,
  SessionMemoryView,
  SettingsView,
  WorkerJobRequest,
  WorkerJobView,
  WorkerStatus
} from '@shared/ui'
import type { AttachmentRefView } from '@shared/attachments'
import type { AuditVerifyResult, TraceExplanation } from '@shared/trace'
import type { ProjectMetadataPatch } from '@shared/project-metadata'
import type { Goal, GoalUpdate, NewGoalInput } from '@shared/goal'
import type { ResolvedGoal } from '@core/agent/goal-store'

import type {
  GitSetupOptions,
  RemoteCommandRun,
  RemoteGitStatus,
  RemoteWorkspaceInfo
} from '@shared/workspace-info'
import type { SystemHealth } from '@shared/system-health'
import type { Job } from '@shared/jobs'

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>

export const api = {
  app: {
    ping: (): Promise<string> => invoke<string>('app:ping'),
    /** v2.6.5: the running app version, so the UI never hardcodes it. */
    version: (): Promise<string> => invoke<string>('app:version')
  },

  window: {
    minimize: (): Promise<void> => invoke('window:minimize'),
    toggleMaximize: (): Promise<boolean> => invoke('window:toggleMaximize'),
    close: (): Promise<void> => invoke('window:close'),
    isMaximized: (): Promise<boolean> => invoke('window:isMaximized'),
    newWindow: (): Promise<boolean> => invoke('window:new'),
    /** v2.6.2 T5.3: set the Electron zoom level (0 = 100%). */
    setZoom: (level: number): Promise<number> => invoke('window:zoom', level)
  },

  settings: {
    get: (): Promise<SettingsView> => invoke('settings:get'),
    setApiKey: (provider: ProviderId, apiKey: string): Promise<SettingsView> =>
      invoke('settings:setApiKey', provider, apiKey),
    removeApiKey: (provider: ProviderId): Promise<SettingsView> =>
      invoke('settings:removeApiKey', provider),
    setModel: (provider: ProviderId, model: string): Promise<SettingsView> =>
      invoke('settings:setModel', provider, model),
    setActiveProvider: (provider: ProviderId): Promise<SettingsView> =>
      invoke('settings:setActiveProvider', provider),
    setApprovalMode: (mode: ApprovalMode): Promise<SettingsView> =>
      invoke('settings:setApprovalMode', mode),
    setPlanModeDefault: (enabled: boolean): Promise<SettingsView> =>
      invoke('settings:setPlanModeDefault', enabled),
    setRememberApprovalMode: (enabled: boolean): Promise<SettingsView> =>
      invoke('settings:setRememberApprovalMode', enabled),
    addProject: (name: string, path: string): Promise<SettingsView> =>
      invoke('settings:addProject', name, path),
    addRemoteProject: (name: string, path: string, vpsId: string): Promise<SettingsView> =>
      invoke('settings:addRemoteProject', name, path, vpsId),
    removeProject: (id: string): Promise<SettingsView> => invoke('settings:removeProject', id),
    updateProjectPath: (id: string, path: string): Promise<SettingsView> =>
      invoke('settings:updateProjectPath', id, path)
  },

  dialog: {
    pickDirectory: (): Promise<string | null> => invoke('dialog:pickDirectory'),
    pickFile: (): Promise<string[]> => invoke('dialog:pickFile')
  },
  /**
   * v2.9.0: hand picked absolute paths to main and get back opaque refs. The renderer
   * never reads the file itself; the agent reaches it through the staged workspace copy.
   */
  attachments: {
    register: (paths: string[]): Promise<AttachmentRefView[]> =>
      invoke('attachments:register', paths)
  },

  projects: {
    open: (id: string): Promise<SettingsView> => invoke('projects:open', id),
    getMetadata: (id: string): Promise<ProjectRecord | null> =>
      invoke('projects:getMetadata', id),
    updateMetadata: (id: string, patch: ProjectMetadataPatch): Promise<SettingsView> =>
      invoke('projects:updateMetadata', id, patch)
  },

  chats: {
    list: (): Promise<ChatSummary[]> => invoke('chats:list'),
    load: (id: string): Promise<StoredChat | null> => invoke('chats:load', id),
    save: (input: ChatSaveInput): Promise<StoredChat> => invoke('chats:save', input),
    rename: (id: string, title: string): Promise<ChatSummary | null> =>
      invoke('chats:rename', id, title),
    linkProject: (id: string, workspaceId: string): Promise<ChatSummary | null> =>
      invoke('chats:linkProject', id, workspaceId),
    remove: (id: string): Promise<boolean> => invoke('chats:remove', id)
  },

  customProviders: {
    list: (): Promise<CustomProviderView[]> => invoke('customProviders:list'),
    save: (input: CustomProviderInput): Promise<CustomProviderView> =>
      invoke('customProviders:save', input),
    remove: (id: string): Promise<boolean> => invoke('customProviders:remove', id),
    test: (input: CustomProviderInput): Promise<CustomProviderTestResult> =>
      invoke('customProviders:test', input)
  },

  onboarding: {
    get: (): Promise<OnboardingStatus> => invoke('onboarding:get'),
    complete: (): Promise<OnboardingStatus> => invoke('onboarding:complete')
  },

  github: {
    status: (): Promise<GitHubAuthStatus> => invoke('github:status'),
    setClientId: (clientId: string): Promise<GitHubAuthStatus> =>
      invoke('github:setClientId', clientId),
    setToken: (token: string): Promise<GitHubAuthStatus> => invoke('github:setToken', token),
    startAuth: (): Promise<GitHubDeviceCode> => invoke('github:startAuth'),
    pollAuth: (deviceCode: string): Promise<GitHubAuthPollResult> =>
      invoke('github:pollAuth', deviceCode),
    logout: (): Promise<GitHubAuthStatus> => invoke('github:logout'),
    repos: (): Promise<GitHubRepo[]> => invoke('github:repos'),
    pulls: (owner: string, repo: string, state?: string): Promise<GitHubPull[]> =>
      invoke('github:pulls', owner, repo, state),
    issues: (owner: string, repo: string, state?: string): Promise<GitHubIssue[]> =>
      invoke('github:issues', owner, repo, state),
    gitStatus: (cwd: string): Promise<GitRepoStatus> => invoke('github:gitStatus', cwd),
    gitClone: (url: string, target: string): Promise<GitOpResult> =>
      invoke('github:gitClone', url, target),
    gitPull: (cwd: string): Promise<GitOpResult> => invoke('github:gitPull', cwd),
    gitPush: (cwd: string): Promise<GitOpResult> => invoke('github:gitPush', cwd),
    gitCommit: (cwd: string, input: GitCommitInput): Promise<GitOpResult> =>
      invoke('github:gitCommit', cwd, input),
    gitCheckout: (cwd: string, branch: string, create?: boolean): Promise<GitOpResult> =>
      invoke('github:gitCheckout', cwd, branch, create)
  },

  vps: {
    list: (): Promise<VpsServerView[]> => invoke('vps:list'),
    save: (input: VpsServerInput): Promise<VpsServerView> => invoke('vps:save', input),
    remove: (id: string): Promise<boolean> => invoke('vps:remove', id),
    status: (): Promise<VpsConnectionState> => invoke('vps:status'),
    connected: (): Promise<string[]> => invoke('vps:connected'),
    connect: (id: string): Promise<VpsConnectionState> => invoke('vps:connect', id),
    disconnect: (id: string): Promise<VpsConnectionState> => invoke('vps:disconnect', id),
    keepAlive: (id: string): Promise<VpsConnectionState> => invoke('vps:keepAlive', id),
    approveFingerprint: (id: string): Promise<VpsConnectionState> =>
      invoke('vps:approveFingerprint', id),
    exec: (id: string, command: string): Promise<VpsExecResult> => invoke('vps:exec', id, command),
    audit: (): Promise<AuditEntryView[]> => invoke('vps:audit'),
    importSshConfig: (): Promise<SshConfigHost[]> => invoke('vps:importSshConfig'),
    healthCheck: (id: string, config: HealthCheckConfig): Promise<HealthCheckOutcome> =>
      invoke('vps:healthCheck', id, config),
    searchProject: (id: string, name: string): Promise<string[]> =>
      invoke('vps:searchProject', id, name),
    listDirs: (id: string, path: string): Promise<string[]> => invoke('vps:listDirs', id, path),
    gitStatus: (id: string, path: string): Promise<string> => invoke('vps:gitStatus', id, path),
    // --- v2.3.3: git-aware + self-diagnosis ---
    workspaceInfo: (id: string, path: string): Promise<RemoteWorkspaceInfo> =>
      invoke('vps:workspaceInfo', id, path),
    gitStatusParsed: (id: string, path: string): Promise<RemoteGitStatus> =>
      invoke('vps:gitStatusParsed', id, path),
    systemHealth: (id: string): Promise<SystemHealth> => invoke('vps:systemHealth', id),
    gitSetup: (
      id: string,
      path: string,
      options: GitSetupOptions
    ): Promise<RemoteCommandRun> => invoke('vps:gitSetup', id, path, options),
    installTool: (
      id: string,
      tool: string,
      approved: boolean,
      elevated: boolean
    ): Promise<RemoteCommandRun> =>
      invoke('vps:installTool', id, tool, approved, elevated),
    terminalOpen: (id: string, cols?: number, rows?: number): Promise<string> =>
      invoke('vps:terminalOpen', id, cols, rows),
    terminalWrite: (id: string, data: string): Promise<void> => invoke('vps:terminalWrite', id, data),
    terminalResize: (id: string, cols: number, rows: number): Promise<void> =>
      invoke('vps:terminalResize', id, cols, rows),
    terminalClose: (id: string, sessionId?: string): Promise<void> =>
      invoke('vps:terminalClose', id, sessionId),
    files: {
      list: (id: string, path: string): Promise<RemoteFileEntry[]> =>
        invoke('vps:files:list', id, path),
      read: (id: string, path: string): Promise<string> => invoke('vps:files:read', id, path),
      write: (id: string, path: string, content: string): Promise<void> =>
        invoke('vps:files:write', id, path, content),
      restoreBackup: (id: string, backupPath: string): Promise<void> =>
        invoke('vps:files:restoreBackup', id, backupPath)
    }
  },

  fs: {
    list: (path?: string): Promise<unknown> => invoke('files:list', path),
    read: (path: string): Promise<string> => invoke('files:read', path),
    write: (path: string, content: string): Promise<void> => invoke('files:write', path, content),
    create: (path: string, type: 'file' | 'dir'): Promise<void> =>
      invoke('files:create', path, type),
    remove: (path: string): Promise<void> => invoke('files:remove', path),
    reveal: (path: string): Promise<void> => invoke('files:reveal', path)
  },

  agent: {
    run: (request: AgentRunRequest): Promise<unknown> => invoke('agent:run', request),
    abort: (): Promise<void> => invoke('agent:abort'),
    respondApproval: (id: string, answer: boolean | ApprovalOutcome): Promise<boolean> =>
      invoke('agent:respondApproval', id, answer),
    respondPlan: (id: string, decision: PlanDecision): Promise<boolean> =>
      invoke('agent:respondPlan', id, decision),
    /** v2.8.0: answer a mid-run question from the agent. */
    respondQuestion: (id: string, answer: string | null): Promise<boolean> =>
      invoke('agent:respondQuestion', id, answer),
    respondPreflight: (id: string, choice: PreflightChoice): Promise<boolean> =>
      invoke('agent:respondPreflight', id, choice),
    stopPlan: (runId?: string): Promise<boolean> => invoke('agent:stopPlan', runId),
    approvalHistory: (): Promise<ApprovalHistoryEntry[]> => invoke('agent:approvalHistory'),
    approvedCommands: (): Promise<ApprovedCommandView[]> => invoke('agent:approvedCommands'),
    revokeApprovedCommand: (id: string): Promise<boolean> =>
      invoke('agent:revokeApprovedCommand', id),
    rememberApprovalTool: (tool: string): Promise<boolean> =>
      invoke('agent:rememberApprovalTool', tool),
    applyChange: (id: string): Promise<boolean> => invoke('agent:applyChange', id),
    rejectChange: (id: string): Promise<boolean> => invoke('agent:rejectChange', id),
    sessions: (): Promise<SessionInfo[]> => invoke('agent:sessions'),
    loadSession: (id: string): Promise<SessionRecordView | null> => invoke('agent:loadSession', id),
    memory: (id: string): Promise<SessionMemoryView> => invoke('agent:memory', id),
    clearMemory: (id: string): Promise<boolean> => invoke('agent:clearMemory', id),
    // v2.6.2 (T3.2): explain a trace decision deterministically ("Ask Why").
    explainStep: (runId: string, decisionId: string): Promise<TraceExplanation | null> =>
      invoke('agent:explainStep', runId, decisionId),

    // v2.6.2 (T3.3): audit mode. Verify recomputes the hash chain of the active
    // project's audit file; `path` exposes it in Settings → Advanced.
    audit: {
      path: (): Promise<string | null> => invoke('audit:path'),
      verify: (): Promise<AuditVerifyResult | null> => invoke('audit:verify')
    },

    // v2.6.2 (T4.4): project goals. `projectId` defaults to the active project.
    goal: {
      list: (projectId?: string): Promise<Goal[]> => invoke('agent:goal:list', projectId),
      resolve: (projectId?: string): Promise<ResolvedGoal> =>
        invoke('agent:goal:resolve', projectId),
      create: (input: NewGoalInput, projectId?: string): Promise<Goal> =>
        invoke('agent:goal:create', input, projectId),
      update: (goalId: string, patch: GoalUpdate, projectId?: string): Promise<Goal | undefined> =>
        invoke('agent:goal:update', goalId, patch, projectId),
      setCriterion: (
        goalId: string,
        criterionId: string,
        met: boolean,
        projectId?: string
      ): Promise<Goal | undefined> =>
        invoke('agent:goal:setCriterion', goalId, criterionId, met, projectId),
      setActive: (goalId: string | null, projectId?: string): Promise<boolean> =>
        invoke('agent:goal:setActive', goalId, projectId),
      achieve: (goalId: string, projectId?: string): Promise<Goal | undefined> =>
        invoke('agent:goal:achieve', goalId, projectId),
      abandon: (goalId: string, note?: string, projectId?: string): Promise<Goal | undefined> =>
        invoke('agent:goal:abandon', goalId, note, projectId),
      remove: (goalId: string, projectId?: string): Promise<boolean> =>
        invoke('agent:goal:delete', goalId, projectId)
    }
  },

  // v2.6.2 (Topic 1): Session Profile + main-side elevation grant (P0-5).
  session: {
    get: (): Promise<ResolvedProfile> => invoke('session:get'),
    setProfile: (profile: SessionProfile): Promise<SettingsView> =>
      invoke('session:setProfile', profile),
    setInvestigateScope: (scope: InvestigateScope): Promise<SettingsView> =>
      invoke('session:setInvestigateScope', scope),
    grantElevation: (): Promise<SettingsView> => invoke('session:grantElevation'),
    revokeElevation: (): Promise<SettingsView> => invoke('session:revokeElevation')
  },

  shell: {
    exec: (command: string): Promise<LocalShellResult> => invoke('shell:exec', command)
  },

  jobs: {
    list: (): Promise<Job[]> => invoke('jobs:list'),
    refresh: (): Promise<Job[]> => invoke('jobs:refresh'),
    status: (id: string): Promise<Job | undefined> => invoke('jobs:status', id),
    kill: (id: string): Promise<boolean> => invoke('jobs:kill', id)
  },

  search: {
    code: (query: string): Promise<CodeMatch[]> => invoke('search:code', query)
  },

  worker: {
    submit: (request: WorkerJobRequest): Promise<WorkerJobView> => invoke('worker:submit', request),
    cancel: (id: string): Promise<boolean> => invoke('worker:cancel', id),
    status: (): Promise<WorkerStatus> => invoke('worker:status'),
    setOnline: (online: boolean): Promise<WorkerStatus> => invoke('worker:setOnline', online)
  },

  remote: {
    start: (): Promise<RemoteStatus> => invoke('remote:start'),
    stop: (): Promise<RemoteStatus> => invoke('remote:stop'),
    status: (): Promise<RemoteStatus> => invoke('remote:status')
  },

  // v2.5.3: read-only Diagnostic Mode (widens P0-2 for a short window).
  diagnostic: {
    status: (): Promise<DiagnosticStatus> => invoke('diagnostic:status'),
    enable: (): Promise<DiagnosticStatus> => invoke('diagnostic:enable'),
    disable: (): Promise<DiagnosticStatus> => invoke('diagnostic:disable')
  },

  webUtils: {
    /** Absolute path of a dropped/selected File (Electron webUtils). */
    pathForFile: (file: File): string => webUtils.getPathForFile(file)
  },

  events: {
    /** Subscribe to a main-process event; returns an unsubscribe function. */
    on<K extends keyof AppEventMap>(
      channel: K,
      listener: (payload: AppEventMap[K]) => void
    ): () => void {
      const handler = (_event: unknown, payload: AppEventMap[K]): void => listener(payload)
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    }
  }
}

export type Api = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  ;(globalThis as unknown as { api: typeof api }).api = api
}
