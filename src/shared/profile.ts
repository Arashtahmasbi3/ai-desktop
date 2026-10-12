/**
 * Session Profile (v2.6.2, Topic 1) — the top policy layer.
 *
 * Four coarse profiles orchestrate the lower-level policy mechanisms
 * (`approvalMode`, `planMode`, tool exposure, `HostPolicy`, `DiagnosticPolicy`)
 * instead of adding more overlapping switches:
 *
 * - `investigate` — read-only analysis; optionally plan-only (no tools at all).
 * - `develop`     — the v2.6.1 default posture (reads free, writes/shell ask).
 * - `deploy`      — execution with the project's environment policy enforced.
 * - `elevated`    — approval lifted, guardrails (deny-list, P0-2, secret-path
 *                   block) still active. Requires an explicit grant in main.
 *
 * This module is dependency-free and environment-neutral so main, preload and
 * the renderer can all import it. It only *decides*; enforcement lives in main.
 */
import { DEFAULT_APPROVAL_MODE, isApprovalMode, type ApprovalMode } from './approval'
import {
  DEFAULT_PROJECT_ENVIRONMENT,
  isProjectEnvironment,
  type ProjectEnvironment
} from './project-metadata'

export const SESSION_PROFILES = ['investigate', 'develop', 'deploy', 'elevated'] as const
export type SessionProfile = (typeof SESSION_PROFILES)[number]

export const DEFAULT_SESSION_PROFILE: SessionProfile = 'develop'

/** Investigate either exposes read-only tools or no tools at all. */
export type InvestigateScope = 'read-only' | 'plan-only'

export const INVESTIGATE_SCOPES: readonly InvestigateScope[] = ['read-only', 'plan-only']
export const DEFAULT_INVESTIGATE_SCOPE: InvestigateScope = 'read-only'

/** Order used to compare/clamp approval strictness. */
const APPROVAL_ORDER: readonly ApprovalMode[] = ['ask', 'auto-write', 'full']

/** Return the stricter of two approval modes. */
export function maxApproval(a: ApprovalMode, b: ApprovalMode): ApprovalMode {
  return APPROVAL_ORDER.indexOf(a) >= APPROVAL_ORDER.indexOf(b) ? a : b
}

/** Return the more permissive of two approval modes. */
export function minApproval(a: ApprovalMode, b: ApprovalMode): ApprovalMode {
  return APPROVAL_ORDER.indexOf(a) <= APPROVAL_ORDER.indexOf(b) ? a : b
}

/**
 * Environment-aware elevation TTLs. Elevated is a short, explicit grant: local
 * work gets headroom, production gets the least (v2.6.2 design §2.3).
 */
export const ELEVATION_TTL_MS: Record<ProjectEnvironment, number> = {
  development: 60 * 60 * 1000,
  staging: 30 * 60 * 1000,
  production: 15 * 60 * 1000
}

/** A main-side, scoped, expiring grant that authorises `full` approval. */
export interface ElevationGrant {
  token: string
  grantedAt: number
  expiresAt: number
  /** Project the grant was issued for; `undefined` = "no active project". */
  projectId?: string
  /** VPS the grant was issued for ('' for local); `undefined` = "no project". */
  vpsId?: string
  environment: ProjectEnvironment
  /** TTL that was applied when the grant was created (for display/tests). */
  maxTtlMs: number
}

export type ElevationRevokedReason = 'expired' | 'scope_mismatch' | 'none'

/** The masked grant state the renderer may display; it can never be forged. */
export interface ElevationGrantView {
  active: boolean
  expiresAt: number | null
  /** Milliseconds until expiry (0 once lapsed); drives the UI countdown. */
  remainingMs?: number
  environment: ProjectEnvironment
  revokedReason?: ElevationRevokedReason
}

/** The persisted preference fields the profile derivation reads. */
export interface ProfileSettings {
  profile?: SessionProfile
  investigateScope?: InvestigateScope
  /** v2.6.1 compat — kept, no longer authoritative on its own. */
  approvalMode?: ApprovalMode
  planModeDefault?: boolean
}

/** Where a run happens: used to scope grants and pick the environment policy. */
export interface ProfileScope {
  projectId?: string
  vpsId?: string
  environment?: ProjectEnvironment
}

export interface ResolvedProfile {
  /** The effective profile after grant validation (may differ from requested). */
  profile: SessionProfile
  /** What the user asked for, even when a missing grant downgraded it. */
  requestedProfile: SessionProfile
  investigateScope?: InvestigateScope
  approvalMode: ApprovalMode
  planMode: boolean
  exposeWriteTools: boolean
  exposeShellTools: boolean
  enforceEnvironmentPolicy: boolean
  environment: ProjectEnvironment
  elevation?: ElevationGrantView
}

export function isSessionProfile(value: unknown): value is SessionProfile {
  return typeof value === 'string' && (SESSION_PROFILES as readonly string[]).includes(value)
}

export function isInvestigateScope(value: unknown): value is InvestigateScope {
  return typeof value === 'string' && (INVESTIGATE_SCOPES as readonly string[]).includes(value)
}

/**
 * Tools that can only read. Investigate/read-only exposes exactly this set — an
 * allowlist, not a denylist, so a newly added read tool is hidden until it is
 * reviewed rather than a newly added *mutating* tool leaking through (v2.6.2 §5).
 *
 * v2.6.2 T2.1: the named diagnostics join the set. They are read-only by
 * construction and are the *only* path-based access production Investigate
 * grants, so they must survive the allowlist in every environment.
 */
export const READ_ONLY_TOOL_NAMES: ReadonlySet<string> = new Set([
  // Local sandbox reads.
  'read_file',
  'list_dir',
  // Remote project reads (P0-2 contained; secret guard always applied).
  'remote_read_file',
  'remote_list_dir',
  'remote_exists',
  'remote_grep',
  'remote_git_status',
  // Read-only git/worktree inspection.
  'worktree_list',
  // Named diagnostics (fixed probes, no model-chosen paths on production).
  'diagnose_crash',
  'get_service_logs',
  'get_disk_usage',
  'get_system_health',
  'get_process_list'
])

/**
 * The named diagnostics (v2.6.2 T2.3). Fixed, read-only probes that take a
 * *semantic* target (a service, a directory) rather than an arbitrary command,
 * so production Investigate exposes these instead of free path-based reads.
 */
export const NAMED_DIAGNOSTIC_TOOL_NAMES: ReadonlySet<string> = new Set([
  'diagnose_crash',
  'get_service_logs',
  'get_disk_usage',
  'get_system_health',
  'get_process_list'
])

/**
 * Tools that can mutate the workspace, the host or the project. Kept explicit so
 * the "never expose these in Investigate" rule is auditable in one place (T2.1).
 */
export const WRITE_TOOL_NAMES: ReadonlySet<string> = new Set([
  // Local sandbox.
  'write_file',
  'run_command',
  // Remote host.
  'remote_write_file',
  'remote_shell',
  // Migration / scaffolding / per-project users / worktrees.
  'migrate_project',
  'migrate_database',
  'migrate_docker',
  'scaffold_project',
  'project_user_create',
  'project_user_remove',
  'worktree_create',
  'worktree_remove'
])

/** True when a tool is known to be read-only. */
export function isReadOnlyTool(name: string): boolean {
  return READ_ONLY_TOOL_NAMES.has(name)
}

/** True when a tool is a fixed read-only named diagnostic. */
export function isNamedDiagnosticTool(name: string): boolean {
  return NAMED_DIAGNOSTIC_TOOL_NAMES.has(name)
}

/** True when a tool can mutate state and must never be offered in Investigate. */
export function isWriteTool(name: string): boolean {
  return WRITE_TOOL_NAMES.has(name)
}

/** Coerce an untrusted persisted profile, or undefined when it is not one. */
export function coerceSessionProfile(value: unknown): SessionProfile | undefined {
  return isSessionProfile(value) ? value : undefined
}

/** Coerce an untrusted persisted investigate scope, or undefined. */
export function coerceInvestigateScope(value: unknown): InvestigateScope | undefined {
  return isInvestigateScope(value) ? value : undefined
}

function randomToken(): string {
  const crypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (crypto?.randomUUID) return crypto.randomUUID()
  return `grant-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

/** Issue a fresh grant bound to a scope with the environment's TTL. */
export function createElevationGrant(input: {
  environment?: ProjectEnvironment
  projectId?: string
  vpsId?: string
  now?: number
  random?: () => string
}): ElevationGrant {
  const now = input.now ?? Date.now()
  const environment =
    input.environment && isProjectEnvironment(input.environment)
      ? input.environment
      : DEFAULT_PROJECT_ENVIRONMENT
  const maxTtlMs = ELEVATION_TTL_MS[environment]
  return {
    token: (input.random ?? randomToken)(),
    grantedAt: now,
    expiresAt: now + maxTtlMs,
    environment,
    maxTtlMs,
    ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
    ...(input.vpsId !== undefined ? { vpsId: input.vpsId } : {})
  }
}

/**
 * Parse an untrusted persisted grant. Malformed grants are dropped (fail-closed)
 * so a corrupted or hand-edited file can never widen access.
 */
export function parseElevationGrant(raw: unknown): ElevationGrant | null {
  if (typeof raw !== 'object' || raw === null) return null
  const value = raw as Record<string, unknown>
  if (typeof value.token !== 'string' || value.token === '') return null
  if (typeof value.grantedAt !== 'number' || typeof value.expiresAt !== 'number') return null
  if (!isProjectEnvironment(value.environment)) return null
  return {
    token: value.token,
    grantedAt: value.grantedAt,
    expiresAt: value.expiresAt,
    environment: value.environment,
    maxTtlMs:
      typeof value.maxTtlMs === 'number' ? value.maxTtlMs : ELEVATION_TTL_MS[value.environment],
    ...(typeof value.projectId === 'string' ? { projectId: value.projectId } : {}),
    ...(typeof value.vpsId === 'string' ? { vpsId: value.vpsId } : {})
  }
}

/** Why a grant no longer authorises `full` (or `none` when it still does). */
export function grantRevokedReason(
  grant: ElevationGrant | null | undefined,
  scope: ProfileScope,
  now: number = Date.now()
): ElevationRevokedReason {
  if (!grant) return 'none'
  if (now >= grant.expiresAt) return 'expired'
  if ((grant.projectId ?? '') !== (scope.projectId ?? '')) return 'scope_mismatch'
  if ((grant.vpsId ?? '') !== (scope.vpsId ?? '')) return 'scope_mismatch'
  if (scope.environment !== undefined && grant.environment !== scope.environment) {
    return 'scope_mismatch'
  }
  return 'none'
}

/** True when the grant matches the scope and has not expired. */
export function isGrantValid(
  grant: ElevationGrant | null | undefined,
  scope: ProfileScope,
  now: number = Date.now()
): boolean {
  return grantRevokedReason(grant, scope, now) === 'none' && Boolean(grant)
}

function toGrantView(
  grant: ElevationGrant | null | undefined,
  revokedReason: ElevationRevokedReason,
  environment: ProjectEnvironment,
  now: number
): ElevationGrantView | undefined {
  if (!grant) return undefined
  return {
    active: revokedReason === 'none',
    expiresAt: grant.expiresAt,
    remainingMs: Math.max(0, grant.expiresAt - now),
    environment,
    ...(revokedReason !== 'none' ? { revokedReason } : {})
  }
}

/**
 * Derive the profile without an explicit choice, preserving v2.6.1 behaviour:
 * a `planModeDefault` chat is Investigate/plan-only, a persisted `full` mode is
 * Elevated (grant permitting), everything else is Develop.
 */
function derivedProfile(settings: ProfileSettings): SessionProfile {
  if (settings.planModeDefault === true) return 'investigate'
  if (settings.approvalMode === 'full') return 'elevated'
  return DEFAULT_SESSION_PROFILE
}

/**
 * Pure: the effective behaviour for a session, given its persisted preferences,
 * the active scope and (for Elevate) a main-side grant. Never throws; an
 * invalid Elevated claim silently falls back to Develop.
 */
export function resolveSessionProfile(
  settings: ProfileSettings,
  grant: ElevationGrant | null | undefined,
  scope: ProfileScope = {},
  now: number = Date.now()
): ResolvedProfile {
  const environment = scope.environment ?? DEFAULT_PROJECT_ENVIRONMENT
  const explicit = coerceSessionProfile(settings.profile)
  const profile = explicit ?? derivedProfile(settings)
  const requested = isApprovalMode(settings.approvalMode)
    ? settings.approvalMode
    : DEFAULT_APPROVAL_MODE

  if (profile === 'investigate') {
    // Explicit Investigate defaults to read-only; a derived one (legacy
    // planModeDefault) keeps its plan-only meaning.
    const investigateScope =
      coerceInvestigateScope(settings.investigateScope) ??
      (explicit ? DEFAULT_INVESTIGATE_SCOPE : 'plan-only')
    return {
      profile,
      requestedProfile: profile,
      investigateScope,
      approvalMode: 'ask',
      planMode: investigateScope === 'plan-only',
      exposeWriteTools: false,
      exposeShellTools: false,
      enforceEnvironmentPolicy: false,
      environment
    }
  }

  if (profile === 'elevated') {
    const reason = grantRevokedReason(grant, scope, now)
    const elevation = toGrantView(grant, reason, environment, now)
    if (grant && reason === 'none') {
      return {
        profile: 'elevated',
        requestedProfile: 'elevated',
        approvalMode: 'full',
        planMode: false,
        exposeWriteTools: true,
        exposeShellTools: true,
        enforceEnvironmentPolicy: true,
        environment,
        ...(elevation ? { elevation } : {})
      }
    }
    // Grant missing/expired/out-of-scope: fall back to Develop, fail-closed.
    // The ceiling is `auto-write` — a stale/forged `full` preference can never
    // survive without a valid main-side grant (P0-5).
    let approvalMode = minApproval(requested, 'auto-write')
    if (environment === 'production') approvalMode = minApproval(approvalMode, 'auto-write')
    return {
      profile: 'develop',
      requestedProfile: 'elevated',
      approvalMode,
      planMode: false,
      exposeWriteTools: true,
      exposeShellTools: true,
      enforceEnvironmentPolicy: false,
      environment,
      ...(elevation ? { elevation } : {})
    }
  }

  if (profile === 'deploy') {
    // Deploy always asks at least before writes, and never escalates to `full`
    // on production even if a stale `full` preference is still persisted.
    let approvalMode = maxApproval('auto-write', requested)
    if (environment === 'production') approvalMode = minApproval(approvalMode, 'auto-write')
    return {
      profile,
      requestedProfile: profile,
      approvalMode,
      planMode: false,
      exposeWriteTools: true,
      exposeShellTools: true,
      enforceEnvironmentPolicy: true,
      environment
    }
  }

  return {
    profile: 'develop',
    requestedProfile: profile,
    approvalMode: requested,
    planMode: false,
    exposeWriteTools: true,
    exposeShellTools: true,
    enforceEnvironmentPolicy: false,
    environment
  }
}
