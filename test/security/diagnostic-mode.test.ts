import { describe, it, expect } from 'vitest'
import {
  createDiagnosticPolicy,
  createReadScopePolicy,
  diagnosticRemainingMs,
  isDiagnosticActive,
  isDiagnosticAllowed,
  mergeReadPolicies,
  DIAGNOSTIC_TTL_MS,
  type DiagnosticPolicy
} from '@core/remote/diagnostic-policy'
import { enforceProjectPath, enforceCommandPaths } from '@core/remote/path-guard'
import { isCommandAlwaysAllowed } from '@core/remote/command-whitelist'

/**
 * v2.5.3 Fix 1 — Diagnostic Mode. P0-2 confinement stays the default; a
 * short-lived, user-enabled, read-only policy may widen it to a fixed set of
 * system paths for crash diagnosis.
 */
const ROOT = '/opt/sepehr-motor'

describe('Diagnostic Mode — path policy', () => {
  it('rejects /var/log when diagnostic OFF', () => {
    expect(enforceProjectPath('/var/log/syslog', ROOT, null).ok).toBe(false)
  })

  it('allows /var/log/syslog when diagnostic ON', () => {
    const policy = createDiagnosticPolicy()
    const result = enforceProjectPath('/var/log/syslog', ROOT, policy)
    expect(result.ok).toBe(true)
    expect(result.source).toBe('diagnostic')
    expect(result.resolvedPath).toBe('/var/log/syslog')
  })

  it('allows /etc/os-release when diagnostic ON', () => {
    const policy = createDiagnosticPolicy()
    expect(enforceProjectPath('/etc/os-release', ROOT, policy).ok).toBe(true)
  })

  it('allows /proc/loadavg when diagnostic ON', () => {
    const policy = createDiagnosticPolicy()
    expect(enforceProjectPath('/proc/loadavg', ROOT, policy).ok).toBe(true)
  })

  it('expires after TTL', () => {
    const policy = createDiagnosticPolicy()
    policy.expiresAt = Date.now() - 1000
    expect(isDiagnosticAllowed('/var/log/syslog', policy)).toBe(false)
    expect(isDiagnosticActive(policy)).toBe(false)
    expect(diagnosticRemainingMs(policy)).toBe(0)
  })

  it('still rejects paths outside both the project and the diagnostic set', () => {
    const policy = createDiagnosticPolicy()
    expect(enforceProjectPath('/etc/shadow', ROOT, policy).ok).toBe(false)
    expect(enforceProjectPath('/root/.ssh/authorized_keys', ROOT, policy).ok).toBe(false)
  })

  it('keeps project paths under the project source, not diagnostic', () => {
    const policy = createDiagnosticPolicy()
    expect(enforceProjectPath('src/index.ts', ROOT, policy).source).toBe('project')
  })

  it('never widens a disabled policy even before its expiry', () => {
    const policy: DiagnosticPolicy = { ...createDiagnosticPolicy(), enabled: false }
    expect(isDiagnosticAllowed('/var/log/syslog', policy)).toBe(false)
    expect(enforceProjectPath('/var/log/syslog', ROOT, policy).ok).toBe(false)
  })

  it('honours a custom allow-list and a custom clock', () => {
    const now = 1_000_000
    const policy = createDiagnosticPolicy(now, ['/custom/logs'])
    expect(policy.expiresAt).toBe(now + DIAGNOSTIC_TTL_MS)
    expect(policy.allowedPaths).toEqual(['/custom/logs'])
    // `isDiagnosticAllowed` reads the wall clock, so the allow-list itself is
    // asserted on a live policy (the custom-clock window is expired by now).
    const live = { ...createDiagnosticPolicy(), allowedPaths: ['/custom/logs'] }
    expect(isDiagnosticAllowed('/custom/logs/app.log', live)).toBe(true)
    expect(isDiagnosticAllowed('/var/log/syslog', live)).toBe(false)
  })

  it('lets a diagnostic shell command read a system path (enforceCommandPaths)', () => {
    const policy = createDiagnosticPolicy()
    expect(enforceCommandPaths('cat /etc/os-release', ROOT, policy).ok).toBe(true)
    expect(enforceCommandPaths('cat /etc/os-release', ROOT, null).ok).toBe(false)
  })
})

describe('Diagnostic Mode — always-allowed commands (Fix 2)', () => {
  it('uname is always allowed', () => {
    expect(isCommandAlwaysAllowed('uname -a')).toBe(true)
  })

  it('free is always allowed', () => {
    expect(isCommandAlwaysAllowed('free -h')).toBe(true)
  })

  it('df is always allowed', () => {
    expect(isCommandAlwaysAllowed('df -h')).toBe(true)
  })

  it('uptime is always allowed', () => {
    expect(isCommandAlwaysAllowed('uptime')).toBe(true)
  })

  it('journalctl requires diagnostic', () => {
    expect(isCommandAlwaysAllowed('journalctl -u x')).toBe(false)
  })

  it('systemctl status is allowed, restart is not', () => {
    expect(isCommandAlwaysAllowed('systemctl status x')).toBe(true)
    expect(isCommandAlwaysAllowed('systemctl restart x')).toBe(false)
  })

  it('a whitelisted command bypasses the project path scan', () => {
    expect(enforceCommandPaths('uname -a', ROOT, null).ok).toBe(true)
    expect(enforceCommandPaths('df -h', ROOT, null).ok).toBe(true)
    expect(enforceCommandPaths('free -h', ROOT, null).ok).toBe(true)
  })

  it('does not let a whitelisted prefix smuggle a second command', () => {
    expect(isCommandAlwaysAllowed('uname -a && cat /etc/shadow')).toBe(false)
    expect(isCommandAlwaysAllowed('uptime; rm -rf /')).toBe(false)
    expect(isCommandAlwaysAllowed('df -h | tee /etc/passwd')).toBe(false)
    expect(isCommandAlwaysAllowed('uname -a > /etc/passwd')).toBe(false)
    expect(isCommandAlwaysAllowed('free -h $(cat /etc/shadow)')).toBe(false)
    expect(enforceCommandPaths('uname -a && cat /etc/shadow', ROOT, null).ok).toBe(false)
  })

  it('matches an absolute binary path via its basename', () => {
    expect(isCommandAlwaysAllowed('/usr/bin/uptime')).toBe(true)
    expect(isCommandAlwaysAllowed('/bin/df -h')).toBe(true)
  })

  it('does not allow a pipe, redirect or newline around a safe command', () => {
    expect(isCommandAlwaysAllowed('ps aux\ncat /etc/passwd')).toBe(false)
    expect(isCommandAlwaysAllowed('id > /tmp/x')).toBe(false)
  })
})

/**
 * v2.6.2 T2.4 — environment read scope. The Investigate read reach is expressed
 * as a DiagnosticPolicy built from environment roots, so the two policies must
 * compose without ever widening a *write* (writes ignore diagnostic entirely).
 */
describe('read scope policies (T2.4)', () => {
  it('treats a root entry as "any absolute path"', () => {
    const policy = createReadScopePolicy(['/'])
    expect(isDiagnosticAllowed('/etc/passwd', policy)).toBe(true)
    expect(isDiagnosticAllowed('/var/log/syslog', policy)).toBe(true)
    expect(isDiagnosticAllowed('relative/path', policy)).toBe(false)
  })

  it('returns null when there is nothing to widen', () => {
    expect(createReadScopePolicy([])).toBeNull()
    expect(mergeReadPolicies(null, null)).toBeNull()
    expect(mergeReadPolicies(null, undefined)).toBeNull()
  })

  it('unions two widenings and keeps the later expiry', () => {
    const now = Date.now()
    const a: DiagnosticPolicy = { enabled: true, expiresAt: now + 10_000, allowedPaths: ['/var/log'] }
    const b: DiagnosticPolicy = { enabled: true, expiresAt: now + 20_000, allowedPaths: ['/tmp'] }
    const merged = mergeReadPolicies(a, b)!
    expect(merged.allowedPaths.sort()).toEqual(['/tmp', '/var/log'])
    expect(merged.expiresAt).toBe(b.expiresAt)
    expect(isDiagnosticAllowed('/var/log/x', merged)).toBe(true)
    expect(isDiagnosticAllowed('/tmp/x', merged)).toBe(true)
  })

  it('still refuses a write to a path the read scope exposes', () => {
    const policy = createReadScopePolicy(['/'])
    expect(enforceProjectPath('/etc/passwd', ROOT, policy, 'read').ok).toBe(true)
    expect(enforceProjectPath('/etc/passwd', ROOT, policy, 'write').ok).toBe(false)
  })

  it('a read scope never widens a non-read-only command', () => {
    const policy = createReadScopePolicy(['/'])
    expect(enforceCommandPaths('cat /etc/passwd', ROOT, policy).ok).toBe(true)
    expect(enforceCommandPaths('rm /etc/passwd', ROOT, policy).ok).toBe(false)
  })
})
