import type { ProviderId } from '@shared/types'
import type {
  CustomProviderInput,
  CustomProviderTestResult,
  CustomProviderView
} from '@shared/types'
import type { OnboardingStatus } from '@shared/onboarding'
import type { ApprovalMode, ApprovalHistoryEntry, ApprovalOutcome, ApprovedCommandView } from '@shared/approval'
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
  GitSetupOptions,
  RemoteCommandRun,
  RemoteGitStatus,
  RemoteWorkspaceInfo
} from '@shared/workspace-info'
import type { SystemHealth } from '@shared/system-health'
import type { Job } from '@shared/jobs'
import type { AuditVerifyResult, TraceExplanation } from '@shared/trace'
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
  CodeMatch,
  FileEntry,
  LocalShellResult,
  RemoteStatus,
  DiagnosticStatus,
  SessionInfo,
  ProjectRecord,
  SessionRecordView,
  SessionMemoryView,
  SettingsView,
  WorkerJobRequest,
  WorkerJobView,
  WorkerStatus
} from '@shared/ui'
import type { ProjectMetadataPatch } from '@shared/project-metadata'
import type { Goal, GoalUpdate, NewGoalInput } from '@shared/goal'
import type { ResolvedGoal } from '@core/agent/goal-store'


/** Shape of the object exposed on `window.api` by the preload script. */
export interface Api {
  app: {
    ping(): Promise<string>
  }
  window: {
    minimize(): Promise<void>
    toggleMaximize(): Promise<boolean>
    close(): Promise<void>
    isMaximized(): Promise<boolean>
    newWindow(): Promise<boolean>
    /** v2.6.2 T5.3: set the Electron zoom level (0 = 100%). */
    setZoom(level: number): Promise<number>
  }
  settings: {
    get(): Promise<SettingsView>
    setApiKey(provider: ProviderId, apiKey: string): Promise<SettingsView>
    removeApiKey(provider: ProviderId): Promise<SettingsView>
    setModel(provider: ProviderId, model: string): Promise<SettingsView>
    setActiveProvider(provider: ProviderId): Promise<SettingsView>
    setApprovalMode(mode: ApprovalMode): Promise<SettingsView>
    setPlanModeDefault(enabled: boolean): Promise<SettingsView>
    setRememberApprovalMode(enabled: boolean): Promise<SettingsView>
    addProject(name: string, path: string): Promise<SettingsView>
    addRemoteProject(name: string, path: string, vpsId: string): Promise<SettingsView>
    removeProject(id: string): Promise<SettingsView>
    updateProjectPath(id: string, path: string): Promise<SettingsView>
  }
  dialog: {
    pickDirectory(): Promise<string | null>
    pickFile(): Promise<string[]>
  }
  projects: {
    open(id: string): Promise<SettingsView>
    getMetadata(id: string): Promise<ProjectRecord | null>
    updateMetadata(id: string, patch: ProjectMetadataPatch): Promise<SettingsView>
  }
  chats: {
    list(): Promise<ChatSummary[]>
    load(id: string): Promise<StoredChat | null>
    save(input: ChatSaveInput): Promise<StoredChat>
    rename(id: string, title: string): Promise<ChatSummary | null>
    linkProject(id: string, workspaceId: string): Promise<ChatSummary | null>
    remove(id: string): Promise<boolean>
  }
  customProviders: {
    list(): Promise<CustomProviderView[]>
    save(input: CustomProviderInput): Promise<CustomProviderView>
    remove(id: string): Promise<boolean>
    test(input: CustomProviderInput): Promise<CustomProviderTestResult>
  }
  onboarding: {
    get(): Promise<OnboardingStatus>
    complete(): Promise<OnboardingStatus>
  }
  github: {
    status(): Promise<GitHubAuthStatus>
    setClientId(clientId: string): Promise<GitHubAuthStatus>
    setToken(token: string): Promise<GitHubAuthStatus>
    startAuth(): Promise<GitHubDeviceCode>
    pollAuth(deviceCode: string): Promise<GitHubAuthPollResult>
    logout(): Promise<GitHubAuthStatus>
    repos(): Promise<GitHubRepo[]>
    pulls(owner: string, repo: string, state?: string): Promise<GitHubPull[]>
    issues(owner: string, repo: string, state?: string): Promise<GitHubIssue[]>
    gitStatus(cwd: string): Promise<GitRepoStatus>
    gitClone(url: string, target: string): Promise<GitOpResult>
    gitPull(cwd: string): Promise<GitOpResult>
    gitPush(cwd: string): Promise<GitOpResult>
    gitCommit(cwd: string, input: GitCommitInput): Promise<GitOpResult>
    gitCheckout(cwd: string, branch: string, create?: boolean): Promise<GitOpResult>
  }
  vps: {
    list(): Promise<VpsServerView[]>
    save(input: VpsServerInput): Promise<VpsServerView>
    remove(id: string): Promise<boolean>
    status(): Promise<VpsConnectionState>
    connected(): Promise<string[]>
    connect(id: string): Promise<VpsConnectionState>
    disconnect(id: string): Promise<VpsConnectionState>
    /** Refresh a server's idle stamp so the watchdog keeps an open project's host up. */
    keepAlive(id: string): Promise<VpsConnectionState>
    approveFingerprint(id: string): Promise<VpsConnectionState>
    exec(id: string, command: string): Promise<VpsExecResult>
    audit(): Promise<AuditEntryView[]>
    importSshConfig(): Promise<SshConfigHost[]>
    healthCheck(id: string, config: HealthCheckConfig): Promise<HealthCheckOutcome>
    searchProject(id: string, name: string): Promise<string[]>
    listDirs(id: string, path: string): Promise<string[]>
    gitStatus(id: string, path: string): Promise<string>
    workspaceInfo(id: string, path: string): Promise<RemoteWorkspaceInfo>
    gitStatusParsed(id: string, path: string): Promise<RemoteGitStatus>
    systemHealth(id: string): Promise<SystemHealth>
    gitSetup(id: string, path: string, options: GitSetupOptions): Promise<RemoteCommandRun>
    installTool(
      id: string,
      tool: string,
      approved: boolean,
      elevated: boolean
    ): Promise<RemoteCommandRun>
    terminalOpen(id: string, cols?: number, rows?: number): Promise<string>
    terminalWrite(id: string, data: string): Promise<void>
    terminalResize(id: string, cols: number, rows: number): Promise<void>
    terminalClose(id: string, sessionId?: string): Promise<void>
    files: {
      list(id: string, path: string): Promise<RemoteFileEntry[]>
      read(id: string, path: string): Promise<string>
      write(id: string, path: string, content: string): Promise<void>
      restoreBackup(id: string, backupPath: string): Promise<void>
    }
  }
  fs: {
    list(path?: string): Promise<FileEntry[]>
    read(path: string): Promise<string>
    write(path: string, content: string): Promise<void>
    create(path: string, type: 'file' | 'dir'): Promise<void>
    remove(path: string): Promise<void>
    reveal(path: string): Promise<void>
  }
  agent: {
    run(request: AgentRunRequest): Promise<unknown>
    abort(): Promise<void>
    respondApproval(id: string, answer: boolean | ApprovalOutcome): Promise<boolean>
    respondPlan(id: string, decision: PlanDecision): Promise<boolean>
    respondPreflight(id: string, choice: PreflightChoice): Promise<boolean>
    stopPlan(runId?: string): Promise<boolean>
    approvalHistory(): Promise<ApprovalHistoryEntry[]>
    approvedCommands(): Promise<ApprovedCommandView[]>
    revokeApprovedCommand(id: string): Promise<boolean>
    rememberApprovalTool(tool: string): Promise<boolean>
    applyChange(id: string): Promise<boolean>
    rejectChange(id: string): Promise<boolean>
    sessions(): Promise<SessionInfo[]>
    loadSession(id: string): Promise<SessionRecordView | null>
    memory(id: string): Promise<SessionMemoryView>
    clearMemory(id: string): Promise<boolean>
    /** v2.6.2 (T3.2): explain a trace decision deterministically ("Ask Why"). */
    explainStep(runId: string, decisionId: string): Promise<TraceExplanation | null>
    /** v2.6.2 (T3.3): audit mode for the active project. */
    audit: {
      path(): Promise<string | null>
      verify(): Promise<AuditVerifyResult | null>
    }
    /** v2.6.2 (T4.4): project goals; `projectId` defaults to the active project. */
    goal: {
      list(projectId?: string): Promise<Goal[]>
      resolve(projectId?: string): Promise<ResolvedGoal>
      create(input: NewGoalInput, projectId?: string): Promise<Goal>
      update(goalId: string, patch: GoalUpdate, projectId?: string): Promise<Goal | undefined>
      setCriterion(
        goalId: string,
        criterionId: string,
        met: boolean,
        projectId?: string
      ): Promise<Goal | undefined>
      setActive(goalId: string | null, projectId?: string): Promise<boolean>
      achieve(goalId: string, projectId?: string): Promise<Goal | undefined>
      abandon(goalId: string, note?: string, projectId?: string): Promise<Goal | undefined>
      remove(goalId: string, projectId?: string): Promise<boolean>
    }
  }
  shell: {
    exec(command: string): Promise<LocalShellResult>
  }

  jobs: {
    list(): Promise<Job[]>
    refresh(): Promise<Job[]>
    status(id: string): Promise<Job | undefined>
    kill(id: string): Promise<boolean>
  }
  search: {
    code(query: string): Promise<CodeMatch[]>
  }
  worker: {
    submit(request: WorkerJobRequest): Promise<WorkerJobView>
    cancel(id: string): Promise<boolean>
    status(): Promise<WorkerStatus>
    setOnline(online: boolean): Promise<WorkerStatus>
  }
  remote: {
    start(): Promise<RemoteStatus>
    stop(): Promise<RemoteStatus>
    status(): Promise<RemoteStatus>
  }
  /** v2.5.3: read-only Diagnostic Mode (widens P0-2 for a short window). */
  diagnostic: {
    status(): Promise<DiagnosticStatus>
    enable(): Promise<DiagnosticStatus>
    disable(): Promise<DiagnosticStatus>
  }
  webUtils: {
    pathForFile(file: File): string
  }
  events: {
    on<K extends keyof AppEventMap>(
      channel: K,
      listener: (payload: AppEventMap[K]) => void
    ): () => void
  }
}

declare global {
  interface Window {
    api: Api
  }
}
