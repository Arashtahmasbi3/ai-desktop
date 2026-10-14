/**
 * U-15: which surface the global Escape key closes.
 *
 * The chain in `App.tsx` used to jump straight from the search modal to
 * `clearError()`, so Escape while the file tree, the terminal, the project-switch
 * prompt, the jobs panel or the migration dialog was open silently dismissed the
 * red error strip instead (or did nothing at all). The order below is the
 * stacking order: the topmost open surface wins, and the error strip is last.
 *
 * `pendingApproval` and `pendingPreflight` are deliberately absent — a security
 * gate is answered with an explicit button (U-14), and the dialogs that do have a
 * close action consume Escape themselves while they are mounted (U-2).
 */

export interface EscapeSurfaces {
  searchOpen: boolean
  paletteOpen: boolean
  pendingProjectSwitch: string | null
  shortcutsOpen: boolean
  settingsOpen: boolean
  migrationOpen: boolean
  jobsPanelOpen: boolean
  chatTreeOpen: boolean
  terminalOpen: boolean
  error: string | null
}

export type EscapeTarget =
  | 'search'
  | 'palette'
  | 'projectSwitch'
  | 'shortcuts'
  | 'settings'
  | 'migration'
  | 'jobs'
  | 'tree'
  | 'terminal'
  | 'error'
  | null

/** The single surface Escape should close, or null when nothing is open. */
export function topmostEscapeTarget(state: EscapeSurfaces): EscapeTarget {
  if (state.searchOpen) return 'search'
  if (state.paletteOpen) return 'palette'
  if (state.pendingProjectSwitch) return 'projectSwitch'
  if (state.shortcutsOpen) return 'shortcuts'
  if (state.settingsOpen) return 'settings'
  if (state.migrationOpen) return 'migration'
  if (state.jobsPanelOpen) return 'jobs'
  if (state.chatTreeOpen) return 'tree'
  if (state.terminalOpen) return 'terminal'
  if (state.error) return 'error'
  return null
}
