import { create } from 'zustand'
import type { TraceDecision } from '@shared/trace'
import type { AgentLogEntry } from '@shared/agent'
import type { LoopStopInfo, LoopWarning } from '@shared/agent'
import type {
  CustomProviderInput,
  CustomProviderTestResult,
  CustomProviderView,
  ProviderId
} from '@shared/types'
import { DEFAULT_SELECTION, resolveSelection } from '@shared/selection'
import type { ApprovalMode, ApprovalOutcome } from '@shared/approval'
import type { ApprovedPlan, PlanDecision } from '@shared/plan'
import type { PreflightChoice, PreflightRequestView } from '@shared/preflight'
import type { TaskPlan } from '@shared/task-plan'
import type { Goal } from '@shared/goal'
import type { ResolvedGoal } from '@core/agent/goal-store'
import type { ProjectMetadataPatch } from '@shared/project-metadata'
import type { OnboardingStatus } from '@shared/onboarding'
import type { VpsConnectionState, VpsServerView } from '@shared/vps'
import type { DiagnosticStatus, PreflightNotice } from '@shared/ui'
import type { ChatSummary, StoredMessage } from '@shared/chat'
import type { Job } from '@shared/jobs'
import type { Locale } from './i18n/locale'
import { detectLocale } from './i18n/locale'
import {
  applyTheme,
  readStoredTheme,
  storeTheme,
  type ThemePreference
} from './lib/theme'
import { VPS_RECONNECT_KEY } from './lib/vps-state'
import {
  isConversationActive,
  planChatTransfer,
  readChatTransferPreference,
  writeChatTransferPreference
} from './lib/chat-transfer'
import type { ChatTransferChoice, ChatTransferPreference } from './lib/chat-transfer'
import { readEnabledTools } from './lib/tool-toggles'
import {
  appendUsage,
  loadUsage,
  saveUsage,
  type UsageRecord
} from './lib/usage'
import { redact } from '@core/agent/redact'
import i18n from './i18n'
import type {
  AgentEvent,
  ApprovalRequest,
  CodeMatch,
  FileChangeView,
  FileEntry,
  ModelSelection,
  RemoteStatus,
  SessionInfo,
  SessionMemoryView,
  SettingsView,
  PlanRequest,
  ToolCallView,
  ToolResultView,
  WorkerJobRequest,
  WorkerStatus
} from '@shared/ui'

export type ViewId = 'chat' | 'tasks' | 'files' | 'browser' | 'github' | 'vps' | 'goals'

/** Tabs of the right-hand workspace column (v2.6.0, B.4). */
export type WorkspacePanelTab = 'output' | 'sources'

export type ToastKind = 'success' | 'error' | 'warning'

export interface Toast {
  id: string
  kind: ToastKind
  message: string
}

export type TerminalLineKind = 'command' | 'stdout' | 'stderr' | 'info'

export interface TerminalLine {
  id: string
  kind: TerminalLineKind
  text: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  at: number
  /** Provider/model that produced an assistant message (display only). */
  model?: string
  /** True when this assistant turn used the remote_shell tool. */
  usedRemote?: boolean
  /**
   * v2.4.1/v2.5.2: which tool ran and whether it succeeded (role === 'tool'),
   * with the structured detail (command, target, streams, exit code) when known.
   */
  toolCall?: ToolCallView
  /** v2.6.3: the run this message belongs to, for per-step trace grouping. */
  runId?: string
}

/** Project a `tool:result` event into the compact shape stored on a message. */
function toolCallFromView(view: ToolResultView): ToolCallView {
  return {
    name: view.name,
    ok: view.ok,
    ...(view.code ? { code: view.code } : {}),
    ...(view.error !== undefined ? { error: view.error, detail: view.error } : {}),
    ...(view.command !== undefined ? { command: view.command } : {}),
    ...(view.serverId !== undefined ? { serverId: view.serverId } : {}),
    ...(view.cwd !== undefined ? { cwd: view.cwd } : {}),
    ...(view.path !== undefined ? { path: view.path } : {}),
    ...(view.stdout !== undefined ? { stdout: view.stdout } : {}),
    ...(view.stderr !== undefined ? { stderr: view.stderr } : {}),
    ...(view.exitCode !== undefined ? { exitCode: view.exitCode } : {}),
    ...(view.durationMs !== undefined ? { durationMs: view.durationMs } : {}),
    ...(view.attempts !== undefined ? { attempts: view.attempts } : {}),
    ...(view.step !== undefined ? { step: view.step } : {}),
    ...(view.recovery ? { recovery: view.recovery } : {})
  }
}

const MAX_LOGS = 500
/** v2.6.2 T3.2: keep the timeline bounded too. */
const MAX_DECISIONS = 200
const MAX_TERMINAL_LINES = 500
/**
 * U-10: `messages` used to grow without bound — every `tool:result` appends one
 * and `ChatPanel` renders all of them eagerly — so a long run leaked memory and
 * painted thousands of rows. Cap the in-memory history at the newest
 * MAX_MESSAGES (the on-disk chat/session still holds the full transcript, and
 * the agent's own ContextManager compacts the prompt independently). The
 * tradeoff is that a very old tail disappears from the UI until the chat is
 * reloaded from disk.
 */
const MAX_MESSAGES = 500
/** U-10: `taskPlans` only ever grew; bound it the same way. */
const MAX_TASK_PLANS = 50

/**
 * U-10: trim `messages` to the newest MAX_MESSAGES, but never drop a message
 * that belongs to the run currently producing them.
 */
function capMessages(messages: ChatMessage[], runId: string | null): ChatMessage[] {
  if (messages.length <= MAX_MESSAGES) return messages
  const cutoff = messages.length - MAX_MESSAGES
  if (runId) {
    const firstInFlight = messages.findIndex((message) => message.runId === runId)
    if (firstInFlight >= 0 && firstInFlight < cutoff) return messages.slice(firstInFlight)
  }
  return messages.slice(cutoff)
}

/** U-10: insert a plan into the map, dropping the oldest entries past the cap. */
function withTaskPlan(
  plans: Record<string, TaskPlan>,
  plan: TaskPlan
): Record<string, TaskPlan> {
  const next = { ...plans, [plan.id]: plan }
  const ids = Object.keys(next)
  if (ids.length <= MAX_TASK_PLANS) return next
  for (const id of ids.slice(0, ids.length - MAX_TASK_PLANS)) delete next[id]
  return next
}
export const CONTEXT_SETTINGS_KEY = 'ai-desktop:show-context-before-send'
const CHAT_TREE_KEY = 'ai-desktop:chat-tree-open'
const RAW_TOOL_ROWS_KEY = 'ai-desktop:show-raw-tool-rows'
const CONTEXT_WARNING_KEY = 'ai-desktop:show-context-warning'
const SIDEBAR_PIN_KEY = 'ai-desktop:sidebar-pinned'
const JOBS_PANEL_KEY = 'ai-desktop:show-jobs-panel'
const ZOOM_KEY = 'ai-desktop:zoom-level'
/** Electron zoom-level step per keyboard press (v2.6.2 T5.3). */
const ZOOM_STEP = 0.5
const ZOOM_MIN = -3
const ZOOM_MAX = 3
const LAST_CHAT_KEY = 'ai-desktop:last-chat'
const AUTOSAVE_INTERVAL_MS = 30_000
/** Full access auto-reverts to Ask after this much idle time (v2.3, B.2). */
const FULL_ACCESS_TTL_MS = 30 * 60 * 1000
let fullAccessTimer: ReturnType<typeof setTimeout> | null = null

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Math.random().toString(36).slice(2)}`
}

/**
 * Read the persisted "preview context before send" preference.
 *
 * v2.8.0: **off by default.** It used to be on, which put a token/cost estimate
 * dialog in front of every single send — the user's report: "still, a token cost
 * warning pops up whenever I send text". It is a useful *opt-in* for a large or
 * expensive conversation, not a toll gate on every message.
 */
export function readShowContextBeforeSend(): boolean {
  try {
    return globalThis.localStorage?.getItem(CONTEXT_SETTINGS_KEY) === '1'
  } catch {
    return false
  }
}

function readChatTreeOpen(): boolean {
  try {
    return globalThis.localStorage?.getItem(CHAT_TREE_KEY) === '1'
  } catch {
    return false
  }
}

/** Read the persisted "keep the jobs panel open" preference (default off). */
export function readShowJobsPanelAlways(): boolean {
  try {
    return globalThis.localStorage?.getItem(JOBS_PANEL_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Read the persisted "show raw tool rows" preference (v2.6.3, default off).
 * Tool rows already grouped inside the inline trace are hidden unless this is on,
 * which keeps the chat readable but leaves a debugging escape hatch.
 */
export function readShowRawToolRows(): boolean {
  try {
    return globalThis.localStorage?.getItem(RAW_TOOL_ROWS_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Read the persisted "keep the sidebar expanded" preference (v2.6.3, default on).
 * Pinned keeps the sidebar expanded down to MIN_CHAT_WIDTH; unpinned lets it fall
 * to the rail whenever the chat cannot get its full comfortable measure.
 */
export function readSidebarPinned(): boolean {
  try {
    return globalThis.localStorage?.getItem(SIDEBAR_PIN_KEY) !== '0'
  } catch {
    return true
  }
}

/**
 * Read the persisted "show the context-filling warning" preference (v2.6.4,
 * Fix E — default off). The nudge is only useful for older, small-context
 * models, so modern long-context models stay quiet unless the user opts in.
 */
export function readShowContextWarning(): boolean {
  try {
    return globalThis.localStorage?.getItem(CONTEXT_WARNING_KEY) === '1'
  } catch {
    return false
  }
}

/** Last seen status per job id, so `refreshJobs` can toast a completion once. */
const jobStatuses = new Map<string, Job['status']>()

/** Clamp + read the persisted zoom level (Electron units; 0 == 100%). */
function clampZoom(level: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, level))
}

export function readZoomLevel(): number {
  try {
    const raw = globalThis.localStorage?.getItem(ZOOM_KEY)
    const level = raw ? Number(raw) : 0
    return Number.isFinite(level) ? clampZoom(level) : 0
  } catch {
    return 0
  }
}

function readLastChatId(): string | null {
  try {
    return globalThis.localStorage?.getItem(LAST_CHAT_KEY)
  } catch {
    return null
  }
}

function rememberChatId(id: string): void {
  try {
    globalThis.localStorage?.setItem(LAST_CHAT_KEY, id)
  } catch {
    // Best-effort: forgetting the last chat only skips restore.
  }
}

/** Switch the active language (kept here so the store is the single entry point). */
async function i18nChangeLanguage(locale: Locale): Promise<void> {
  await i18n.changeLanguage(locale)
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

interface AppState {
  ready: boolean
  settings: SettingsView | null
  settingsOpen: boolean
  view: ViewId

  messages: ChatMessage[]
  running: boolean
  currentRunId: string | null
  sessionId: string
  logs: AgentLogEntry[]
  /** v2.6.2 T3.2: trace decisions for the active run, oldest first. */
  decisions: TraceDecision[]
  warnings: LoopWarning[]
  /** v2.6.3 T3.1: the latest non-ok preflight result, shown as a tiered banner. */
  preflightNotice: PreflightNotice | null
  /** Set when the last run stopped early because the agent looked stuck. */
  loopStop: LoopStopInfo | null
  sessions: SessionInfo[]
  /** v2.6.1 Fix 5: what the active chat still remembers (Sources tab panel). */
  memory: SessionMemoryView | null

  entries: FileEntry[]
  cwd: string
  selectedFile: string | null
  fileContent: string
  draft: string | null
  saving: boolean

  worker: WorkerStatus | null
  remote: RemoteStatus | null
  error: string | null
  /** True when the active project folder cannot be found on this OS. */
  projectMissing: boolean

  /** Model chosen in the chat header for the next message. */
  selection: ModelSelection
  /** User-defined OpenAI-compatible providers (secrets never reach the renderer). */
  customProviders: CustomProviderView[]
  /** First-run wizard state; null until loaded. */
  onboarding: OnboardingStatus | null
  /** Startup project-migration modal visibility. */
  migrationOpen: boolean
  /**
   * Project id awaiting the chat-transfer decision when switching projects
   * (v2.6.4, Fix D). Null when no switch is pending.
   */
  pendingProjectSwitch: string | null
  /** Remembered chat-transfer choice applied to future project switches. */
  chatTransferPreference: ChatTransferPreference

  /** Interface language (drives dir + all t() text). */
  locale: Locale
  /** Collapsed state of the left sidebar. */
  sidebarCollapsed: boolean
  /** v2.6.3 T1.2: keep the sidebar expanded even on mid-size windows (persisted). */
  sidebarPinned: boolean
  /** Whether the context preview is shown before each send (v2.3.2, B.4). */
  showContextBeforeSend: boolean
  /** Every recorded LLM call's token usage, oldest first (v2.5.4). */
  usageRecords: UsageRecord[]
  /** App-start timestamp; "this session" = records at or after this (v2.5.4). */
  sessionStartedAt: number
  /** Saved chats for the sidebar list. */
  chats: ChatSummary[]
  /** Currently open chat id (created lazily on first message). */
  activeChatId: string | null
  /** Connected VPS selected for remote_shell in this chat. */
  vpsServerId: string | undefined
  /** Saved VPS servers, shared by every component (single source of truth). */
  vpsServers: VpsServerView[]
  /** Live VPS connection state from the main process. */
  vpsStatus: VpsConnectionState
  /** Light/dark/system preference (v2.7.0). */
  theme: ThemePreference
  /** Per-server connection state, so one host's change never repaints another's. */
  vpsStates: Record<string, VpsConnectionState>
  /** Every currently-connected server id (v2.6.4, multi-connection truth). */
  vpsConnected: string[]
  /** Diagnostic Mode state (v2.5.3); null until first fetched. */
  diagnostic: DiagnosticStatus | null
  /**
   * Wall-clock moment full access auto-disables, or null when it is off
   * (v2.6.1, B.3). Lets the execution bar show the same countdown as the timer.
   */
  fullAccessExpiresAt: number | null
  /** Plan Mode: the agent drafts a plan without running tools. */
  planMode: boolean
  /** Tool call awaiting the user's approval, if any. */
  pendingApproval: ApprovalRequest | null
  /** Plan awaiting the user's approval before it executes (v2.3.2, A.5). */
  pendingPlan: PlanRequest | null
  /** Preflight block awaiting an explicit, per-action answer (v2.6.3, T3.2). */
  pendingPreflight: PreflightRequestView | null
  /** A plan the user trusted for 30 minutes; its steps skip approval (v2.5.5). */
  activePlan: ApprovedPlan | null
  /**
   * The plan the agent is currently executing (v2.5.7). Named `taskPlan` (not
   * `activePlan`) because `activePlan` already holds the 30-minute approved plan.
   */
  taskPlan: TaskPlan | null
  /** Every plan seen this session, keyed by id (v2.5.7). */
  taskPlans: Record<string, TaskPlan>
  /** Whether the user paused the running task plan (v2.5.7). */
  taskPaused: boolean
  /** The active project's goals (v2.6.2 T4.4). */
  goals: Goal[]
  /** How the next run will pick a goal; `ambiguous` asks the user to choose. */
  goalResolution: ResolvedGoal | null
  /** A goal mutation is in flight; disables the panel's controls. */
  goalsBusy: boolean
  /** A tool approved 3+ times; the UI suggests remembering it (v2.3, B.3). */
  approvalSuggestion: { tool: string; count: number } | null
  /** A "Deny & Explain" prompt to send once the current run settles. */
  queuedExplain: string | null
  /** Agent file edits awaiting the user's apply/reject decision. */
  fileChanges: FileChangeView[]
  /** Transient toast notifications. */
  toasts: Toast[]
  /** Whether the file tree is shown next to the chat. */
  chatTreeOpen: boolean
  /** Whether the right workspace column (output/sources) is shown. */
  workspacePanelOpen: boolean
  /** Active tab of the right workspace column. */
  workspacePanelTab: WorkspacePanelTab
  /** Whether the local terminal panel is open under the chat. */
  terminalOpen: boolean
  /** Whether the codebase search modal is open. */
  searchOpen: boolean
  /** Results of the last codebase search. */
  searchResults: CodeMatch[]
  /** Output lines of the local terminal panel. */
  terminalLines: TerminalLine[]
  /** Command palette visibility. */
  paletteOpen: boolean
  /** Detached background jobs, polled globally so the sidebar badge stays fresh (T5.2). */
  jobs: Job[]
  /** Whether the full jobs panel is currently open (T5.2). */
  jobsPanelOpen: boolean
  /** Pin the jobs panel open even with nothing running (T5.2). */
  showJobsPanelAlways: boolean
  /** v2.6.3: show raw tool rows instead of hiding those grouped in the trace. */
  showRawToolRows: boolean
  /** v2.6.4 Fix E: show the composer's context-filling warning (default off). */
  showContextWarning: boolean
  /** Electron zoom level, 0 == 100% (T5.3). */
  zoomLevel: number
  /** Keyboard-shortcut cheat sheet visibility (T5.3). */
  shortcutsOpen: boolean

  setLocale: (locale: Locale) => void
  toggleSidebar: () => void
  /** v2.6.3 T1.2: pin/unpin the sidebar (persisted; pinning also expands). */
  setSidebarPinned: (value: boolean) => void
  /** v2.6.3 T3.1: hide the preflight banner until the next non-ok result. */
  dismissPreflight: () => void
  /** Toggle the pre-send context preview. */
  setShowContextBeforeSend: (value: boolean) => void
  /** Switch the light/dark/system theme preference (v2.7.0). */
  setTheme: (preference: ThemePreference) => void
  /** Record one LLM call's usage and persist it (v2.5.4). */
  recordUsage: (record: Omit<UsageRecord, 'timestamp'> & { timestamp?: number }) => void
  /** Clear every usage record and storage (v2.5.4). */
  resetUsage: () => void
  refreshChats: () => Promise<void>
  /** Save the current messages/model/vps as the active chat. */
  persistChat: () => Promise<void>
  renameChat: (id: string, title: string) => Promise<void>
  deleteChat: (id: string) => Promise<void>
  duplicateChat: (id: string) => Promise<void>
  /** Fork a chat from a message (inclusive); returns the new chat id. */
  forkChat: (id: string, messageId: string) => Promise<string | null>
  setVpsServerId: (id: string | undefined) => void
  /** Refresh Diagnostic Mode state from the main process. */
  refreshDiagnostic: () => Promise<void>
  /** Enable/disable Diagnostic Mode; updates the shared status. */
  setDiagnosticMode: (enabled: boolean) => Promise<void>
  /** Load the saved VPS list and current connection state into the store. */
  refreshVps: () => Promise<void>
  /** Connect to a VPS (updates the shared status on every UI surface). */
  connectVps: (serverId: string) => Promise<void>
  /** Disconnect a VPS and clear the shared status. */
  disconnectVps: (serverId: string) => Promise<void>
  /** Apply a status pushed from the main process. */
  setVpsStatus: (status: VpsConnectionState) => void
  /** Refresh the list of currently-connected server ids. */
  refreshVpsConnected: () => Promise<void>
  /** Connect a server in the background without changing the chat-header selection. */
  ensureVpsConnected: (serverId: string) => Promise<void>
  setPlanMode: (value: boolean) => void
  setApprovalMode: (mode: ApprovalMode) => Promise<void>
  setPlanModeDefault: (value: boolean) => Promise<void>
  respondApproval: (answer: boolean | ApprovalOutcome) => void
  respondPlan: (decision: PlanDecision) => void
  /** Answer a preflight block; the drawer closes and main resolves the run. */
  respondPreflight: (choice: PreflightChoice) => void
  stopPlan: () => void
  rememberApprovalTool: (tool: string) => Promise<void>
  dismissApprovalSuggestion: () => void
  setRememberApprovalMode: (enabled: boolean) => Promise<void>
  applyFileChange: (id: string) => Promise<void>
  rejectFileChange: (id: string) => Promise<void>
  pushToast: (kind: ToastKind, message: string) => void
  dismissToast: (id: string) => void
  setPaletteOpen: (open: boolean) => void
  /** Poll the main process for detached jobs (T5.2). */
  refreshJobs: () => Promise<void>
  setJobsPanelOpen: (open: boolean) => void
  setShowJobsPanelAlways: (value: boolean) => void
  /** v2.6.3: toggle raw tool rows (persisted). */
  setShowRawToolRows: (value: boolean) => void
  setShowContextWarning: (value: boolean) => void
  /** Apply (and persist) an Electron zoom level, clamped to a safe range (T5.3). */
  applyZoom: (level: number) => void
  zoomIn: () => void
  zoomOut: () => void
  resetZoom: () => void
  setShortcutsOpen: (open: boolean) => void
  toggleChatTree: () => void
  toggleWorkspacePanel: () => void
  setWorkspacePanelTab: (tab: WorkspacePanelTab) => void
  toggleTerminal: () => void
  runTerminalCommand: (command: string) => Promise<void>
  setSearchOpen: (open: boolean) => void
  runCodeSearch: (query: string) => Promise<void>

  init: () => Promise<void>
  openSettings: () => void
  closeSettings: () => void
  closeMigration: () => void
  setView: (view: ViewId) => void
  setSelection: (patch: Partial<ModelSelection>) => void
  refreshCustomProviders: () => Promise<void>
  saveCustomProvider: (input: CustomProviderInput) => Promise<CustomProviderView>
  removeCustomProvider: (id: string) => Promise<void>
  testCustomProvider: (input: CustomProviderInput) => Promise<CustomProviderTestResult>
  completeOnboarding: () => Promise<void>
  applyEvent: (event: AgentEvent) => void
  /** Replace (or clear) the tracked task plan (v2.5.7). */
  setTaskPlan: (plan: TaskPlan | null) => void
  /** Pause the running task plan (UI control). */
  pauseTaskPlan: () => void
  /** Resume a paused task plan. */
  resumeTaskPlan: () => void
  /** Stop the running task plan and mark it failed. */
  stopTaskPlan: () => void
  /** v2.6.2 T4.4: reload the active project's goals + goal resolution. */
  refreshGoals: () => Promise<void>
  /** Create a goal for the active project; the first one becomes active. */
  createGoal: (title: string, criteria?: string[]) => Promise<void>
  updateGoalTitle: (goalId: string, title: string) => Promise<void>
  /** Tick/untick one success criterion. */
  toggleGoalCriterion: (goalId: string, criterionId: string, met: boolean) => Promise<void>
  /** Pin (or unpin, with null) the goal the next run attaches to. */
  setActiveGoal: (goalId: string | null) => Promise<void>
  achieveGoal: (goalId: string) => Promise<void>
  abandonGoal: (goalId: string, note?: string) => Promise<void>
  removeGoal: (goalId: string) => Promise<void>
  send: (text: string) => Promise<void>
  abort: () => void
  newSession: () => void
  /** v2.6.2 T5.1: archive the current chat and start a fresh context. */
  compactContext: () => Promise<void>
  loadSession: (id: string) => Promise<void>
  refreshSessions: () => Promise<void>
  /** v2.6.1 Fix 5: load the active chat's memory summary. */
  refreshMemory: () => Promise<void>
  /** v2.6.1 Fix 5: forget the active chat's stored history + trusted plan. */
  clearMemory: () => Promise<void>

  refreshFiles: (path?: string) => Promise<void>
  openFile: (path: string) => Promise<void>
  setDraft: (content: string) => void
  saveFile: () => Promise<void>
  discardDraft: () => void

  submitJob: (request: WorkerJobRequest) => Promise<void>
  cancelJob: (id: string) => Promise<void>
  setOnline: (online: boolean) => Promise<void>
  toggleRemote: () => Promise<void>

  addProject: (name: string, path: string) => Promise<void>
  addRemoteProject: (name: string, path: string, vpsId: string) => Promise<void>
  removeProject: (id: string) => Promise<void>
  openProject: (id: string) => Promise<void>
  /** Open a project without offering to transfer the open chat. */
  switchProject: (id: string, keepChat?: boolean) => Promise<void>
  /**
   * v2.8.0: start a brand-new chat bound to `id`, without the transfer dialog.
   *
   * This is the per-project "new chat" affordance in the sidebar. It deliberately
   * calls `switchProject` directly rather than `openProject` — the latter would run
   * the chat-transfer decision, which makes no sense when the user is asking for a
   * *new* conversation under a specific project.
   */
  startChatInProject: (id: string) => Promise<void>
  /** Apply the chosen chat transfer and switch to the pending project. */
  completeProjectSwitch: (
    id: string,
    choice: ChatTransferChoice,
    remember?: boolean
  ) => Promise<void>
  cancelProjectSwitch: () => void
  setChatTransferPreference: (preference: ChatTransferPreference) => void
  updateProjectPath: (id: string, path: string) => Promise<void>
  updateProjectMetadata: (id: string, patch: ProjectMetadataPatch) => Promise<void>
  searchVpsProject: (name: string) => Promise<string[]>
  setApiKey: (provider: ProviderId, apiKey: string) => Promise<void>
  removeApiKey: (provider: ProviderId) => Promise<void>
  setModel: (provider: ProviderId, model: string) => Promise<void>
  setActiveProvider: (provider: ProviderId) => Promise<void>

  clearError: () => void
  dismissLoopStop: () => void
}

/**
 * U-1: slices that belong to the *open project*. None of them may survive a
 * project switch or removal: keeping them left project A's pending agent diffs
 * listed with live Apply buttons (writing into A while the UI said B), A's
 * "what this chat remembers" panel, and A's open file — which Ctrl+S would then
 * commit. `memory` is cleared too and re-read for the new chat afterwards.
 */
function projectScopedReset(): Partial<AppState> {
  return {
    entries: [],
    cwd: '.',
    selectedFile: null,
    fileContent: '',
    draft: null,
    saving: false,
    projectMissing: false,
    fileChanges: [],
    memory: null,
    taskPlan: null,
    taskPlans: {},
    searchResults: [],
    searchOpen: false
  }
}

/** U-1: slices that belong to the open chat, dropped when it is not transferred. */
function chatScopedReset(): Partial<AppState> {
  return {
    sessionId: newId(),
    activeChatId: null,
    messages: [],
    logs: [],
    decisions: [],
    warnings: [],
    preflightNotice: null,
    loopStop: null,
    memory: null
  }
}

let autosaveTimer: ReturnType<typeof setInterval> | null = null

function startAutosave(get: () => AppState): void {
  if (autosaveTimer || typeof setInterval !== 'function') return
  autosaveTimer = setInterval(() => {
    const state = get()
    if (state.messages.length > 0) void state.persistChat()
  }, AUTOSAVE_INTERVAL_MS)
}

export const useStore = create<AppState>((set, get) => ({
  ready: false,
  settings: null,
  settingsOpen: false,
  view: 'chat',

  messages: [],
  running: false,
  currentRunId: null,
  sessionId: newId(),
  logs: [],
  decisions: [],
  warnings: [],
  preflightNotice: null,
  loopStop: null,
  sessions: [],
  memory: null,

  entries: [],
  cwd: '.',
  selectedFile: null,
  fileContent: '',
  draft: null,
  saving: false,

  worker: null,
  remote: null,
  error: null,
  projectMissing: false,
  selection: DEFAULT_SELECTION,
  customProviders: [],
  onboarding: null,
  migrationOpen: false,
  pendingProjectSwitch: null,
  chatTransferPreference: readChatTransferPreference(),

  locale: detectLocale(),
  sidebarCollapsed: false,
  sidebarPinned: readSidebarPinned(),
  // v2.7.0: theme preference (light is the default "day" theme).
  theme: readStoredTheme(),
  showContextBeforeSend: readShowContextBeforeSend(),
  usageRecords: loadUsage(),
  sessionStartedAt: Date.now(),
  chats: [],
  activeChatId: null,
  vpsServerId: undefined,
  vpsServers: [],
  vpsStatus: { status: 'disconnected' },
  vpsStates: {},
  vpsConnected: [],
  diagnostic: null,
  fullAccessExpiresAt: null,
  planMode: false,
  pendingApproval: null,
  pendingPlan: null,
  pendingPreflight: null,
  activePlan: null,
  taskPlan: null,
  taskPlans: {},
  taskPaused: false,
  goals: [],
  goalResolution: null,
  goalsBusy: false,
  approvalSuggestion: null,
  queuedExplain: null,
  fileChanges: [],
  toasts: [],
  chatTreeOpen: readChatTreeOpen(),
  workspacePanelOpen: true,
  workspacePanelTab: 'output',
  terminalOpen: false,
  terminalLines: [],
  searchOpen: false,
  searchResults: [],
  paletteOpen: false,
  jobs: [],
  jobsPanelOpen: false,
  showJobsPanelAlways: readShowJobsPanelAlways(),
  showRawToolRows: readShowRawToolRows(),
  showContextWarning: readShowContextWarning(),
  zoomLevel: readZoomLevel(),
  shortcutsOpen: false,

  setLocale(locale) {
    set({ locale })
    void i18nChangeLanguage(locale)
  },
  toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
  setSidebarPinned(value) {
    // Pinning means "keep it open", so it also un-collapses; unpinning leaves the
    // current collapsed state untouched.
    set(value ? { sidebarPinned: true, sidebarCollapsed: false } : { sidebarPinned: false })
    try {
      globalThis.localStorage?.setItem(SIDEBAR_PIN_KEY, value ? '1' : '0')
    } catch {
      // Persisting the preference is best-effort.
    }
  },
  dismissPreflight: () => set({ preflightNotice: null }),
  /**
   * v2.7.0: switch the theme. The preference is persisted and pushed onto
   * `<html>` immediately so the CSS variables swap without a re-render.
   */
  setTheme(preference) {
    set({ theme: preference })
    storeTheme(preference)
    if (typeof document !== 'undefined') {
      applyTheme(preference, document.documentElement)
    }
  },
  setShowContextBeforeSend(value) {
    set({ showContextBeforeSend: value })
    try {
      globalThis.localStorage?.setItem(CONTEXT_SETTINGS_KEY, value ? '1' : '0')
    } catch {
      // Persisting the preference is best-effort.
    }
  },
  recordUsage(record) {
    const full: UsageRecord = { ...record, timestamp: record.timestamp ?? Date.now() }
    const usageRecords = appendUsage(get().usageRecords, full)
    set({ usageRecords })
    saveUsage(usageRecords)
  },
  resetUsage() {
    set({ usageRecords: [] })
    saveUsage([])
  },
  setVpsServerId: (id) => {
    set({ vpsServerId: id })
    try {
      if (id) globalThis.localStorage?.setItem(VPS_RECONNECT_KEY, id)
      else globalThis.localStorage?.removeItem(VPS_RECONNECT_KEY)
    } catch {
      // Persisting the last VPS is best-effort.
    }
  },
  async refreshDiagnostic() {
    try {
      set({ diagnostic: await window.api.diagnostic.status() })
    } catch {
      set({ diagnostic: null })
    }
  },
  async setDiagnosticMode(enabled) {
    try {
      const status = enabled
        ? await window.api.diagnostic.enable()
        : await window.api.diagnostic.disable()
      set({ diagnostic: status })
    } catch {
      await get().refreshDiagnostic()
    }
  },
  async refreshVps() {
    try {
      const [servers, status] = await Promise.all([
        window.api.vps.list(),
        window.api.vps.status()
      ])
      // Fetch the connected set independently: it is additive information, so a
      // failure here must not wipe the server list or the connection status.
      let connected: string[] = status.status === 'connected' && status.serverId ? [status.serverId] : []
      try {
        connected = await window.api.vps.connected()
      } catch {
        // Older bridge or transient failure: fall back to the single status.
      }
      set({ vpsServers: servers, vpsStatus: status, vpsConnected: connected })
    } catch {
      set({ vpsServers: [], vpsStatus: { status: 'disconnected' }, vpsConnected: [] })
    }
  },
  async refreshVpsConnected() {
    try {
      set({ vpsConnected: await window.api.vps.connected() })
    } catch {
      // Leave the last known list: a transient failure must not flip every
      // project to "Not connected".
    }
  },
  /**
   * v2.6.4: background connect for keepalive / other projects. Unlike
   * `connectVps`, this never moves the chat-header selection, so bringing a
   * second project's host up does not yank the user's current choice.
   */
  async ensureVpsConnected(serverId) {
    if (get().vpsConnected.includes(serverId)) return
    try {
      const status = await window.api.vps.connect(serverId)
      get().setVpsStatus(status)
    } catch (error) {
      get().setVpsStatus({
        status: 'error',
        serverId,
        error: error instanceof Error ? error.message : String(error)
      })
    }
    await get().refreshVpsConnected()
  },
  async connectVps(serverId) {
    // Select first so the status that comes back is treated as the *selected*
    // server's (v2.6.5), then let setVpsStatus route it.
    set({ vpsServerId: serverId })
    get().setVpsStatus({ status: 'connecting', serverId })
    try {
      const status = await window.api.vps.connect(serverId)
      get().setVpsStatus(status)
      await get().refreshVpsConnected()
    } catch (error) {
      get().setVpsStatus({
        status: 'error',
        serverId,
        error: error instanceof Error ? error.message : String(error)
      })
      await get().refreshVpsConnected()
    }
  },
  async disconnectVps(serverId) {
    const status = await window.api.vps.disconnect(serverId)
    get().setVpsStatus({ ...status, serverId: status.serverId ?? serverId })
    await get().refreshVpsConnected()
  },
  /**
   * v2.6.5: a status event describes ONE server, but it used to be written
   * straight into the single `vpsStatus` the chat header renders. With "every
   * project stays connected" the keepalive brings other projects' hosts up, so
   * the header showed a different host's state — and an idle disconnect of an
   * unrelated server flipped the selected one to "disconnected". Track every
   * server and only move the global when the event concerns the selection.
   */
  setVpsStatus: (status) =>
    set((state) => {
      const serverId = status.serverId
      const vpsStates = serverId ? { ...state.vpsStates, [serverId]: status } : state.vpsStates
      const concernsSelection = !serverId || !state.vpsServerId || state.vpsServerId === serverId
      return { vpsStates, ...(concernsSelection ? { vpsStatus: status } : {}) }
    }),
  toggleTerminal: () => set({ terminalOpen: !get().terminalOpen }),
  setSearchOpen: (open) => set({ searchOpen: open, ...(open ? {} : { searchResults: [] }) }),
  async runCodeSearch(query) {
    const trimmed = query.trim()
    if (!trimmed) {
      set({ searchResults: [] })
      return
    }
    try {
      set({ searchResults: await window.api.search.code(trimmed) })
    } catch {
      set({ searchResults: [] })
    }
  },
  async runTerminalCommand(command) {
    const trimmed = command.trim()
    if (!trimmed) return
    const push = (kind: TerminalLineKind, text: string): void => {
      const lines = [...get().terminalLines, { id: newId(), kind, text }]
      if (lines.length > MAX_TERMINAL_LINES) lines.splice(0, lines.length - MAX_TERMINAL_LINES)
      set({ terminalLines: lines })
    }
    push('command', `$ ${trimmed}`)
    try {
      const result = await window.api.shell.exec(trimmed)
      if (result.stdout) push('stdout', result.stdout.replace(/\n$/, ''))
      if (result.stderr) push('stderr', result.stderr.replace(/\n$/, ''))
      if (result.exitCode !== 0) push('info', `exit ${result.exitCode}`)
    } catch (error) {
      push('stderr', error instanceof Error ? error.message : String(error))
    }
  },
  toggleChatTree() {
    const value = !get().chatTreeOpen
    set({ chatTreeOpen: value })
    try {
      globalThis.localStorage?.setItem(CHAT_TREE_KEY, value ? '1' : '0')
    } catch {
      // Persisting the preference is best-effort.
    }
  },
  setPlanMode: (value) => set({ planMode: value }),
  toggleWorkspacePanel: () => set({ workspacePanelOpen: !get().workspacePanelOpen }),
  setWorkspacePanelTab: (tab) => set({ workspacePanelTab: tab, workspacePanelOpen: true }),
  async setApprovalMode(mode) {
    set({ settings: await window.api.settings.setApprovalMode(mode) })
    if (mode === 'full') {
      const expiresAt = Date.now() + FULL_ACCESS_TTL_MS
      set({ fullAccessExpiresAt: expiresAt })
      if (fullAccessTimer) clearTimeout(fullAccessTimer)
      fullAccessTimer = setTimeout(() => {
        void get().setApprovalMode('ask')
        get().pushToast('warning', 'Full access turned off after 30 minutes of inactivity.')
      }, FULL_ACCESS_TTL_MS)
      fullAccessTimer.unref?.()
    } else {
      set({ fullAccessExpiresAt: null })
      if (fullAccessTimer) {
        clearTimeout(fullAccessTimer)
        fullAccessTimer = null
      }
    }
  },
  async setRememberApprovalMode(enabled) {
    set({ settings: await window.api.settings.setRememberApprovalMode(enabled) })
  },
  async setPlanModeDefault(value) {
    set({ settings: await window.api.settings.setPlanModeDefault(value) })
  },
  async respondApproval(answer) {
    const pending = get().pendingApproval
    if (!pending) return
    const outcome: ApprovalOutcome =
      typeof answer === 'boolean' ? { approved: answer } : answer
    // U-5: only clear the gate once main has accepted the answer. Clearing it
    // optimistically made a failed reply look like a decision, while the run
    // hung until main's 2-minute fail-closed timeout with no visible error.
    try {
      await window.api.agent.respondApproval(pending.id, answer)
    } catch (error) {
      get().pushToast(
        'error',
        `${i18n.t('toast.actionFailed')} ${error instanceof Error ? error.message : String(error)}`
      )
      return
    }
    if (outcome.explain) {
      set({
        queuedExplain:
          `You tried to ${pending.summary}, but I denied it. ` +
          'Explain why you wanted to do that and propose a safer alternative.'
      })
    }
    set({ pendingApproval: null })
  },
  async respondPlan(decision) {
    const pending = get().pendingPlan
    if (!pending) return
    try {
      await window.api.agent.respondPlan(pending.id, decision)
    } catch (error) {
      get().pushToast(
        'error',
        `${i18n.t('toast.actionFailed')} ${error instanceof Error ? error.message : String(error)}`
      )
      return
    }
    set({ pendingPlan: null })
  },
  async respondPreflight(choice) {
    const pending = get().pendingPreflight
    if (!pending) return
    try {
      await window.api.agent.respondPreflight(pending.id, choice)
    } catch (error) {
      get().pushToast(
        'error',
        `${i18n.t('toast.actionFailed')} ${error instanceof Error ? error.message : String(error)}`
      )
      return
    }
    set({ pendingPreflight: null })
  },
  stopPlan() {
    set({ activePlan: null })
    void window.api.agent.stopPlan()
  },
  async rememberApprovalTool(tool) {
    await window.api.agent.rememberApprovalTool(tool)
    set({ approvalSuggestion: null })
    get().pushToast('success', `Always allowing ${tool}.`)
  },
  dismissApprovalSuggestion() {
    set({ approvalSuggestion: null })
  },
  async applyFileChange(id) {
    const ok = await window.api.agent.applyChange(id)
    if (ok) {
      set({ fileChanges: get().fileChanges.filter((change) => change.id !== id) })
      void get().refreshFiles()
    }
  },
  async rejectFileChange(id) {
    const ok = await window.api.agent.rejectChange(id)
    if (ok) set({ fileChanges: get().fileChanges.filter((change) => change.id !== id) })
  },
  pushToast(kind, message) {
    const id = newId()
    set({ toasts: [...get().toasts, { id, kind, message: redact(message) }] })
    // U-13: an error is the only record of a failure, so it stays until the user
    // dismisses it. Success/warning toasts remain self-clearing.
    if (kind === 'error') return
    setTimeout(() => get().dismissToast(id), 3000)
  },
  dismissToast(id) {
    set({ toasts: get().toasts.filter((toast) => toast.id !== id) })
  },
  setPaletteOpen: (open) => set({ paletteOpen: open }),

  async refreshJobs() {
    const api = window.api?.jobs
    if (!api) return
    let next: Job[]
    try {
      next = await api.refresh()
    } catch {
      return
    }
    for (const job of next) {
      const last = jobStatuses.get(job.id)
      if (last && last !== job.status && (job.status === 'completed' || job.status === 'failed')) {
        get().pushToast(
          job.status === 'completed' ? 'success' : 'error',
          i18n.t('jobs.finishedToast', { id: job.id.slice(0, 8), status: job.status })
        )
      }
    }
    jobStatuses.clear()
    for (const job of next) jobStatuses.set(job.id, job.status)
    set({ jobs: next })
  },
  setJobsPanelOpen: (open) => set({ jobsPanelOpen: open }),
  setShowJobsPanelAlways(value) {
    set({ showJobsPanelAlways: value, ...(value ? { jobsPanelOpen: true } : {}) })
    try {
      globalThis.localStorage?.setItem(JOBS_PANEL_KEY, value ? '1' : '0')
    } catch {
      // Persisting the preference is best-effort.
    }
  },
  setShowRawToolRows(value) {
    set({ showRawToolRows: value })
    try {
      globalThis.localStorage?.setItem(RAW_TOOL_ROWS_KEY, value ? '1' : '0')
    } catch {
      // Persisting the preference is best-effort.
    }
  },
  setShowContextWarning(value) {
    set({ showContextWarning: value })
    try {
      globalThis.localStorage?.setItem(CONTEXT_WARNING_KEY, value ? '1' : '0')
    } catch {
      // Persisting the preference is best-effort.
    }
  },
  applyZoom(level) {
    const clamped = clampZoom(level)
    set({ zoomLevel: clamped })
    try {
      globalThis.localStorage?.setItem(ZOOM_KEY, String(clamped))
    } catch {
      // Persisting the zoom is best-effort.
    }
    void window.api?.window?.setZoom(clamped).catch(() => undefined)
  },
  zoomIn: () => get().applyZoom(get().zoomLevel + ZOOM_STEP),
  zoomOut: () => get().applyZoom(get().zoomLevel - ZOOM_STEP),
  resetZoom: () => get().applyZoom(0),
  setShortcutsOpen: (open) => set({ shortcutsOpen: open }),

  async refreshChats() {
    try {
      set({ chats: await window.api.chats.list() })
    } catch {
      // Chat history is best-effort.
    }
  },

  async persistChat() {
    const { messages, activeChatId, vpsServerId, selection } = get()
    const stored: StoredMessage[] = messages
      .filter((message) => message.role !== 'tool')
      .map((message) => ({
        id: message.id,
        role: message.role as StoredMessage['role'],
        content: message.content,
        at: message.at,
        ...(message.model ? { model: message.model } : {}),
        ...(message.usedRemote ? { usedRemote: true } : {})
      }))
    if (stored.length === 0) return
    try {
      const workspaceId = get().settings?.activeProjectId
      const chat = await window.api.chats.save({
        ...(activeChatId ? { id: activeChatId } : {}),
        messages: stored,
        model: selection,
        ...(vpsServerId ? { vpsServerId } : {}),
        ...(workspaceId ? { workspaceId } : {})
      })
      set({ activeChatId: chat.id })
      rememberChatId(chat.id)
      await get().refreshChats()
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  },

  async renameChat(id, title) {
    await window.api.chats.rename(id, title)
    await get().refreshChats()
  },

  async deleteChat(id) {
    await window.api.chats.remove(id)
    if (get().activeChatId === id) {
      set({ activeChatId: null, messages: [], logs: [], decisions: [], warnings: [] })
    }
    await get().refreshChats()
  },

  async duplicateChat(id) {
    const source = await window.api.chats.load(id)
    if (!source) return
    const saved = await window.api.chats.save({
      title: `${source.title} (copy)`,
      ...(source.workspaceId ? { workspaceId: source.workspaceId } : {}),
      ...(source.vpsServerId ? { vpsServerId: source.vpsServerId } : {}),
      ...(source.forkedFromId ? { forkedFromId: source.forkedFromId } : {}),
      ...(source.model ? { model: source.model } : {}),
      messages: source.messages
    })
    await get().refreshChats()
    await get().loadSession(saved.id)
  },

  async forkChat(id, messageId) {
    const source = await window.api.chats.load(id)
    if (!source) return null
    const index = source.messages.findIndex((message) => message.id === messageId)
    if (index < 0) return null
    const saved = await window.api.chats.save({
      title: `${source.title} (fork)`,
      forkedFromId: id,
      ...(source.workspaceId ? { workspaceId: source.workspaceId } : {}),
      ...(source.vpsServerId ? { vpsServerId: source.vpsServerId } : {}),
      ...(source.model ? { model: source.model } : {}),
      messages: source.messages.slice(0, index + 1)
    })
    await get().refreshChats()
    await get().loadSession(saved.id)
    return saved.id
  },

  async init() {
    try {
      const [settings, worker, remote, customProviders, onboarding, chats] = await Promise.all([
        window.api.settings.get(),
        window.api.worker.status(),
        window.api.remote.status(),
        window.api.customProviders.list(),
        window.api.onboarding.get(),
        window.api.chats.list()
      ])
      set({
        settings,
        worker,
        remote,
        customProviders,
        onboarding,
        chats,
        ready: true,
        planMode: settings.planModeDefault ?? false,
        selection: resolveSelection(settings)
      })
      await get().refreshFiles()
      await get().refreshSessions()
      await get().refreshGoals()

      // Offer to fix projects whose folder is missing (e.g. a path from another OS).
      if (
        (onboarding?.completed ?? false) &&
        settings.projects.some((project) => project.exists === false && project.type !== 'remote')
      ) {
        set({ migrationOpen: true })
      }

      // Resume where the user left off, then keep the open chat saved so a
      // crash mid-run does not lose the conversation.
      const lastChatId = readLastChatId()
      if (lastChatId && chats.some((chat) => chat.id === lastChatId) && get().messages.length === 0) {
        await get().loadSession(lastChatId)
      }
      startAutosave(get)
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error), ready: true })
    }
  },

  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  closeMigration: () => set({ migrationOpen: false }),
  setView: (view) => set({ view }),
  setSelection: (patch) => set({ selection: { ...get().selection, ...patch } }),

  async refreshCustomProviders() {
    set({ customProviders: await window.api.customProviders.list() })
  },
  async saveCustomProvider(input) {
    const view = await window.api.customProviders.save(input)
    await get().refreshCustomProviders()
    return view
  },
  async removeCustomProvider(id) {
    await window.api.customProviders.remove(id)
    await get().refreshCustomProviders()
    if (get().selection.customProviderId === id) set({ selection: DEFAULT_SELECTION })
  },
  testCustomProvider: (input) => window.api.customProviders.test(input),
  async completeOnboarding() {
    set({ onboarding: await window.api.onboarding.complete() })
  },

  applyEvent(event) {
    switch (event.type) {
      case 'run:start':
        set({
          running: true,
          currentRunId: event.runId,
          error: null,
          logs: [],
          decisions: [],
          pendingApproval: null,
          pendingPlan: null,
          pendingPreflight: null,
          activePlan: null,
          taskPlan: null,
          taskPaused: false,
          loopStop: null,
          preflightNotice: null
        })
        break
      case 'approval:request':
        set({ pendingApproval: event.request })
        break
      case 'plan:request':
        set({ pendingPlan: event.request })
        break
      case 'preflight:request':
        set({ pendingPreflight: event.request })
        break
      case 'preflight:resolved':
        if (get().pendingPreflight?.id === event.id) set({ pendingPreflight: null })
        break
      case 'plan:resolved':
        if (get().pendingPlan?.id === event.id) set({ pendingPlan: null })
        break
      case 'plan:active':
        set({ activePlan: event.plan })
        break
      case 'plan:inactive':
        set({ activePlan: null })
        break
      case 'task:plan':
      case 'task:step':
      case 'task:complete':
      case 'task:failed':
        set({
          taskPlan: event.plan,
          taskPlans: withTaskPlan(get().taskPlans, event.plan),
          ...(event.type === 'task:complete' || event.type === 'task:failed'
            ? { taskPaused: false }
            : {})
        })
        break
      case 'approval:suggestion':
        set({ approvalSuggestion: { tool: event.tool, count: event.count } })
        get().pushToast(
          'warning',
          `You approved ${event.tool} ${event.count} times. Remember it to skip prompts?`
        )
        break
      case 'file:change':
        set({ fileChanges: [...get().fileChanges, event.change] })
        break
      case 'file:change:resolved':
        set({ fileChanges: get().fileChanges.filter((change) => change.id !== event.id) })
        break
      case 'log': {
        const logs = [...get().logs, event.entry]
        if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS)
        // v2.6.2 T3.2: a 'decision' entry is also the live timeline's input.
        if (event.entry.event === 'decision' && event.entry.decision) {
          const decisions = [...get().decisions, event.entry.decision as TraceDecision]
          if (decisions.length > MAX_DECISIONS) {
            decisions.splice(0, decisions.length - MAX_DECISIONS)
          }
          set({ logs, decisions })
        } else if (event.entry.event === 'preflight' && Array.isArray(event.entry.checks)) {
          // v2.6.3 T3.1: the orchestrator emits one tiered entry per non-ok check.
          set({
            logs,
            preflightNotice: {
              tool: String(event.entry.tool ?? ''),
              ...(typeof event.entry.step === 'number' ? { step: event.entry.step } : {}),
              tier: (event.entry.tier as PreflightNotice['tier']) ?? 'warn',
              checks: event.entry.checks as PreflightNotice['checks'],
              blocked: Boolean(event.entry.blocked),
              at: Date.now()
            }
          })
        } else {
          set({ logs })
        }
        break
      }
      case 'tool:result': {
        const toolCall = toolCallFromView(event.result)
        const code = event.result.code !== undefined ? ` (${String(event.result.code)})` : ''
        set({
          messages: capMessages(
            [
              ...get().messages,
              {
                id: newId(),
                role: 'tool',
                content: `${toolCall.name}${code}`,
                at: event.at,
                runId: event.runId,
                toolCall
              }
            ],
            event.runId
          )
        })
        break
      }
      case 'run:end': {
        const text = event.finalAnswer ?? event.message ?? ''
        const messages = [...get().messages]
        const usedRemote = get().logs.some(
          (entry) => entry.event === 'action.ok' && entry.tool === 'remote_shell'
        )
        if (text) {
          messages.push({
            id: newId(),
            role: 'assistant',
            content: text,
            at: event.at,
            runId: event.runId,
            ...(event.model ? { model: event.model } : {}),
            ...(usedRemote ? { usedRemote: true } : {})
          })
        }
        set({
          running: false,
          currentRunId: null,
          warnings: event.warnings,
          loopStop: event.stop ?? null,
          pendingApproval: null,
          pendingPlan: null,
          pendingPreflight: null,
          activePlan: null,
          messages: capMessages(messages, null)
        })
        const explain = get().queuedExplain
        if (explain) {
          set({ queuedExplain: null })
          void get().send(explain)
        }
        if (event.usage) {
          get().recordUsage({
            provider: event.provider ?? get().selection.provider,
            model: event.model ?? get().selection.model,
            inputTokens: event.usage.promptTokens,
            outputTokens: event.usage.completionTokens,
            timestamp: event.at
          })
        }
        void get().persistChat()
        void get().refreshSessions()
        void get().refreshMemory()
        break
      }
      case 'error':
        set({
          running: false,
          currentRunId: null,
          pendingApproval: null,
          pendingPlan: null,
          pendingPreflight: null,
          activePlan: null,
          error: redact(event.message),
          loopStop: null,
          messages: capMessages(
            [
              ...get().messages,
              { id: newId(), role: 'system', content: `Error: ${redact(event.message)}`, at: Date.now() }
            ],
            get().currentRunId
          )
        })
        get().pushToast('error', event.message)
        break
    }
  },

  setTaskPlan(plan) {
    set({
      taskPlan: plan,
      ...(plan ? { taskPlans: withTaskPlan(get().taskPlans, plan) } : {})
    })
  },
  pauseTaskPlan() {
    set({ taskPaused: true })
  },
  resumeTaskPlan() {
    set({ taskPaused: false })
  },
  stopTaskPlan() {
    const plan = get().taskPlan
    if (!plan) {
      set({ taskPaused: false })
      return
    }
    const stopped: TaskPlan = { ...plan, status: 'failed' }
    set({
      taskPlan: stopped,
      taskPlans: withTaskPlan(get().taskPlans, stopped),
      taskPaused: false
    })
  },

  /** v2.6.2 T4.4: the goal list is main-owned; the store only mirrors it. */
  async refreshGoals() {
    const hasProject = get().goals.length > 0 || get().settings?.projects.length
    if (!hasProject) {
      set({ goals: [], goalResolution: null })
      return
    }
    try {
      const [goals, goalResolution] = await Promise.all([
        window.api.agent.goal.list(),
        window.api.agent.goal.resolve()
      ])
      set({ goals, goalResolution })
    } catch {
      // No active project (or a transient failure): show the empty state.
      set({ goals: [], goalResolution: null })
    }
  },
  async createGoal(title, criteria) {
    const trimmed = title.trim()
    if (!trimmed || get().goalsBusy) return
    set({ goalsBusy: true })
    try {
      await window.api.agent.goal.create({
        title: trimmed,
        ...(criteria && criteria.length > 0 ? { criteria } : {})
      })
    } finally {
      set({ goalsBusy: false })
      await get().refreshGoals()
    }
  },
  async updateGoalTitle(goalId, title) {
    const trimmed = title.trim()
    if (!trimmed || get().goalsBusy) return
    set({ goalsBusy: true })
    try {
      await window.api.agent.goal.update(goalId, { title: trimmed })
    } finally {
      set({ goalsBusy: false })
      await get().refreshGoals()
    }
  },
  async toggleGoalCriterion(goalId, criterionId, met) {
    set({ goalsBusy: true })
    try {
      await window.api.agent.goal.setCriterion(goalId, criterionId, met)
    } finally {
      set({ goalsBusy: false })
      await get().refreshGoals()
    }
  },
  async setActiveGoal(goalId) {
    set({ goalsBusy: true })
    try {
      await window.api.agent.goal.setActive(goalId)
    } finally {
      set({ goalsBusy: false })
      await get().refreshGoals()
    }
  },
  async achieveGoal(goalId) {
    set({ goalsBusy: true })
    try {
      await window.api.agent.goal.achieve(goalId)
    } finally {
      set({ goalsBusy: false })
      await get().refreshGoals()
    }
  },
  async abandonGoal(goalId, note) {
    set({ goalsBusy: true })
    try {
      await window.api.agent.goal.abandon(goalId, note)
    } finally {
      set({ goalsBusy: false })
      await get().refreshGoals()
    }
  },
  async removeGoal(goalId) {
    set({ goalsBusy: true })
    try {
      await window.api.agent.goal.remove(goalId)
    } finally {
      set({ goalsBusy: false })
      await get().refreshGoals()
    }
  },

  async send(text) {
    const trimmed = text.trim()
    if (!trimmed || get().running) return
    const selection = get().selection
    // Fix 1 (v2.6.1): pin a stable chat id *before* the first run. Without this
    // a new chat sent message 1 under the throwaway `sessionId`, then
    // `persistChat()` assigned a different server-generated `activeChatId`, so
    // message 2 ran under a different session id. Reusing `sessionId` as the
    // chat id keeps `sessionId === activeChatId` for the chat's whole life.
    const activeChatId = get().activeChatId ?? get().sessionId
    if (!get().activeChatId) set({ activeChatId })
    set({
      messages: [...get().messages, { id: newId(), role: 'user', content: trimmed, at: Date.now() }],
      running: true,
      error: null
    })
    void get().persistChat()
    try {
      await window.api.agent.run({
        task: trimmed,
        sessionId: activeChatId,
        // Fix 2 (v2.6.1): load the stored session so the model sees the whole
        // conversation, not just this turn. The agent persists each run under
        // this same id, so the history accumulates across messages.
        resumeSessionId: activeChatId,
        provider: selection.provider,
        model: selection.model,
        ...(selection.customProviderId ? { customProviderId: selection.customProviderId } : {}),
        ...(get().vpsServerId ? { vpsServerId: get().vpsServerId } : {}),
        enabledTools: readEnabledTools(),
        planMode: get().planMode
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set({ running: false, error: message })
      get().pushToast('error', message)
    }
  },

  abort() {
    void window.api.agent.abort()
  },

  newSession() {
    const settings = get().settings
    set({
      sessionId: newId(),
      activeChatId: null,
      messages: [],
      logs: [],
      decisions: [],
      warnings: [],
      preflightNotice: null,
      loopStop: null,
      memory: null,
      running: false,
      currentRunId: null,
      error: null,
      pendingApproval: null,
      pendingPlan: null,
      pendingPreflight: null,
      activePlan: null,
      approvalSuggestion: null,
      queuedExplain: null,
      fileChanges: [],
      view: 'chat'
    })
    // Full access is per-session unless the user asked to remember it.
    if (settings?.approvalMode === 'full' && !settings.rememberApprovalMode) {
      void get().setApprovalMode('ask')
    }
  },

  async compactContext() {
    if (get().running) return
    const count = get().messages.length
    if (count === 0) return
    // Persist first so the archived chat stays retrievable from the sidebar,
    // then start a fresh session. Waiting on the save matters: it assigns
    // `activeChatId` to the archived chat, and `newSession` must run *after*
    // that so the next run resumes no history and the context is really freed.
    await get().persistChat()
    get().newSession()
    // Point resume-at-startup at the (empty) new session, not the archive.
    rememberChatId(get().sessionId)
    get().pushToast('success', i18n.t('chat.compacted', { count }))
  },

  async loadSession(id) {
    const record = await window.api.chats.load(id)
    if (!record) return
    rememberChatId(id)
    set({
      sessionId: id,
      activeChatId: id,
      vpsServerId: record.vpsServerId,
      messages: record.messages
        .filter((message) => message.role !== 'system')
        .map((message) => ({
          id: message.id || newId(),
          role: message.role,
          content: message.content,
          at: message.at,
          ...(message.model ? { model: message.model } : {}),
          ...(message.usedRemote ? { usedRemote: true } : {})
        })),
      logs: [],
      decisions: [],
      warnings: [],
      loopStop: null,
      view: 'chat'
    })
    void get().refreshMemory()
  },

  async refreshSessions() {
    try {
      set({ sessions: await window.api.agent.sessions() })
    } catch {
      // Sessions are best-effort.
    }
  },

  async refreshMemory() {
    const id = get().activeChatId ?? get().sessionId
    try {
      set({ memory: await window.api.agent.memory(id) })
    } catch {
      // Memory is best-effort; never block the UI on it.
    }
  },

  async clearMemory() {
    const id = get().activeChatId ?? get().sessionId
    try {
      await window.api.agent.clearMemory(id)
    } catch {
      // Ignore a failed clear; refresh below shows the true state.
    }
    // The stored transcript is gone, so drop the UI's trust chip too.
    set({ activePlan: null })
    await get().refreshMemory()
  },

  async refreshFiles(path) {
    const target = path ?? get().cwd
    const settings = get().settings
    const active = settings?.projects.find((project) => project.id === settings.activeProjectId)
    if (active?.type === 'remote') {
      // A remote project lives on a VPS: never probe the local filesystem, or
      // the UI would wrongly report "Path not found" (v2.3.2, A.2).
      set({ entries: [], cwd: target, projectMissing: false })
      return
    }
    try {
      const entries = await window.api.fs.list(target)
      set({ entries, cwd: target, projectMissing: false })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // No project selected yet is a normal first-run state, not an error.
      if (/No active project/i.test(message)) {
        set({ entries: [], projectMissing: false })
      } else if (/PATH_NOT_FOUND|Path not found/i.test(message)) {
        // A project path that only existed on another OS: mark, never crash.
        set({ entries: [], projectMissing: true })
      } else {
        set({ entries: [], error: message })
      }
    }
  },

  async openFile(path) {
    try {
      const fileContent = await window.api.fs.read(path)
      set({ selectedFile: path, fileContent, draft: null, view: 'files' })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  },

  setDraft: (content) => set({ draft: content }),
  discardDraft: () => set({ draft: null }),

  async saveFile() {
    const { selectedFile, draft } = get()
    if (!selectedFile || draft === null) return
    set({ saving: true })
    try {
      await window.api.fs.write(selectedFile, draft)
      set({ fileContent: draft, draft: null, saving: false })
    } catch (error) {
      set({ saving: false, error: error instanceof Error ? error.message : String(error) })
    }
  },

  async submitJob(request) {
    await window.api.worker.submit(request)
    set({ worker: await window.api.worker.status() })
  },

  async cancelJob(id) {
    await window.api.worker.cancel(id)
    set({ worker: await window.api.worker.status() })
  },

  async setOnline(online) {
    set({ worker: await window.api.worker.setOnline(online) })
  },

  async toggleRemote() {
    const status = get().remote
    const next = status?.enabled ? await window.api.remote.stop() : await window.api.remote.start()
    set({ remote: next })
  },

  async addProject(name, path) {
    set({ settings: await window.api.settings.addProject(name || basename(path), path) })
    await get().refreshFiles('.')
  },

  async addRemoteProject(name, path, vpsId) {
    set({ settings: await window.api.settings.addRemoteProject(name || basename(path), path, vpsId) })
  },

  async searchVpsProject(name) {
    const status = await window.api.vps.status()
    if (status.status !== 'connected' || !status.serverId) {
      get().pushToast('warning', i18n.t('vps.notConnected'))
      return []
    }
    return window.api.vps.searchProject(status.serverId, name)
  },

  async removeProject(id) {
    set({ settings: await window.api.settings.removeProject(id) })
    // U-1: the removed project's diffs, memory, open file and draft must not
    // outlive it — Apply/Ctrl+S would otherwise write into the deleted project.
    set({ ...projectScopedReset(), ...chatScopedReset() })
  },

  async openProject(id) {
    const current = get().settings?.activeProjectId
    if (id === current) {
      await get().refreshFiles('.')
      await get().refreshGoals()
      return
    }
    // v2.6.4 Fix D: don't silently leave an open conversation behind. Decide
    // (or ask) how the chat relates to the project being opened.
    const plan = planChatTransfer(
      get().chatTransferPreference,
      isConversationActive(get().messages)
    )
    if (plan.prompt) {
      set({ pendingProjectSwitch: id })
      return
    }
    if (!plan.transfer) {
      await get().switchProject(id)
      return
    }
    await get().completeProjectSwitch(id, plan.choice)
  },

  /**
   * U-1: a switch always drops every project-scoped slice. `keepChat` is true
   * only for a deliberate `link` transfer, where the conversation itself moves
   * with the user (its memory is re-read for the same chat id below).
   */
  async switchProject(id, keepChat = false) {
    set({ settings: await window.api.projects.open(id) })
    set({ ...projectScopedReset(), ...(keepChat ? {} : chatScopedReset()) })
    await get().refreshFiles('.')
    await get().refreshGoals()
    await get().refreshMemory()
  },

  /**
   * v2.8.0: the sidebar's per-project "+" — switch to `id` and start an empty chat
   * there. No transfer dialog: the user asked for a new conversation under a
   * specific project, so there is nothing to decide about the previous one (it is
   * already filed under its own project by the autosave).
   */
  async startChatInProject(id) {
    if (get().settings?.activeProjectId !== id) {
      await get().switchProject(id, false)
    } else {
      // Same project: a project switch is what normally resets the chat slices, so
      // reset them here too or the new "chat" would inherit the open conversation.
      set({ ...chatScopedReset() })
    }
    get().newSession()
  },

  async completeProjectSwitch(id, choice, remember = false) {
    if (remember) {
      writeChatTransferPreference(choice)
      set({ chatTransferPreference: choice })
    }
    // Persist under the current project first so the chat is never lost.
    await get().persistChat()
    const chatId = get().activeChatId
    // U-1: only the `link` choice deliberately carries the conversation over.
    await get().switchProject(id, choice === 'link')
    set({ pendingProjectSwitch: null })

    if (choice !== 'new' && chatId) {
      // Link the *same* chat (id + full history) into the new project so it
      // appears in that project's list rather than being copied.
      await window.api.chats.linkProject(chatId, id)
      await get().refreshChats()
    }
    if (choice !== 'link') {
      get().newSession()
      rememberChatId(get().sessionId)
    }
  },

  cancelProjectSwitch: () => set({ pendingProjectSwitch: null }),

  setChatTransferPreference(preference) {
    writeChatTransferPreference(preference)
    set({ chatTransferPreference: preference })
  },

  async updateProjectPath(id, path) {
    set({ settings: await window.api.settings.updateProjectPath(id, path) })
    await get().refreshFiles('.')
  },

  async updateProjectMetadata(id, patch) {
    set({ settings: await window.api.projects.updateMetadata(id, patch) })
  },

  async setApiKey(provider, apiKey) {
    set({ settings: await window.api.settings.setApiKey(provider, apiKey) })
  },

  async removeApiKey(provider) {
    set({ settings: await window.api.settings.removeApiKey(provider) })
  },

  async setModel(provider, model) {
    set({ settings: await window.api.settings.setModel(provider, model) })
  },

  async setActiveProvider(provider) {
    set({ settings: await window.api.settings.setActiveProvider(provider) })
  },

  clearError: () => set({ error: null }),
  dismissLoopStop: () => set({ loopStop: null })
}))

let unsubscribe: (() => void) | null = null

/** Wire main-process events into the store (idempotent). */
export function subscribeToEvents(): void {
  if (unsubscribe) return
  const offAgent = window.api.events.on('agent:event', (event) => useStore.getState().applyEvent(event))
  const offWorker = window.api.events.on('worker:status', (worker) => useStore.setState({ worker }))
  const offRemote = window.api.events.on('remote:status', (remote) => useStore.setState({ remote }))
  const offSettings = window.api.events.on('settings:changed', (settings) =>
    useStore.setState({ settings })
  )
  const offFiles = window.api.events.on('files:changed', () => {
    void useStore.getState().refreshFiles()
  })
  const offVps = window.api.events.on('vps:status', (status) => {
    useStore.getState().setVpsStatus(status)
    void useStore.getState().refreshVpsConnected()
  })
  const offDiagnostic = window.api.events.on('diagnostic:status', (diagnostic) =>
    useStore.setState({ diagnostic })
  )
  const offGoals = window.api.events.on('goal:changed', () => {
    void useStore.getState().refreshGoals()
  })
  unsubscribe = () => {
    offAgent()
    offWorker()
    offRemote()
    offSettings()
    offFiles()
    offVps()
    offDiagnostic()
    offGoals()
    unsubscribe = null
  }
}

export { basename }
