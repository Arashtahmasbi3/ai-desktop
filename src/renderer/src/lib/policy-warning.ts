/**
 * Chat policy-mismatch warning (v2.3.2, C.2.2).
 *
 * Before an agent command is approved, the renderer flags commands that fall
 * outside the active project's policy (blocked by a deny/mode rule, or not
 * recognised as an explicit read/write). Reuses the canonical engine in
 * `@core/remote/host-policy` — no parallel policy logic.
 */
import { evaluateHostPolicy } from '@core/remote/host-policy'
import type { HostPolicy, HostPolicyMode } from '@shared/vps'

export interface ProjectCommandWarning {
  mode: HostPolicyMode
  reason: string
}

/**
 * Returns a warning when `command` is outside `policy`, or `null` when the
 * command is covered by the policy (an allowed read/write still goes through
 * the normal approval flow, so it is not a mismatch).
 */
export function evaluateProjectCommandWarning(
  policy: HostPolicy | undefined,
  command: string
): ProjectCommandWarning | null {
  if (!policy) return null
  const decision = evaluateHostPolicy(policy, command)
  if (decision.allowed && decision.category !== 'unknown') return null
  return {
    mode: policy.mode,
    reason: decision.reason ?? 'This command is outside the project policy.'
  }
}
