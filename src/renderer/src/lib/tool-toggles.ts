import { ALL_TOOL_TOGGLE_IDS } from '@shared/tool-toggles'
import { readPrefs, writePrefs } from './prefs'

const KEY = 'enabled-tools'

/** Enabled tool-group ids. Defaults to all groups when nothing is stored. */
export function readEnabledTools(): string[] {
  const saved = readPrefs<string[] | null>(KEY, null)
  if (!Array.isArray(saved)) return [...ALL_TOOL_TOGGLE_IDS]
  return saved.filter((id): id is string => typeof id === 'string')
}

export function writeEnabledTools(ids: string[]): void {
  writePrefs(KEY, ids)
}

/** Add or remove a group id from the enabled list. */
export function toggleTool(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id]
}
