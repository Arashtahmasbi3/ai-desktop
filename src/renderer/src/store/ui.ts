import i18n from '../i18n'
import { redact } from '@core/agent/redact'
import type { Job } from '@shared/jobs'
import type { Locale } from '../i18n/locale'
import { applyTheme, storeTheme } from '../lib/theme'
import { setUiMode as persistUiMode } from '../lib/ui-mode'
import { newId } from './helpers'
import type { StoreSet, StoreGet } from './helpers'
import {
  CONTEXT_SETTINGS_KEY,
  RAW_TOOL_ROWS_KEY,
  CONTEXT_WARNING_KEY,
  SIDEBAR_PIN_KEY,
  JOBS_PANEL_KEY,
  ZOOM_KEY,
  ZOOM_STEP,
  writeChatTreeOpen,
  clampZoom
} from './prefs'
import type { TerminalLineKind, AppState } from './types'

const MAX_TERMINAL_LINES = 500

const jobStatuses = new Map<string, Job['status']>()

/** Switch the active language (kept here so the store is the single entry point). */
async function i18nChangeLanguage(locale: Locale): Promise<void> {
  await i18n.changeLanguage(locale)
}

export function uiActions(
  set: StoreSet,
  get: StoreGet
): Pick<
  AppState,
  | 'setLocale'
  | 'toggleSidebar'
  | 'setSidebarPinned'
  | 'dismissPreflight'
  | 'setTheme'
  | 'setShowContextBeforeSend'
  | 'toggleTerminal'
  | 'setSearchOpen'
  | 'runCodeSearch'
  | 'runTerminalCommand'
  | 'toggleChatTree'
  | 'toggleWorkspacePanel'
  | 'setWorkspacePanelTab'
  | 'setSourcesPanelOpen'
  | 'addRunOutput'
  | 'removeRunOutput'
  | 'addRunSource'
  | 'removeRunSource'
  | 'pushToast'
  | 'dismissToast'
  | 'setPaletteOpen'
  | 'refreshJobs'
  | 'setJobsPanelOpen'
  | 'setShowJobsPanelAlways'
  | 'setShowRawToolRows'
  | 'setShowContextWarning'
  | 'setUiMode'
  | 'applyZoom'
  | 'zoomIn'
  | 'zoomOut'
  | 'resetZoom'
  | 'setShortcutsOpen'
  | 'setView'
  | 'clearError'
> {
  return {
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

    /*
     * Checklist item 13: the terminal is an advanced surface. The guard lives here rather than at
     * each caller (the header button, the keyboard shortcuts, Settings → Connections) so no path
     * can open a pane that simple mode does not offer.
     */
    toggleTerminal: () => {
      if (get().uiMode !== 'advanced') return
      set({ terminalOpen: !get().terminalOpen })
    },

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
      // Checklist item 13: same guard as the terminal — the tree is an advanced pane.
      if (get().uiMode !== 'advanced') return
      const value = !get().chatTreeOpen
      set({ chatTreeOpen: value })
      writeChatTreeOpen(value)
    },

    toggleWorkspacePanel: () => set({ workspacePanelOpen: !get().workspacePanelOpen }),

    setWorkspacePanelTab: (tab) => set({ workspacePanelTab: tab, workspacePanelOpen: true }),

    setSourcesPanelOpen: (open) => set({ sourcesPanelOpen: open }),

    /**
     * v3.0: the composer's Sources/Outputs declarations. `send` reads them back and
     * appends `buildRunIntentBlock` to the task; nothing else consumes them.
     */
    addRunOutput(kind, target) {
      const trimmed = target?.trim()
      set({
        runOutputs: [
          ...get().runOutputs,
          { id: newId(), kind, ...(trimmed ? { target: trimmed } : {}) }
        ]
      })
    },

    removeRunOutput(id) {
      set({ runOutputs: get().runOutputs.filter((output) => output.id !== id) })
    },

    addRunSource(value) {
      const trimmed = String(value ?? '').trim()
      if (!trimmed) return
      set({ runSources: [...get().runSources, { id: newId(), kind: 'folder', value: trimmed }] })
    },

    removeRunSource(id) {
      set({ runSources: get().runSources.filter((source) => source.id !== id) })
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

    /**
     * Checklist item 13: switch between the calm and the full interface.
     *
     * Persist through `lib/ui-mode` (the single source the rest of the app reads) and close the
     * panes simple mode does not offer. Closing the tree also writes its own flag off, so a restart
     * in simple mode does not reopen what the mode has just hidden.
     */
    setUiMode(mode) {
      persistUiMode(mode)
      if (mode === 'simple') {
        set({ uiMode: mode, chatTreeOpen: false, terminalOpen: false })
        writeChatTreeOpen(false)
        return
      }
      set({ uiMode: mode })
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

    setView: (view) => set({ view }),

    clearError: () => set({ error: null }),
  }
}
