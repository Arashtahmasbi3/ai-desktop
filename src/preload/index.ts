import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { CustomProviderInput, CustomProviderTestResult, CustomProviderView, ProviderId } from '@shared/types'
import type { OnboardingStatus } from '@shared/onboarding'
import type { ApprovalMode, ApprovalHistoryEntry, ApprovalOutcome, ApprovedCommandView } from '@shared/approval'
import type { PlanDecision } from '@shared/plan'
import type { ChatSaveInput, ChatSummary, StoredChat } from '@shared/chat'
import type {
  AuditEntryView,
  HealthCheckConfig,
  HealthCheckOutcome,
  RemoteFileEntry,
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
  RemoteStatus,
  SessionInfo,
  CodeMatch,
  LocalShellResult,
  SessionRecordView,
  SettingsView,
  WorkerJobRequest,
  WorkerJobView,
  WorkerStatus
} from '@shared/ui'

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>

export const api = {
  app: {
    ping: (): Promise<string> => invoke<string>('app:ping')
  },

  window: {
    minimize: (): Promise<void> => invoke('window:minimize'),
    toggleMaximize: (): Promise<boolean> => invoke('window:toggleMaximize'),
    close: (): Promise<void> => invoke('window:close'),
    isMaximized: (): Promise<boolean> => invoke('window:isMaximized'),
    newWindow: (): Promise<boolean> => invoke('window:new')
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

  projects: {
    open: (id: string): Promise<SettingsView> => invoke('projects:open', id)
  },

  chats: {
    list: (): Promise<ChatSummary[]> => invoke('chats:list'),
    load: (id: string): Promise<StoredChat | null> => invoke('chats:load', id),
    save: (input: ChatSaveInput): Promise<StoredChat> => invoke('chats:save', input),
    rename: (id: string, title: string): Promise<ChatSummary | null> =>
      invoke('chats:rename', id, title),
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
    connect: (id: string): Promise<VpsConnectionState> => invoke('vps:connect', id),
    disconnect: (id: string): Promise<VpsConnectionState> => invoke('vps:disconnect', id),
    approveFingerprint: (id: string): Promise<VpsConnectionState> =>
      invoke('vps:approveFingerprint', id),
    exec: (id: string, command: string): Promise<VpsExecResult> => invoke('vps:exec', id, command),
    audit: (): Promise<AuditEntryView[]> => invoke('vps:audit'),
    healthCheck: (id: string, config: HealthCheckConfig): Promise<HealthCheckOutcome> =>
      invoke('vps:healthCheck', id, config),
    searchProject: (id: string, name: string): Promise<string[]> =>
      invoke('vps:searchProject', id, name),
    listDirs: (id: string, path: string): Promise<string[]> => invoke('vps:listDirs', id, path),
    gitStatus: (id: string, path: string): Promise<string> => invoke('vps:gitStatus', id, path),
    terminalOpen: (id: string, cols?: number, rows?: number): Promise<string> =>
      invoke('vps:terminalOpen', id, cols, rows),
    terminalWrite: (id: string, data: string): Promise<void> => invoke('vps:terminalWrite', id, data),
    terminalResize: (id: string, cols: number, rows: number): Promise<void> =>
      invoke('vps:terminalResize', id, cols, rows),
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
    approvalHistory: (): Promise<ApprovalHistoryEntry[]> => invoke('agent:approvalHistory'),
    approvedCommands: (): Promise<ApprovedCommandView[]> => invoke('agent:approvedCommands'),
    revokeApprovedCommand: (id: string): Promise<boolean> =>
      invoke('agent:revokeApprovedCommand', id),
    rememberApprovalTool: (tool: string): Promise<boolean> =>
      invoke('agent:rememberApprovalTool', tool),
    applyChange: (id: string): Promise<boolean> => invoke('agent:applyChange', id),
    rejectChange: (id: string): Promise<boolean> => invoke('agent:rejectChange', id),
    sessions: (): Promise<SessionInfo[]> => invoke('agent:sessions'),
    loadSession: (id: string): Promise<SessionRecordView | null> => invoke('agent:loadSession', id)
  },

  shell: {
    exec: (command: string): Promise<LocalShellResult> => invoke('shell:exec', command)
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
