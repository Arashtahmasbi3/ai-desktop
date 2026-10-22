import i18n from '../i18n'
import { DEFAULT_SELECTION } from '@shared/selection'
import {
  isConversationActive,
  planChatTransfer,
  writeChatTransferPreference
} from '../lib/chat-transfer'
import { appendUsage, saveUsage } from '../lib/usage'
import type { UsageRecord } from '../lib/usage'
import { VPS_RECONNECT_KEY } from '../lib/vps-state'
import type { VpsConnectionState } from '@shared/vps'
import { newId, basename } from './helpers'
import type { StoreSet, StoreGet } from './helpers'
import { rememberChatId } from './prefs'
import type { AppState } from './types'

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
    // v2.8.0: the "what changed" summary is project-scoped, like the diffs it describes.
    changedFiles: [],
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
    memory: null,
    // v2.8.0: "what changed" belongs to the chat that saw the change.
    changedFiles: [],
    reasoningByStep: {}
  }
}

/**
 * R5: seed the per-server map from the connected set without ever overwriting a fact.
 *
 * `vpsStates` is the source of truth for "which servers are connected"; the set main reports is
 * only a seed for a server that has not had a liveness event yet (right after a restart, or
 * before its first transition). A known entry always wins, so an error or a disconnect is never
 * repainted as connected by a refresh.
 */
function seedConnectedStates(
  states: Record<string, VpsConnectionState>,
  connected: readonly string[]
): Record<string, VpsConnectionState> {
  const seeded = { ...states }
  for (const id of connected) {
    if (seeded[id] === undefined) seeded[id] = { status: 'connected', serverId: id }
  }
  return seeded
}

export function settingsActions(
  set: StoreSet,
  get: StoreGet
): Pick<
  AppState,
  | 'recordUsage'
  | 'resetUsage'
  | 'setVpsServerId'
  | 'refreshDiagnostic'
  | 'setDiagnosticMode'
  | 'refreshVps'
  | 'refreshVpsConnected'
  | 'ensureVpsConnected'
  | 'connectVps'
  | 'connectVpsInPlace'
  | 'disconnectVps'
  | 'setVpsStatus'
  | 'applyVpsLiveness'
  | 'openSettings'
  | 'openSettingsTab'
  | 'closeSettings'
  | 'closeMigration'
  | 'setSelection'
  | 'refreshCustomProviders'
  | 'saveCustomProvider'
  | 'removeCustomProvider'
  | 'testCustomProvider'
  | 'completeOnboarding'
  | 'refreshGoals'
  | 'createGoal'
  | 'updateGoalTitle'
  | 'toggleGoalCriterion'
  | 'setActiveGoal'
  | 'achieveGoal'
  | 'abandonGoal'
  | 'removeGoal'
  | 'submitJob'
  | 'cancelJob'
  | 'setOnline'
  | 'toggleRemote'
  | 'addProject'
  | 'addRemoteProject'
  | 'prefillAddProject'
  | 'clearProjectPrefill'
  | 'searchVpsProject'
  | 'removeProject'
  | 'openProject'
  | 'switchProject'
  | 'startChatInProject'
  | 'completeProjectSwitch'
  | 'cancelProjectSwitch'
  | 'setChatTransferPreference'
  | 'updateProjectPath'
  | 'updateProjectMetadata'
  | 'setApiKey'
  | 'removeApiKey'
  | 'setModel'
  | 'setActiveProvider'
> {
  return {
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
        set({
          vpsServers: servers,
          vpsStatus: status,
          vpsConnected: connected,
          vpsStates: seedConnectedStates(get().vpsStates, connected)
        })
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
     *
     * R7: it asks main for an **automatic** connect. This pass runs every 30 seconds for every open
     * remote project, so it is the request that used to reopen a server the user had just
     * disconnected. Main refuses while that decision stands, and the state that comes back says so.
     */
    async ensureVpsConnected(serverId) {
      if (get().vpsConnected.includes(serverId)) return
      try {
        const status = await window.api.vps.connect(serverId, 'automatic')
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

    /** A click on Connect, in place: manual, so it may reopen a user-disconnected server. */
    async connectVpsInPlace(serverId) {
      get().setVpsStatus({ status: 'connecting', serverId })
      try {
        const status = await window.api.vps.connect(serverId, 'manual')
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

    async connectVps(serverId) {
      // Select first so the status that comes back is treated as the *selected*
      // server's (v2.6.5), then let setVpsStatus route it.
      set({ vpsServerId: serverId })
      await get().connectVpsInPlace(serverId)
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

    /**
     * R1: apply one per-server liveness transition, in the same tick it arrives.
     *
     * The event names the server, so no surface has to guess from the singular slot which server
     * changed. `vpsStatus` is still written for the one release it has left (see the deprecated
     * field in `types.ts`); nothing new may read it.
     */
    applyVpsLiveness: (event) =>
      get().setVpsStatus({ ...event.state, serverId: event.serverId }),

    openSettings: () => set({ settingsOpen: true, settingsTab: null }),

    openSettingsTab: (tab) => set({ settingsOpen: true, settingsTab: tab }),

    closeSettings: () => set({ settingsOpen: false }),

    closeMigration: () => set({ migrationOpen: false }),

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
      // A pre-filled path has now become a project, so the suggestion is spent.
      set({ projectPrefill: null })
      await get().refreshFiles('.')
      await get().refreshGoals()
    },

    async addRemoteProject(name, path, vpsId) {
      set({ settings: await window.api.settings.addRemoteProject(name || basename(path), path, vpsId) })
      set({ projectPrefill: null })
      // The new project is the active one, so the surfaces bound to it are re-read here rather than
      // showing the previous project's tree until something else happens to refresh them.
      await get().refreshFiles('.')
      await get().refreshGoals()
    },

    /**
     * S3.3: "add this path as a project" — one click from a refusal.
     *
     * Deliberately a *navigation*, not an action: it opens Settings → Projects on the add form with
     * the path and server filled in, and the user still has to press Add. The agent never gets a
     * new root without a person choosing it.
     */
    prefillAddProject(input) {
      set({
        projectPrefill: {
          path: input.path,
          at: Date.now(),
          ...(input.vpsId ? { vpsId: input.vpsId } : {}),
          ...(input.name ? { name: input.name } : {})
        },
        settingsOpen: true,
        settingsTab: 'projects'
      })
    },

    clearProjectPrefill: () => set({ projectPrefill: null }),

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
  }
}
