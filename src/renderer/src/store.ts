import { create } from 'zustand'
import type { AgentLogEntry } from '@shared/agent'
import type { LoopWarning } from '@shared/agent'
import type { ProviderId } from '@shared/types'
import type {
  AgentEvent,
  FileEntry,
  RemoteStatus,
  SessionInfo,
  SettingsView,
  WorkerJobRequest,
  WorkerStatus
} from '@shared/ui'

export type ViewId = 'chat' | 'tasks' | 'files'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  at: number
}

const MAX_LOGS = 500

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Math.random().toString(36).slice(2)}`
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

  init: () => Promise<void>
  openSettings: () => void
  closeSettings: () => void
  setView: (view: ViewId) => void
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
  removeProject: (id: string) => Promise<void>
  openProject: (id: string) => Promise<void>
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

  async init() {
    try {
      const [settings, worker, remote] = await Promise.all([
        window.api.settings.get(),
        window.api.worker.status(),
        window.api.remote.status()
      ])
      set({ settings, worker, remote, ready: true })
      await get().refreshFiles()
      await get().refreshSessions()
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error), ready: true })
    }
  },

  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  setView: (view) => set({ view }),

  applyEvent(event) {
    switch (event.type) {
      case 'run:start':
        set({ running: true, currentRunId: event.runId, error: null })
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
        if (text) {
          messages.push({ id: newId(), role: 'assistant', content: text, at: event.at })
        }
        set({
          running: false,
          currentRunId: null,
          warnings: event.warnings,
          messages
        })
        void get().refreshSessions()
        break
      }
      case 'error':
        set({
          running: false,
          currentRunId: null,
          error: event.message,
          messages: [
            ...get().messages,
            { id: newId(), role: 'system', content: `Error: ${event.message}`, at: Date.now() }
          ]
        })
        break
    }
  },

  async send(text) {
    const trimmed = text.trim()
    if (!trimmed || get().running) return
    set({
      messages: [...get().messages, { id: newId(), role: 'user', content: trimmed, at: Date.now() }],
      running: true,
      error: null
    })
    try {
      await window.api.agent.run({ task: trimmed, sessionId: get().sessionId })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set({ running: false, error: message })
    }
  },

  abort() {
    void window.api.agent.abort()
  },

  newSession() {
    set({
      sessionId: newId(),
      messages: [],
      logs: [],
      warnings: [],
      running: false,
      currentRunId: null,
      error: null
    })
  },

  async loadSession(id) {
    const record = await window.api.agent.loadSession(id)
    if (!record) return
    set({
      sessionId: record.id,
      messages: record.messages
        .filter((message) => message.role === 'user' || message.role === 'assistant')
        .map((message) => ({
          id: newId(),
          role: message.role as 'user' | 'assistant',
          content: typeof message.content === 'string' ? message.content : '',
          at: Date.now()
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
      set({ entries, cwd: target })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // No project selected yet is a normal first-run state, not an error.
      set(/No active project/i.test(message) ? { entries: [] } : { entries: [], error: message })
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

  async removeProject(id) {
    set({ settings: await window.api.settings.removeProject(id) })
    set({ entries: [], selectedFile: null, cwd: '.' })
  },

  async openProject(id) {
    set({ settings: await window.api.projects.open(id) })
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
