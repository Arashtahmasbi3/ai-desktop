import type { AgentLogEntry, AgentStatus, LoopWarning } from './agent'
import type { ChatMessage, ProviderId } from './types'
import type { VpsConnectionState } from './vps'

/** A project (folder) the user has added to the app. */
export interface ProjectRecord {
  id: string
  name: string
  path: string
  createdAt: number
  /**
   * Computed at read time (never persisted): whether `path` exists on this
   * machine/OS. Missing projects are shown with a warning instead of being
   * deleted, so a project path from another OS survives a round-trip.
   */
  exists?: boolean
}

/** Provider settings safe to display in the renderer (no key material). */
export interface ProviderSettingsView {
  hasApiKey: boolean
  model?: string
  baseUrl?: string
}

/** Settings as exposed to the renderer via IPC. */
export interface SettingsView {
  activeProvider?: ProviderId
  activeProjectId?: string
  providers: Partial<Record<ProviderId, ProviderSettingsView>>
  projects: ProjectRecord[]
}

/** A single entry in the workspace file explorer. */
export interface FileEntry {
  name: string
  /** POSIX-ish path relative to the active project root. */
  path: string
  type: 'file' | 'dir'
  size?: number
}

export interface AgentRunRequest {
  task: string
  provider?: ProviderId
  /** Model override for the primary provider (chosen in the chat header). */
  model?: string
  /** Id of a custom (OpenAI-compatible) provider to use instead of a built-in one. */
  customProviderId?: string
  /** Base session id to save under (reused across runs). */
  sessionId?: string
  /** Load this stored session before running. */
  resumeSessionId?: string
  /** Connected VPS to run `remote_shell` on (chosen in the chat header). */
  vpsServerId?: string
}

/** The model the user has selected for the next/next messages. */
export interface ModelSelection {
  provider: ProviderId
  model: string
  /** Set when the selection points at a custom provider rather than a built-in one. */
  customProviderId?: string
}

export interface SessionInfo {
  id: string
  task: string
  status: AgentStatus
  updatedAt: number
}

/** A stored session with its full transcript, for restoring the chat UI. */
export interface SessionRecordView {
  id: string
  task: string
  status: AgentStatus
  summary: string | null
  messages: ChatMessage[]
}

/** Events streamed main -> renderer while an agent run is in progress. */
export type AgentEvent =
  | { type: 'run:start'; runId: string; task: string; at: number }
  | {
      type: 'run:end'
      runId: string
      status: AgentStatus
      finalAnswer: string | null
      message: string | null
      warnings: LoopWarning[]
      /** Provider/model that actually served the primary call (after fallback). */
      provider?: ProviderId
      model?: string
      at: number
    }
  | { type: 'log'; entry: AgentLogEntry }
  | { type: 'error'; runId: string; message: string }

export type WorkerState = 'stopped' | 'idle' | 'running'

export type WorkerJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface WorkerJobView {
  id: string
  label: string
  priority: number
  status: WorkerJobStatus
  createdAt: number
  startedAt?: number
  finishedAt?: number
  error?: string
}

export interface WorkerStatus {
  state: WorkerState
  active: number
  queued: number
  completed: number
  failed: number
  /** Effective concurrency (derived from CPU/RAM limits). */
  maxConcurrent: number
  memoryMb: number
  cpuCores: number
  online: boolean
  remoteEnabled: boolean
  jobs: WorkerJobView[]
}

/** A heavy job submitted to the background worker. */
export interface WorkerJobRequest {
  label: string
  /** Shell command run inside a sandbox. */
  command?: string
  /** Agent task run by the orchestrator (alternative to `command`). */
  task?: string
  /** Higher runs first. Default 0. */
  priority?: number
}

export interface RemoteStatus {
  enabled: boolean
  host: string
  port: number
  clients: number
  token?: string
}

export interface AppEventMap {
  'agent:event': AgentEvent
  'worker:status': WorkerStatus
  'remote:status': RemoteStatus
  'settings:changed': SettingsView
  'files:changed': { root: string }
  'window:maximized': boolean
  'vps:status': VpsConnectionState
  'vps:data': { sessionId: string; chunk: string }
}
