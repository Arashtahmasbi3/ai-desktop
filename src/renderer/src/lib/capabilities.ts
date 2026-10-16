import { readPrefs, writePrefs } from './prefs'

/**
 * Optional UI *surfaces*, as real persisted state (v4.0).
 *
 * The old Settings → Plugins page rendered a switch for all seven catalogue entries and
 * persisted them under `plugins.enabled` — a key **nothing else in the app ever read**. Every
 * switch on that page therefore reported a state change that gated nothing, which is worse than
 * a missing feature: it is a page that lies. The honest split is between things that really are
 * optional (a surface that can legitimately be hidden) and things that are configured somewhere
 * else entirely (a provider, a connection, an integration).
 *
 * This module owns the first half only, and is deliberately tiny and dependency-free — just
 * `readPrefs`/`writePrefs` over `localStorage` — so it is trivially testable and so consumers
 * (`Sidebar`, `ChatPanel`, a settings row) never have to agree on a storage format.
 *
 * Two decisions worth keeping:
 *
 *  1. **The default is enabled.** `isCapabilityEnabled` returns `true` for an unknown id, for a
 *     missing entry and for unreadable storage. A user who upgrades must not lose a surface
 *     because a preference they never made reads as "off".
 *  2. **The key is versioned and new** (`capabilities.enabled`, not `plugins.enabled`). The old
 *     map was written by switches that meant nothing, so its values are not beliefs the user
 *     holds about these surfaces; reusing the key would resurrect a stale `false` for a row that
 *     used to be a lie. A fresh key means "unset" — i.e. on.
 */

export type CapabilityId = 'browser' | 'terminal' | 'filesystem'

export interface OptionalCapability {
  id: CapabilityId
  /** i18n key for the surface's name. */
  labelKey: string
  /** i18n key for the one-line explanation of what hiding it does. */
  descriptionKey: string
}

/**
 * Exactly the three catalogue entries that correspond to a surface already built into the app.
 * Anything not in this list is **not** an on/off surface and must not be given a switch.
 */
export const OPTIONAL_CAPABILITIES: readonly OptionalCapability[] = [
  { id: 'browser', labelKey: 'capabilities.browser', descriptionKey: 'capabilities.browserHint' },
  {
    id: 'terminal',
    labelKey: 'capabilities.terminal',
    descriptionKey: 'capabilities.terminalHint'
  },
  {
    id: 'filesystem',
    labelKey: 'capabilities.filesystem',
    descriptionKey: 'capabilities.filesystemHint'
  }
]

/** The persisted key. Versioned by name so the dead `plugins.enabled` map can never be read. */
const CAPABILITIES_KEY = 'capabilities.enabled'

/** Absent, unparsable or wrongly-typed stored state must never disable a surface. */
function readMap(): Partial<Record<string, boolean>> {
  const stored = readPrefs<unknown>(CAPABILITIES_KEY, {})
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return {}
  return stored as Partial<Record<string, boolean>>
}

/**
 * Whether an optional surface should be shown. Defaults to **true**, so an existing user loses
 * nothing; a capability is only off when it was explicitly turned off.
 */
export function isCapabilityEnabled(id: CapabilityId): boolean {
  return readMap()[id] === false ? false : true
}

/** Persist one capability, preserving the others. A no-op on storage failure (see `writePrefs`). */
export function setCapabilityEnabled(id: CapabilityId, enabled: boolean): void {
  writePrefs(CAPABILITIES_KEY, { ...readMap(), [id]: enabled })
}
