import type { ApprovalMode } from './approval'
import type { SessionProfile } from './profile'

/**
 * Permission presets (T19).
 *
 * The app already has the two mechanisms a user needs — a session profile (which decides whether a run may write) and an
 * approval mode (which decides whether it asks) — but they are configured in two different places, so "read-only",
 * "standard" and "auto" are three combinations a user cannot name. A preset is exactly that name: it writes both
 * settings together, which is a real feature built on what exists rather than a fourth policy layer.
 */
export type PermissionPresetId = 'read-only' | 'standard' | 'auto'

export interface PermissionPreset {
  id: PermissionPresetId
  profile: SessionProfile
  approvalMode: ApprovalMode
}

export const PERMISSION_PRESETS: readonly PermissionPreset[] = [
  { id: 'read-only', profile: 'investigate', approvalMode: 'ask' },
  { id: 'standard', profile: 'develop', approvalMode: 'ask' },
  { id: 'auto', profile: 'develop', approvalMode: 'auto-write' }
]

export function resolvePermissionPreset(id: string | undefined): PermissionPreset | null {
  if (!id) return null
  return PERMISSION_PRESETS.find((preset) => preset.id === id) ?? null
}

/** Which preset the current settings equal, or null when they are a combination no preset names. */
export function presetFor(profile: SessionProfile, approvalMode: ApprovalMode): PermissionPresetId | null {
  const match = PERMISSION_PRESETS.find(
    (preset) => preset.profile === profile && preset.approvalMode === approvalMode
  )
  return match?.id ?? null
}
