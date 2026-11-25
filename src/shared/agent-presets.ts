import type { ApprovalMode } from './approval'
import type { SessionProfile } from './profile'

/**
 * Agent presets (T17).
 *
 * The checklist's item was "standard / minimal presets" that change the run's posture without changing the architecture.
 * The app already has every knob that matters — the session profile, the approval mode and the plan-mode default — so a
 * preset is a **named triple** of those, applied together. That keeps it honest: no fourth policy layer, and the Settings
 * page can show which preset is currently active.
 *
 * `minimal` is deliberately read-only: the point of asking for the smallest agent is not a smaller prompt, it is an agent
 * that cannot change anything without the user switching presets first.
 */
export type AgentPresetId = 'standard' | 'minimal' | 'review'

export interface AgentPreset {
  id: AgentPresetId
  profile: SessionProfile
  approvalMode: ApprovalMode
  /** Draft a plan before acting. */
  planMode: boolean
}

export const AGENT_PRESETS: readonly AgentPreset[] = [
  { id: 'standard', profile: 'develop', approvalMode: 'ask', planMode: false },
  { id: 'minimal', profile: 'investigate', approvalMode: 'ask', planMode: false },
  { id: 'review', profile: 'develop', approvalMode: 'ask', planMode: true }
]

export function resolveAgentPreset(id: string | undefined): AgentPreset | null {
  if (!id) return null
  return AGENT_PRESETS.find((preset) => preset.id === id) ?? null
}

/** The preset the current settings equal, or null when they are a combination no preset names. */
export function agentPresetFor(
  profile: SessionProfile,
  approvalMode: ApprovalMode,
  planModeDefault: boolean
): AgentPresetId | null {
  const match = AGENT_PRESETS.find(
    (preset) =>
      preset.profile === profile &&
      preset.approvalMode === approvalMode &&
      preset.planMode === planModeDefault
  )
  return match?.id ?? null
}
