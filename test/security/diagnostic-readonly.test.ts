import { describe, it, expect } from 'vitest'
import { createDiagnosticPolicy } from '@core/remote/diagnostic-policy'
import { enforceProjectPath, enforceCommandPaths } from '@core/remote/path-guard'
import { isDiagnosticReadOnlyCommand } from '@core/remote/command-whitelist'

/**
 * v2.5.3 Fix 4 - Diagnostic Mode is READ-ONLY. The widening must never let a
 * write or a chained/smuggled command touch a system path, even while active.
 */
const ROOT = '/opt/demo-project'
const policy = createDiagnosticPolicy()

describe('Diagnostic Mode - read-only command gate', () => {
  it('accepts simple readers and read-only pipelines', () => {
    expect(isDiagnosticReadOnlyCommand('cat /var/log/syslog')).toBe(true)
    expect(isDiagnosticReadOnlyCommand('journalctl -u demo')).toBe(true)
    expect(isDiagnosticReadOnlyCommand('tail -n 100 /var/log/app.log | grep -i error')).toBe(true)
    expect(isDiagnosticReadOnlyCommand('cat /var/log/*.log')).toBe(true)
  })

  it('rejects writers, substitutions, redirects and chaining', () => {
    expect(isDiagnosticReadOnlyCommand('rm -rf /var/log')).toBe(false)
    expect(isDiagnosticReadOnlyCommand('sed -i s/a/b/ /etc/os-release')).toBe(false)
    expect(isDiagnosticReadOnlyCommand('find /var/log -delete')).toBe(false)
    expect(isDiagnosticReadOnlyCommand('cat /var/log/x > /etc/os-release')).toBe(false)
    expect(isDiagnosticReadOnlyCommand('echo hi > /etc/os-release')).toBe(false)
    expect(isDiagnosticReadOnlyCommand('cat /var/log/x; rm -rf /')).toBe(false)
    expect(isDiagnosticReadOnlyCommand('cat /var/log/$(whoami)')).toBe(false)
    expect(isDiagnosticReadOnlyCommand('cat /var/log/x | tee /etc/passwd')).toBe(false)
  })
})

describe('Diagnostic Mode - enforceCommandPaths stays read-only', () => {
  it('allows a read of an exposed path', () => {
    expect(enforceCommandPaths('cat /etc/os-release', ROOT, policy).ok).toBe(true)
    expect(enforceCommandPaths('grep -r ERROR /var/log', ROOT, policy).ok).toBe(true)
  })

  it('refuses a write to an exposed path even with a reader prefix', () => {
    expect(enforceCommandPaths('rm /etc/os-release', ROOT, policy).ok).toBe(false)
    expect(enforceCommandPaths('echo hi > /etc/os-release', ROOT, policy).ok).toBe(false)
    expect(enforceCommandPaths('sed -i s/a/b/ /etc/os-release', ROOT, policy).ok).toBe(false)
  })

  it('refuses paths outside the diagnostic allow-list', () => {
    expect(enforceCommandPaths('cat /etc/shadow', ROOT, policy).ok).toBe(false)
    expect(enforceCommandPaths('cat /etc/os-release; cat /etc/shadow', ROOT, policy).ok).toBe(false)
  })
})

describe('Diagnostic Mode - writes never widen', () => {
  it('read mode admits an exposed path', () => {
    expect(enforceProjectPath('/etc/os-release', ROOT, policy, 'read').ok).toBe(true)
  })

  it('write mode never admits an exposed path', () => {
    expect(enforceProjectPath('/etc/os-release', ROOT, policy, 'write').ok).toBe(false)
    expect(enforceProjectPath('/var/log/syslog', ROOT, policy, 'write').ok).toBe(false)
  })

  it('write mode still admits project paths', () => {
    const guarded = enforceProjectPath('src/index.ts', ROOT, policy, 'write')
    expect(guarded.ok).toBe(true)
    expect(guarded.source).toBe('project')
  })
})
