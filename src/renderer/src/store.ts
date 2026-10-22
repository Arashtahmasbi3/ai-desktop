import { create } from 'zustand'
import { DEFAULT_SELECTION } from '@shared/selection'
import { detectLocale } from './i18n/locale'
import { readChatTransferPreference } from './lib/chat-transfer'
import { readStoredTheme } from './lib/theme'
import { getUiMode } from './lib/ui-mode'
import { loadUsage } from './lib/usage'
import { newId } from './store/helpers'
import {
  readShowContextBeforeSend,
  readChatTreeOpen,
  readShowJobsPanelAlways,
  readShowRawToolRows,
  readSidebarPinned,
  readShowContextWarning,
  readZoomLevel
} from './store/prefs'
import type { AppState } from './store/types'

import { sessionActions } from './store/session'
import { runActions } from './store/run'
import { settingsActions } from './store/settings'
import { approvalActions } from './store/approvals'
import { uiActions } from './store/ui'

/**
 * The renderer store. One `create()` call composes the state slices; the actions
 * live in `store/*.ts` grouped by concern. This file stays the public entry, so
 * every `import { useStore } from '../store'` keeps working unchanged.
 */
export const useStore = create<AppState>((set, get) => ({
  ready: false,
  settings: null,
  settingsOpen: false,
  /** A tab for Settings to open on, consumed and cleared by SettingsPanel. */
  settingsTab: null as string | null,
  /** S3.3: what Settings → Projects opens pre-filled with, set only by an explicit click. */
  projectPrefill: null,
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
  pendingQuestion: null,
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
  // v2.8.0: every file the agent changed in this chat, with its diffstat.
  changedFiles: [],
  reasoningByStep: {},
  toasts: [],
  // Checklist item 13: the tree is an advanced pane. A persisted "open" must not resurrect it in
  // simple mode — the mode wins at startup, not the stale preference.
  chatTreeOpen: getUiMode() === 'advanced' && readChatTreeOpen(),
  workspacePanelOpen: true,
  workspacePanelTab: 'output',
  sourcesPanelOpen: false,
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
  // Checklist item 13: the calm default. `getUiMode` is the persisted value (simple unless the
  // user chose advanced).
  uiMode: getUiMode(),
  runOutputs: [],
  runSources: [],
  zoomLevel: readZoomLevel(),
  shortcutsOpen: false,

  ...sessionActions(set, get),
  ...runActions(set, get),
  ...settingsActions(set, get),
  ...approvalActions(set, get),
  ...uiActions(set, get),
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
  /*
   * R1: the per-server liveness event. It is applied synchronously, before the async refresh
   * above can answer, so the header dot, the banner and the tree dot read the new fact in the
   * same tick.
   */
  const offVpsLiveness = window.api.events.on('vps:liveness', (event) => {
    useStore.getState().applyVpsLiveness(event)
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
    offVpsLiveness()
    offDiagnostic()
    offGoals()
    unsubscribe = null
  }
}

export type {
  ViewId,
  WorkspacePanelTab,
  ToastKind,
  Toast,
  TerminalLineKind,
  TerminalLine,
  ChatMessage,
  ChangedFile
} from './store/types'
export {
  CONTEXT_SETTINGS_KEY,
  readShowContextBeforeSend,
  readShowJobsPanelAlways,
  readShowRawToolRows,
  readSidebarPinned,
  readShowContextWarning,
  readZoomLevel
} from './store/prefs'
export { basename } from './store/helpers'
