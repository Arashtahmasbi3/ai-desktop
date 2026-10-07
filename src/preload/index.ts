import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { ProviderId } from '@shared/types'
import type {
  AgentRunRequest,
  AppEventMap,
  RemoteStatus,
  SessionInfo,
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
    addProject: (name: string, path: string): Promise<SettingsView> =>
      invoke('settings:addProject', name, path),
    removeProject: (id: string): Promise<SettingsView> => invoke('settings:removeProject', id)
  },

  dialog: {
    pickDirectory: (): Promise<string | null> => invoke('dialog:pickDirectory')
  },

  projects: {
    open: (id: string): Promise<SettingsView> => invoke('projects:open', id)
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
    sessions: (): Promise<SessionInfo[]> => invoke('agent:sessions'),
    loadSession: (id: string): Promise<SessionRecordView | null> => invoke('agent:loadSession', id)
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
