import { readPrefs, writePrefs } from './prefs'

/**
 * Interface mode (checklist item 13).
 *
 * The app has grown enough surfaces that its default should be the calm one: the conversation,
 * its composer and the controls that decide what a run may do. The local terminal, the chat file
 * tree and the model's raw reasoning are genuinely useful while working hands-on or debugging,
 * but they are **advanced** instruments — they should rest until the user asks for them instead
 * of crowding the first screen.
 *
 * This follows the `capabilities` module exactly, because the two are the same kind of state:
 *
 *  1. **The default is `simple`.** `getUiMode` answers `simple` for a missing entry, an unknown
 *     value and unreadable storage, so a fresh install starts calm and an upgraded user does not
 *     lose the simple experience to a preference they never made.
 *  2. **The key is versioned and new** (`ui.mode`), so an unrelated stored value can never be
 *     misread as a mode.
 *
 * The reactive copy lives in the store (`useStore((state) => state.uiMode)`), which mirrors this
 * module the way it already mirrors `lib/theme`; this file owns the persisted value only, and the
 * store is what components subscribe to.
 */

export const UI_MODES = ['simple', 'advanced'] as const
export type UiMode = (typeof UI_MODES)[number]

/** Simple is the default: the advanced panes rest until asked for. */
export const DEFAULT_UI_MODE: UiMode = 'simple'

/** The persisted key. */
const UI_MODE_KEY = 'ui.mode'

export function isUiMode(value: unknown): value is UiMode {
  return typeof value === 'string' && (UI_MODES as readonly string[]).includes(value)
}

/** Read the saved mode. Absent, unparsable or unknown state means `simple`. */
export function getUiMode(): UiMode {
  const stored = readPrefs<unknown>(UI_MODE_KEY, DEFAULT_UI_MODE)
  return isUiMode(stored) ? stored : DEFAULT_UI_MODE
}

/** Persist the mode. A no-op on storage failure (see `writePrefs`). */
export function setUiMode(mode: UiMode): void {
  writePrefs(UI_MODE_KEY, mode)
}

/** i18n key for one mode's own label (`Simple` / `Advanced`), matching `themeLabelKey`. */
export function uiModeLabelKey(mode: UiMode): string {
  return `statusBar.uiMode${mode.charAt(0).toUpperCase()}${mode.slice(1)}`
}
