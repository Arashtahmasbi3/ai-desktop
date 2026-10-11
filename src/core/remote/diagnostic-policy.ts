/**
 * Diagnostic Mode (v2.5.3, Fix 1).
 *
 * P0-2 confines a remote project to its own root, which is correct for writes and
 * edits but also blocks *read-only* system introspection the agent needs to
 * diagnose a crash (`/var/log`, `/proc`, `/etc/os-release`, …). Diagnostic Mode is
 * a short-lived, explicitly user-enabled, read-only widening of that boundary.
 *
 * It is a policy object, not a boolean, so the decision is data: an allow-list of
 * system paths and a hard expiry. Everything is pure and time-injectable, so the
 * whole thing is unit-testable without SSH; nothing here touches the filesystem.
 */
export interface DiagnosticPolicy {
  enabled: boolean
  /** Epoch ms after which the policy is ignored, whatever `enabled` says. */
  expiresAt: number
  /** Absolute system paths (files or directories) that become readable. */
  allowedPaths: string[]
}

/** Read-only system locations the agent needs to diagnose a crash. */
export const DEFAULT_DIAGNOSTIC_PATHS = [
  '/var/log',
  '/root/.pm2/logs',
  '/run/log/journal',
  '/proc',
  '/etc/os-release',
  '/etc/hostname',
  '/sys/class',
  '/tmp'
]

/** How long a freshly enabled Diagnostic Mode stays active. */
export const DIAGNOSTIC_TTL_MS = 30 * 60 * 1000

/**
 * Build a fresh policy. The window starts counting from the caller's clock, so
 * tests can pass an explicit `now` rather than sleeping.
 */
export function createDiagnosticPolicy(
  now: number = Date.now(),
  allowedPaths: string[] = DEFAULT_DIAGNOSTIC_PATHS
): DiagnosticPolicy {
  return {
    enabled: true,
    expiresAt: now + DIAGNOSTIC_TTL_MS,
    allowedPaths: [...allowedPaths]
  }
}

/** True while the policy is enabled and has not expired. */
export function isDiagnosticActive(policy: DiagnosticPolicy | null | undefined): boolean {
  return Boolean(policy?.enabled) && Date.now() <= (policy?.expiresAt ?? 0)
}

/** Milliseconds left before the policy expires (0 when inactive/expired). */
export function diagnosticRemainingMs(
  policy: DiagnosticPolicy | null | undefined,
  now: number = Date.now()
): number {
  if (!policy?.enabled) return 0
  return Math.max(0, policy.expiresAt - now)
}

/**
 * True when `path` is inside one of the allowed system locations. Directory
 * entries match their whole subtree (`/var/log` matches `/var/log/syslog`); file
 * entries must match exactly. Only absolute paths are considered.
 */
export function isDiagnosticAllowed(
  path: string,
  policy: DiagnosticPolicy | null | undefined
): boolean {
  if (!policy?.enabled) return false
  if (Date.now() > policy.expiresAt) return false
  if (typeof path !== 'string' || !path.startsWith('/')) return false

  for (const allowed of policy.allowedPaths) {
    const entry = allowed.replace(/\/+$/, '')
    if (!entry) continue
    if (path === entry || path.startsWith(entry + '/')) return true
  }
  return false
}
