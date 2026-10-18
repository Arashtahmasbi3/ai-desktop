import i18n from '../i18n'
import type { StoredMessage } from '@shared/chat'
import { resolveSelection } from '@shared/selection'
import { newId, startAutosave } from './helpers'
import type { StoreSet, StoreGet } from './helpers'
import { readLastChatId, rememberChatId } from './prefs'
import type { AppState } from './types'

export function sessionActions(
  set: StoreSet,
  get: StoreGet
): Pick<
  AppState,
  | 'refreshChats'
  | 'persistChat'
  | 'renameChat'
  | 'deleteChat'
  | 'duplicateChat'
  | 'forkChat'
  | 'init'
  | 'newSession'
  | 'compactContext'
  | 'loadSession'
  | 'refreshSessions'
  | 'refreshMemory'
  | 'clearMemory'
  | 'refreshFiles'
  | 'openFile'
  | 'setDraft'
  | 'discardDraft'
  | 'saveFile'
> {
  return {
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
        // v3.0: a declared output belongs to the run it was declared for, so a new
        // chat starts with an empty Sources/Outputs panel.
        runOutputs: [],
        runSources: [],
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
  }
}
