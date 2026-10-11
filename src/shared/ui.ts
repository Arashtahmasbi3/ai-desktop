import type {
  AgentLogEntry,
  AgentStatus,
  LoopStopInfo,
  LoopWarning,
  ToolErrorCode,
  ToolRecoveryInfo
} from './agent'
import type { ChatMessage, ProviderId, Usage } from './types'
import type { VpsConnectionState } from './vps'
import type { ApprovalMode, ApprovalReason } from './approval'
import type { Plan, ApprovedPlan, PlanDecision, PlanWarning } from './plan'
import type { ProjectMetadata } from './project-metadata'

/** A project (folder) the user has added to the app. */
export interface ProjectRecord extends ProjectMetadata {
  id: string
  name: string
  path: string
  createdAt: number
  /** 'local' (default) or 'remote' (a folder on a connected VPS). */
  type?: 'local' | 'remote'
  /** VPS the remote project lives on. */
  vpsId?: string
  /**
   * Computed at read time (never persisted): whether `path` exists on this
   * machine/OS (for remote projects: whether the VPS is connected). Missing
   * projects are shown with a warning instead of being deleted, so a project
   * path from another OS survives a round-trip.
   */
  exists?: boolean
  /**
   * Computed at read time: whether a local project path clearly belongs to a
   * different OS than the one the app is running on (for example a Linux path
   * while running on Windows).
   */
  osMismatch?: boolean
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
  /** Host platform (`process.platform`) so the UI can warn on foreign paths. */
  platform?: string
  /** When the agent must ask before acting. */
  approvalMode?: ApprovalMode
  rememberApprovalMode?: boolean
  /** Whether new chats start in Plan Mode. */
  planModeDefault?: boolean
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
  /**
   * v2.4.1: tool toggle groups enabled in Settings. Omit for "all enabled".
   * When present, only the listed groups/tools are exposed to the model.
   */
  enabledTools?: string[]
  /** Plan Mode: no tools are exposed; the model only drafts a plan. */
  planMode?: boolean
}

/** A tool call awaiting the user's approval (Approval Modes). */
export interface ApprovalRequest {
  id: string
  runId: string
  tool: string
  /** One-line, human-readable description of what the tool will do. */
  summary: string
  arguments: Record<string, unknown>
  /** Coarse action class, used to style the preview. */
  kind?: 'read' | 'write' | 'shell'
  /** The command or file path shown large in the dialog. */
  preview?: string
  /** Working directory the action will run in, when known. */
  workingDirectory?: string
  /** Remote server label when the action targets a VPS. */
  server?: string
  /** True when the action matches the deny list (never auto-approved). */
  dangerous?: boolean
  /** Why this action needed approval (v2.5.5). */
  reason?: ApprovalReason
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
/** A file the agent wrote, captured for review in the chat. */
export interface CodeMatch {
  path: string
  line: number
  text: string
}
export interface LocalShellResult {
  stdout: string
  stderr: string
  exitCode: number
}
export interface FileChangeView {
  id: string
  runId: string
  sessionId?: string
  /** Project-relative path. */
  path: string
  before: string
  after: string
}

export type FileChangeStatus = 'accepted' | 'rejected'

/** A plan awaiting the user's approval (v2.3.2, A.5). */
export interface PlanRequest {
  id: string
  runId: string
  plan: Plan
  warnings: PlanWarning[]
}

/**
 * Structured detail of one executed tool call (v2.5.2). Built from
 * {@link AgentToolResult}, redacted and length-capped before it leaves the main
 * process, then streamed to the renderer as a `tool:result` event.
 */
export interface ToolResultView {
  actionId: string
  name: string
  ok: boolean
  code?: ToolErrorCode
  /** Short technical cause when the call failed. */
  error?: string
  durationMs: number
  attempts: number
  command?: string
  serverId?: string
  cwd?: string
  path?: string
  stdout?: string
  stderr?: string
  exitCode?: number
  recovery?: ToolRecoveryInfo
}

/**
 * Tool-call summary rendered inline in the chat (v2.5.2). A superset of the old
 * `{name, ok, detail}` shape so stored/older messages keep rendering.
 */
export interface ToolCallView {
  name: string
  ok: boolean
  code?: ToolErrorCode
  /** Short legacy detail line (still supported). */
  detail?: string
  /** Short technical cause when the call failed. */
  error?: string
  command?: string
  serverId?: string
  cwd?: string
  path?: string
  stdout?: string
  stderr?: string
  exitCode?: number
  durationMs?: number
  attempts?: number
  recovery?: ToolRecoveryInfo
}

export type AgentEvent =
  | { type: 'run:start'; runId: string; task: string; at: number }
  | { type: 'tool:result'; runId: string; result: ToolResultView; at: number }
  | {
      type: 'run:end'
      runId: string
      status: AgentStatus
      finalAnswer: string | null
      message: string | null
      warnings: LoopWarning[]
      /** Set when the run stopped early because it looked stuck. */
      stop?: LoopStopInfo
      /** Provider/model that actually served the primary call (after fallback). */
      provider?: ProviderId
      model?: string
      /** Aggregate token usage for the whole run (v2.5.4). */
      usage?: Usage
      at: number
    }
  | { type: 'log'; entry: AgentLogEntry }
  | { type: 'approval:request'; request: ApprovalRequest }
  | { type: 'approval:suggestion'; tool: string; count: number }
  | { type: 'plan:request'; request: PlanRequest }
  | { type: 'plan:resolved'; id: string; decision: PlanDecision; at: number }
  | { type: 'plan:active'; plan: ApprovedPlan; at: number }
  | { type: 'plan:inactive'; at: number }
  | { type: 'file:change'; change: FileChangeView; at: number }
  | { type: 'file:change:resolved'; id: string; status: FileChangeStatus; at: number }
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

/** Diagnostic Mode state surfaced to the renderer (v2.5.3). */
export interface DiagnosticStatus {
  active: boolean
  /** Epoch ms the window closes, or null when inactive. */
  expiresAt: number | null
  /** Milliseconds left in the window (0 when inactive). */
  remainingMs: number
  /** System paths temporarily readable while active. */
  allowedPaths: string[]
}

export interface AppEventMap {
  'agent:event': AgentEvent
  'worker:status': WorkerStatus
  'remote:status': RemoteStatus
  'diagnostic:status': DiagnosticStatus
  'settings:changed': SettingsView
  'files:changed': { root: string }
  'window:maximized': boolean
  'vps:status': VpsConnectionState
  'vps:data': { sessionId: string; chunk: string }
}
