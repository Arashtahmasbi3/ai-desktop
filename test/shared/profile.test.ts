import { describe, it, expect } from 'vitest'
import {
  ELEVATION_TTL_MS,
  NAMED_DIAGNOSTIC_TOOL_NAMES,
  WRITE_TOOL_NAMES,
  createElevationGrant,
  grantRevokedReason,
  isGrantValid,
  isNamedDiagnosticTool,
  isReadOnlyTool,
  isSessionProfile,
  isWriteTool,
  parseElevationGrant,
  resolveSessionProfile,
  type ElevationGrant,
  type ProfileScope
} from '@shared/profile'

const NOW = 1_700_000_000_000
const DEV: ProfileScope = { projectId: 'p1', environment: 'development' }

function grantFor(scope: ProfileScope, ttlOffsetMs = 0): ElevationGrant {
  return createElevationGrant({
    environment: scope.environment,
    projectId: scope.projectId,
    vpsId: scope.vpsId,
    now: NOW + ttlOffsetMs,
    random: () => 'token-1'
  })
}

describe('createElevationGrant', () => {
  it('binds the grant to the scope and the environment TTL', () => {
    const grant = createElevationGrant({
      environment: 'production',
      projectId: 'p1',
      vpsId: 'vps-1',
      now: NOW,
      random: () => 'tok'
    })
    expect(grant.token).toBe('tok')
    expect(grant.grantedAt).toBe(NOW)
    expect(grant.expiresAt).toBe(NOW + ELEVATION_TTL_MS.production)
    expect(grant.projectId).toBe('p1')
    expect(grant.vpsId).toBe('vps-1')
  })

  it('gives production the shortest TTL and development the longest', () => {
    expect(ELEVATION_TTL_MS.production).toBeLessThan(ELEVATION_TTL_MS.staging)
    expect(ELEVATION_TTL_MS.staging).toBeLessThan(ELEVATION_TTL_MS.development)
  })
})

describe('grant validation', () => {
  it('accepts a matching, unexpired grant', () => {
    const grant = grantFor(DEV)
    expect(isGrantValid(grant, DEV, NOW + 1000)).toBe(true)
    expect(grantRevokedReason(grant, DEV, NOW + 1000)).toBe('none')
  })

  it('expires the grant at its TTL boundary', () => {
    const grant = grantFor(DEV)
    expect(isGrantValid(grant, DEV, grant.expiresAt - 1)).toBe(true)
    expect(grantRevokedReason(grant, DEV, grant.expiresAt)).toBe('expired')
    expect(isGrantValid(grant, DEV, grant.expiresAt)).toBe(false)
  })

  it('refuses a grant issued for another project or VPS', () => {
    const grant = grantFor({ projectId: 'p1', vpsId: 'vps-1', environment: 'development' })
    expect(grantRevokedReason(grant, { projectId: 'p2', vpsId: 'vps-1' }, NOW)).toBe(
      'scope_mismatch'
    )
    expect(grantRevokedReason(grant, { projectId: 'p1', vpsId: 'vps-2' }, NOW)).toBe(
      'scope_mismatch'
    )
  })

  it('treats a missing grant as inert, never valid', () => {
    expect(isGrantValid(null, DEV, NOW)).toBe(false)
    expect(grantRevokedReason(null, DEV, NOW)).toBe('none')
  })

  it('drops a malformed persisted grant (fail-closed)', () => {
    expect(parseElevationGrant(null)).toBeNull()
    expect(parseElevationGrant({ token: 'x' })).toBeNull()
    expect(parseElevationGrant({ token: '', grantedAt: 1, expiresAt: 2, environment: 'development' })).toBeNull()
    expect(parseElevationGrant({ token: 'x', grantedAt: 1, expiresAt: 2, environment: 'nope' })).toBeNull()
  })
})

describe('resolveSessionProfile', () => {
  it('defaults to develop without forcing an approval change', () => {
    const state = resolveSessionProfile({}, null, {}, NOW)
    expect(state.profile).toBe('develop')
    expect(state.approvalMode).toBe('ask')
    expect(state.exposeWriteTools).toBe(true)
    expect(state.exposeShellTools).toBe(true)
    expect(state.planMode).toBe(false)
    expect(state.enforceEnvironmentPolicy).toBe(false)
  })

  it('investigate/read-only exposes no write or shell tools and asks', () => {
    const state = resolveSessionProfile(
      { profile: 'investigate', investigateScope: 'read-only' },
      null,
      {},
      NOW
    )
    expect(state.profile).toBe('investigate')
    expect(state.investigateScope).toBe('read-only')
    expect(state.approvalMode).toBe('ask')
    expect(state.planMode).toBe(false)
    expect(state.exposeWriteTools).toBe(false)
    expect(state.exposeShellTools).toBe(false)
  })

  it('investigate/plan-only also hides every tool', () => {
    const state = resolveSessionProfile(
      { profile: 'investigate', investigateScope: 'plan-only' },
      null,
      {},
      NOW
    )
    expect(state.planMode).toBe(true)
    expect(state.exposeWriteTools).toBe(false)
    expect(state.exposeShellTools).toBe(false)
  })

  it('deploy asks at least for writes and enforces the environment policy', () => {
    const state = resolveSessionProfile({ profile: 'deploy' }, null, {}, NOW)
    expect(state.profile).toBe('deploy')
    expect(state.approvalMode).toBe('auto-write')
    expect(state.enforceEnvironmentPolicy).toBe(true)
  })

  it('elevated is full only while a valid grant is present', () => {
    const grant = grantFor(DEV)
    const state = resolveSessionProfile({ profile: 'elevated' }, grant, DEV, NOW)
    expect(state.profile).toBe('elevated')
    expect(state.approvalMode).toBe('full')
    expect(state.elevation?.active).toBe(true)
    expect(state.elevation?.expiresAt).toBe(grant.expiresAt)
    expect(state.elevation?.remainingMs).toBe(grant.maxTtlMs)
  })

  // The P0-5 core: this is exactly the hole that existed when the TTL lived in
  // the renderer — a persisted `full` with no valid grant must never stay `full`.
  it('a persisted full preference without a grant clamps to auto-write', () => {
    const state = resolveSessionProfile({ profile: 'elevated', approvalMode: 'full' }, null, DEV, NOW)
    expect(state.profile).toBe('develop')
    expect(state.requestedProfile).toBe('elevated')
    expect(state.approvalMode).toBe('auto-write')
    expect(state.elevation).toBeUndefined()
  })

  it('clamps an expired grant and reports the reason', () => {
    const grant = grantFor(DEV)
    const state = resolveSessionProfile(
      { profile: 'elevated', approvalMode: 'full' },
      grant,
      DEV,
      grant.expiresAt + 1
    )
    expect(state.profile).toBe('develop')
    expect(state.approvalMode).toBe('auto-write')
    expect(state.elevation?.active).toBe(false)
    expect(state.elevation?.revokedReason).toBe('expired')
    expect(state.elevation?.remainingMs).toBe(0)
  })

  it('clamps an out-of-scope grant', () => {
    const grant = grantFor(DEV)
    const state = resolveSessionProfile(
      { profile: 'elevated' },
      grant,
      { projectId: 'other', environment: 'development' },
      NOW
    )
    expect(state.profile).toBe('develop')
    expect(state.elevation?.revokedReason).toBe('scope_mismatch')
  })

  it('never lets production reach full even from a stale preference', () => {
    const state = resolveSessionProfile(
      { profile: 'elevated', approvalMode: 'full' },
      null,
      { projectId: 'p1', environment: 'production' },
      NOW
    )
    expect(state.approvalMode).toBe('auto-write')
  })

  it('keeps the v2.6.1 planModeDefault meaning as investigate/plan-only', () => {
    const state = resolveSessionProfile({ planModeDefault: true }, null, {}, NOW)
    expect(state.profile).toBe('investigate')
    expect(state.investigateScope).toBe('plan-only')
    expect(state.planMode).toBe(true)
  })

  it('derives elevated from a legacy persisted full mode when a grant exists', () => {
    const grant = grantFor(DEV)
    const state = resolveSessionProfile({ approvalMode: 'full' }, grant, DEV, NOW)
    expect(state.profile).toBe('elevated')
    expect(state.approvalMode).toBe('full')
  })
})

describe('investigate scope (T2.2 — plan-only is a sub-flag of Investigate)', () => {
  it('an explicit Investigate defaults to read-only (tools allowed)', () => {
    const state = resolveSessionProfile({ profile: 'investigate' }, null, {}, NOW)
    expect(state.investigateScope).toBe('read-only')
    expect(state.planMode).toBe(false)
    expect(state.exposeWriteTools).toBe(false)
    expect(state.exposeShellTools).toBe(false)
  })

  it('plan-only keeps the v2.6.1 zero-tool behaviour', () => {
    const state = resolveSessionProfile(
      { profile: 'investigate', investigateScope: 'plan-only' },
      null,
      {},
      NOW
    )
    expect(state.investigateScope).toBe('plan-only')
    expect(state.planMode).toBe(true)
    expect(state.exposeWriteTools).toBe(false)
    expect(state.exposeShellTools).toBe(false)
  })

  it('toggling the scope flips only planMode', () => {
    const readOnly = resolveSessionProfile(
      { profile: 'investigate', investigateScope: 'read-only' },
      null,
      {},
      NOW
    )
    const planOnly = resolveSessionProfile(
      { profile: 'investigate', investigateScope: 'plan-only' },
      null,
      {},
      NOW
    )
    expect(readOnly.approvalMode).toBe(planOnly.approvalMode)
    expect(readOnly.profile).toBe(planOnly.profile)
    expect(readOnly.planMode).not.toBe(planOnly.planMode)
  })

  it('ignores an unknown persisted scope and falls back to the profile default', () => {
    const explicit = resolveSessionProfile(
      { profile: 'investigate', investigateScope: 'nonsense' as never },
      null,
      {},
      NOW
    )
    expect(explicit.investigateScope).toBe('read-only')
  })
})

describe('isSessionProfile', () => {
  it('accepts only the four known profiles', () => {
    expect(isSessionProfile('investigate')).toBe(true)
    expect(isSessionProfile('develop')).toBe(true)
    expect(isSessionProfile('deploy')).toBe(true)
    expect(isSessionProfile('elevated')).toBe(true)
    expect(isSessionProfile('root')).toBe(false)
    expect(isSessionProfile(undefined)).toBe(false)
  })
})

describe('read-only tool allowlist', () => {
  it('marks read tools as read-only and mutating tools as not', () => {
    for (const name of ['read_file', 'list_dir', 'remote_read_file', 'diagnose_crash']) {
      expect(isReadOnlyTool(name), name).toBe(true)
    }
    for (const name of ['write_file', 'run_command', 'remote_shell', 'remote_write_file', 'migrate_project']) {
      expect(isReadOnlyTool(name), name).toBe(false)
    }
  })

  it('includes every named diagnostic in the read-only set (T2.1)', () => {
    for (const name of NAMED_DIAGNOSTIC_TOOL_NAMES) {
      expect(isReadOnlyTool(name), name).toBe(true)
      expect(isNamedDiagnosticTool(name), name).toBe(true)
      expect(isWriteTool(name), name).toBe(false)
    }
    expect([...NAMED_DIAGNOSTIC_TOOL_NAMES].sort()).toEqual([
      'diagnose_crash',
      'get_disk_usage',
      'get_process_list',
      'get_service_logs',
      'get_system_health'
    ])
  })

  it('classifies every mutating tool as a write and never as read-only', () => {
    expect([...WRITE_TOOL_NAMES].sort()).toEqual([
      'migrate_database',
      'migrate_docker',
      'migrate_project',
      'project_user_create',
      'project_user_remove',
      'remote_shell',
      'remote_write_file',
      'run_command',
      'scaffold_project',
      'worktree_create',
      'worktree_remove',
      'write_file'
    ])
    for (const name of WRITE_TOOL_NAMES) {
      expect(isWriteTool(name), name).toBe(true)
      expect(isReadOnlyTool(name), name).toBe(false)
      expect(isNamedDiagnosticTool(name), name).toBe(false)
    }
  })
})
