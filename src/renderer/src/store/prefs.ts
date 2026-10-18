export const CONTEXT_SETTINGS_KEY = 'ai-desktop:show-context-before-send'
const CHAT_TREE_KEY = 'ai-desktop:chat-tree-open'
export const RAW_TOOL_ROWS_KEY = 'ai-desktop:show-raw-tool-rows'
export const CONTEXT_WARNING_KEY = 'ai-desktop:show-context-warning'
export const SIDEBAR_PIN_KEY = 'ai-desktop:sidebar-pinned'
export const JOBS_PANEL_KEY = 'ai-desktop:show-jobs-panel'
export const ZOOM_KEY = 'ai-desktop:zoom-level'
/** Electron zoom-level step per keyboard press (v2.6.2 T5.3). */
export const ZOOM_STEP = 0.5
const ZOOM_MIN = -3
const ZOOM_MAX = 3
const LAST_CHAT_KEY = 'ai-desktop:last-chat'


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

export function readChatTreeOpen(): boolean {
  try {
    return globalThis.localStorage?.getItem(CHAT_TREE_KEY) === '1'
  } catch {
    return false
  }
}

/** Persist the tree toggle, so switching to simple mode cannot be undone by a restart. */
export function writeChatTreeOpen(value: boolean): void {
  try {
    globalThis.localStorage?.setItem(CHAT_TREE_KEY, value ? '1' : '0')
  } catch {
    // Persisting the preference is best-effort.
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

/** Clamp + read the persisted zoom level (Electron units; 0 == 100%). */
export function clampZoom(level: number): number {
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

export function readLastChatId(): string | null {
  try {
    return globalThis.localStorage?.getItem(LAST_CHAT_KEY)
  } catch {
    return null
  }
}

export function rememberChatId(id: string): void {
  try {
    globalThis.localStorage?.setItem(LAST_CHAT_KEY, id)
  } catch {
    // Best-effort: forgetting the last chat only skips restore.
  }
}

