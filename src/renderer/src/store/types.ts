import type { ResolvedGoal } from '@core/agent/goal-store'
import type { AgentLogEntry, LoopStopInfo, LoopWarning } from '@shared/agent'
import type { ApprovalMode, ApprovalOutcome } from '@shared/approval'
import type { ChatSummary } from '@shared/chat'
import type { CheckpointMode } from '@shared/decision-checkpoint'
import type { Goal } from '@shared/goal'
import type { Job } from '@shared/jobs'
import type { OnboardingStatus } from '@shared/onboarding'
import type { ApprovedPlan, PlanDecision } from '@shared/plan'
import type { PreflightChoice, PreflightRequestView } from '@shared/preflight'
import type { ProjectMetadataPatch } from '@shared/project-metadata'
import type { RunOutput, RunOutputKind, RunSource } from '@shared/run-outputs'
import type { TaskPlan } from '@shared/task-plan'
import type { TraceDecision } from '@shared/trace'
import type {
  CustomProviderInput,
  CustomProviderTestResult,
  CustomProviderView,
  ProviderId
} from '@shared/types'
import type {
  AgentQuestionView,
  DiagnosticStatus,
  PreflightNotice,
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
  WorkerJobRequest,
  WorkerStatus
} from '@shared/ui'
import type { VpsConnectionState, VpsServerView } from '@shared/vps'
import type { Locale } from '../i18n/locale'
import type { ChatTransferChoice, ChatTransferPreference } from '../lib/chat-transfer'
import type { ThemePreference } from '../lib/theme'
import type { UiMode } from '../lib/ui-mode'
import type { UsageRecord } from '../lib/usage'

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

/** v2.8.0: one row of the "what changed" summary, keyed by path. */
export interface ChangedFile {
  path: string
  added: number
  removed: number
  /** How many times the agent wrote this path in this chat. */
  edits: number
}

export interface AppState {
  ready: boolean
  settings: SettingsView | null
  settingsOpen: boolean
  /** Set by `openSettingsTab`; SettingsPanel seeds its tab from this and clears it. */
  settingsTab: string | null
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
  /** v2.8.0: a question the agent is waiting on mid-run. */
  pendingQuestion: AgentQuestionView | null
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
  /** v2.8.0: every file the agent changed in this chat, with its diffstat. */
  changedFiles: ChangedFile[]
  /**
   * v2.8.0: the model's own reasoning per step, keyed `${runId}:${step}` — the same
   * key a trace decision uses, so the trace can show it inline. Never part of
   * `messages`: it is not conversation and must not be replayed to the provider.
   */
  reasoningByStep: Record<string, string>
  /** Transient toast notifications. */
  toasts: Toast[]
  /** Whether the file tree is shown next to the chat. */
  chatTreeOpen: boolean
  /** Whether the right workspace column (output/sources) is shown. */
  workspacePanelOpen: boolean
  /** Active tab of the right workspace column. */
  workspacePanelTab: WorkspacePanelTab
  /**
   * v4.1: whether the declared Sources/Outputs editor is open. Its only opener is the
   * right rail's Sources tab, so the flag has to outlive the rail's own local state.
   */
  sourcesPanelOpen: boolean
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
  /**
   * Checklist item 13: `simple` (the default) rests the advanced panes — the local terminal,
   * the chat file tree and the model's raw reasoning — until the user switches to `advanced`.
   */
  uiMode: UiMode
  /**
   * v3.0: what the user declared this run should produce (the composer's Outputs
   * section). Prompt text only — it never grants access to anything.
   */
  runOutputs: RunOutput[]
  /**
   * v3.0: extra sources that are not attachments — a folder picked with the
   * existing `dialog:pickDirectory`. Also prompt text only.
   */
  runSources: RunSource[]
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
  /** v2.8.0: answer the agent's mid-run question. */
  respondQuestion: (answer: string | null) => Promise<void>
  stopPlan: () => void
  rememberApprovalTool: (tool: string) => Promise<void>
  dismissApprovalSuggestion: () => void
  setRememberApprovalMode: (enabled: boolean) => Promise<void>
  /** v3.1: off / record / confirm decision checkpoints. */
  setCheckpointMode: (mode: CheckpointMode) => Promise<void>
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
  /**
   * Checklist item 13: switch interface mode. Going simple closes the panes it does not offer,
   * because a pane left open behind a hidden toggle is the same lie as a switch that gates
   * nothing.
   */
  setUiMode: (mode: UiMode) => void
  /** v3.0: declare one output for the next run (the Outputs section). */
  addRunOutput: (kind: RunOutputKind, target?: string) => void
  removeRunOutput: (id: string) => void
  /** v3.0: record a folder source (Sources → Add folder). */
  addRunSource: (value: string) => void
  removeRunSource: (id: string) => void
  /** Apply (and persist) an Electron zoom level, clamped to a safe range (T5.3). */
  applyZoom: (level: number) => void
  zoomIn: () => void
  zoomOut: () => void
  resetZoom: () => void
  setShortcutsOpen: (open: boolean) => void
  toggleChatTree: () => void
  toggleWorkspacePanel: () => void
  setWorkspacePanelTab: (tab: WorkspacePanelTab) => void
  /** v4.1: open/close the declared Sources/Outputs editor from the rail. */
  setSourcesPanelOpen: (open: boolean) => void
  toggleTerminal: () => void
  runTerminalCommand: (command: string) => Promise<void>
  setSearchOpen: (open: boolean) => void
  runCodeSearch: (query: string) => Promise<void>

  init: () => Promise<void>
  openSettings: () => void
  /**
   * v4.0: open Settings **on a named tab**. `openSettings` alone was enough while every entry
   * point was a generic "Settings" button; a row that says "Configure … in Connections" has to
   * arrive there, or the label is a promise the interface does not keep.
   */
  openSettingsTab: (tab: string) => void
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
  /**
   * v2.9.0: `attachments` are opaque ids registered through
   * `window.api.attachments.register`. Main resolves them, stages the bytes into the
   * run's workspace and tells the model where they are — the renderer never reads the
   * file and never sends a desktop path.
   */
  send: (text: string, attachments?: string[]) => Promise<void>
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
