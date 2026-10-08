import type { ProviderId } from '@shared/types'
import type {
  CustomProviderInput,
  CustomProviderTestResult,
  CustomProviderView
} from '@shared/types'
import type { OnboardingStatus } from '@shared/onboarding'
import type {
  AgentRunRequest,
  AppEventMap,
  FileEntry,
  RemoteStatus,
  SessionInfo,
  SessionRecordView,
  SettingsView,
  WorkerJobRequest,
  WorkerJobView,
  WorkerStatus
} from '@shared/ui'

/** Shape of the object exposed on `window.api` by the preload script. */
export interface Api {
  app: {
    ping(): Promise<string>
  }
  settings: {
    get(): Promise<SettingsView>
    setApiKey(provider: ProviderId, apiKey: string): Promise<SettingsView>
    removeApiKey(provider: ProviderId): Promise<SettingsView>
    setModel(provider: ProviderId, model: string): Promise<SettingsView>
    setActiveProvider(provider: ProviderId): Promise<SettingsView>
    addProject(name: string, path: string): Promise<SettingsView>
    removeProject(id: string): Promise<SettingsView>
  }
  dialog: {
    pickDirectory(): Promise<string | null>
  }
  projects: {
    open(id: string): Promise<SettingsView>
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
    sessions(): Promise<SessionInfo[]>
    loadSession(id: string): Promise<SessionRecordView | null>
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
