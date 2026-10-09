import { create } from 'zustand'
import type { AgentLogEntry } from '@shared/agent'
import type { LoopWarning } from '@shared/agent'
import type {
  CustomProviderInput,
  CustomProviderTestResult,
  CustomProviderView,
  ProviderId
} from '@shared/types'
import { DEFAULT_SELECTION, resolveSelection } from '@shared/selection'
import type { ApprovalMode } from '@shared/approval'
import type { OnboardingStatus } from '@shared/onboarding'
import type { ChatSummary, StoredMessage } from '@shared/chat'
import type { Locale } from './i18n/locale'
import { detectLocale } from './i18n/locale'
import i18n from './i18n'
import type {
  AgentEvent,
  ApprovalRequest,
  FileEntry,
  ModelSelection,
  RemoteStatus,
  SessionInfo,
  SettingsView,
  WorkerJobRequest,
  WorkerStatus
} from '@shared/ui'

export type ViewId = 'chat' | 'tasks' | 'files' | 'browser' | 'github' | 'vps'

export type ToastKind = 'success' | 'error' | 'warning'

export interface Toast {
  id: string
  kind: ToastKind
  message: string
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
}

const MAX_LOGS = 500
const TOKEN_SETTINGS_KEY = 'ai-desktop:show-token-count'

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Math.random().toString(36).slice(2)}`
}

function readShowTokenCount(): boolean {
  try {
    return globalThis.localStorage?.getItem(TOKEN_SETTINGS_KEY) !== '0'
  } catch {
    return true
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
  warnings: LoopWarning[]
  sessions: SessionInfo[]

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

  /** Interface language (drives dir + all t() text). */
  locale: Locale
  /** Collapsed state of the left sidebar. */
  sidebarCollapsed: boolean
  /** Whether the token estimate is shown under the chat input. */
  showTokenCount: boolean
  /** Saved chats for the sidebar list. */
  chats: ChatSummary[]
  /** Currently open chat id (created lazily on first message). */
  activeChatId: string | null
  /** Connected VPS selected for remote_shell in this chat. */
  vpsServerId: string | undefined
  /** Plan Mode: the agent drafts a plan without running tools. */
  planMode: boolean
  /** Tool call awaiting the user's approval, if any. */
  pendingApproval: ApprovalRequest | null
  /** Transient toast notifications. */
  toasts: Toast[]
  /** Command palette visibility. */
  paletteOpen: boolean

  setLocale: (locale: Locale) => void
  toggleSidebar: () => void
  setShowTokenCount: (value: boolean) => void
  refreshChats: () => Promise<void>
  /** Save the current messages/model/vps as the active chat. */
  persistChat: () => Promise<void>
  renameChat: (id: string, title: string) => Promise<void>
  deleteChat: (id: string) => Promise<void>
  setVpsServerId: (id: string | undefined) => void
  setPlanMode: (value: boolean) => void
  setApprovalMode: (mode: ApprovalMode) => Promise<void>
  setPlanModeDefault: (value: boolean) => Promise<void>
  respondApproval: (approved: boolean) => void
  pushToast: (kind: ToastKind, message: string) => void
  dismissToast: (id: string) => void
  setPaletteOpen: (open: boolean) => void

  init: () => Promise<void>
  openSettings: () => void
  closeSettings: () => void
  setView: (view: ViewId) => void
  setSelection: (patch: Partial<ModelSelection>) => void
  refreshCustomProviders: () => Promise<void>
  saveCustomProvider: (input: CustomProviderInput) => Promise<CustomProviderView>
  removeCustomProvider: (id: string) => Promise<void>
  testCustomProvider: (input: CustomProviderInput) => Promise<CustomProviderTestResult>
  completeOnboarding: () => Promise<void>
  applyEvent: (event: AgentEvent) => void
  send: (text: string) => Promise<void>
  abort: () => void
  newSession: () => void
  loadSession: (id: string) => Promise<void>
  refreshSessions: () => Promise<void>

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
  updateProjectPath: (id: string, path: string) => Promise<void>
  searchVpsProject: (name: string) => Promise<string[]>
  setApiKey: (provider: ProviderId, apiKey: string) => Promise<void>
  removeApiKey: (provider: ProviderId) => Promise<void>
  setModel: (provider: ProviderId, model: string) => Promise<void>
  setActiveProvider: (provider: ProviderId) => Promise<void>

  clearError: () => void
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
  warnings: [],
  sessions: [],

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

  locale: detectLocale(),
  sidebarCollapsed: false,
  showTokenCount: readShowTokenCount(),
  chats: [],
  activeChatId: null,
  vpsServerId: undefined,
  planMode: false,
  pendingApproval: null,
  toasts: [],
  paletteOpen: false,

  setLocale(locale) {
    set({ locale })
    void i18nChangeLanguage(locale)
  },
  toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
  setShowTokenCount(value) {
    set({ showTokenCount: value })
    try {
      globalThis.localStorage?.setItem(TOKEN_SETTINGS_KEY, value ? '1' : '0')
    } catch {
      // Persisting the preference is best-effort.
    }
  },
  setVpsServerId: (id) => set({ vpsServerId: id }),
  setPlanMode: (value) => set({ planMode: value }),
  async setApprovalMode(mode) {
    set({ settings: await window.api.settings.setApprovalMode(mode) })
  },
  async setPlanModeDefault(value) {
    set({ settings: await window.api.settings.setPlanModeDefault(value) })
  },
  respondApproval(approved) {
    const pending = get().pendingApproval
    if (!pending) return
    set({ pendingApproval: null })
    void window.api.agent.respondApproval(pending.id, approved)
  },
  pushToast(kind, message) {
    const id = newId()
    set({ toasts: [...get().toasts, { id, kind, message }] })
    const ttl = kind === 'error' ? 5000 : 3000
    setTimeout(() => get().dismissToast(id), ttl)
  },
  dismissToast(id) {
    set({ toasts: get().toasts.filter((toast) => toast.id !== id) })
  },
  setPaletteOpen: (open) => set({ paletteOpen: open }),

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
      set({ activeChatId: null, messages: [], logs: [], warnings: [] })
    }
    await get().refreshChats()
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
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error), ready: true })
    }
  },

  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
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
        set({ running: true, currentRunId: event.runId, error: null, logs: [], pendingApproval: null })
        break
      case 'approval:request':
        set({ pendingApproval: event.request })
        break
      case 'log': {
        const logs = [...get().logs, event.entry]
        if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS)
        set({ logs })
        const entry = event.entry
        if (entry.event === 'action.ok' || entry.event === 'action.error') {
          const tool = String(entry.tool ?? 'tool')
          const code = entry.code !== undefined ? ` (${String(entry.code)})` : ''
          set({
            messages: [
              ...get().messages,
              {
                id: newId(),
                role: 'tool',
                content: `${tool}${code}`,
                at: Date.now()
              }
            ]
          })
        }
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
            ...(event.model ? { model: event.model } : {}),
            ...(usedRemote ? { usedRemote: true } : {})
          })
        }
        set({
          running: false,
          currentRunId: null,
          warnings: event.warnings,
          pendingApproval: null,
          messages
        })
        void get().persistChat()
        void get().refreshSessions()
        break
      }
      case 'error':
        set({
          running: false,
          currentRunId: null,
          pendingApproval: null,
          error: event.message,
          messages: [
            ...get().messages,
            { id: newId(), role: 'system', content: `Error: ${event.message}`, at: Date.now() }
          ]
        })
        get().pushToast('error', event.message)
        break
    }
  },

  async send(text) {
    const trimmed = text.trim()
    if (!trimmed || get().running) return
    const selection = get().selection
    set({
      messages: [...get().messages, { id: newId(), role: 'user', content: trimmed, at: Date.now() }],
      running: true,
      error: null
    })
    void get().persistChat()
    try {
      await window.api.agent.run({
        task: trimmed,
        sessionId: get().activeChatId ?? get().sessionId,
        provider: selection.provider,
        model: selection.model,
        ...(selection.customProviderId ? { customProviderId: selection.customProviderId } : {}),
        ...(get().vpsServerId ? { vpsServerId: get().vpsServerId } : {}),
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
    set({
      sessionId: newId(),
      activeChatId: null,
      messages: [],
      logs: [],
      warnings: [],
      running: false,
      currentRunId: null,
      error: null,
      view: 'chat'
    })
  },

  async loadSession(id) {
    const record = await window.api.chats.load(id)
    if (!record) return
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
      warnings: [],
      view: 'chat'
    })
  },

  async refreshSessions() {
    try {
      set({ sessions: await window.api.agent.sessions() })
    } catch {
      // Sessions are best-effort.
    }
  },

  async refreshFiles(path) {
    const target = path ?? get().cwd
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
    set({ entries: [], selectedFile: null, cwd: '.' })
  },

  async openProject(id) {
    set({ settings: await window.api.projects.open(id) })
    await get().refreshFiles('.')
  },

  async updateProjectPath(id, path) {
    set({ settings: await window.api.settings.updateProjectPath(id, path) })
    await get().refreshFiles('.')
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

  clearError: () => set({ error: null })
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
  unsubscribe = () => {
    offAgent()
    offWorker()
    offRemote()
    offSettings()
    offFiles()
    unsubscribe = null
  }
}

export { basename }
