import { describe, expect, it } from 'vitest'
import { classifyAction, requiresApproval } from '../../src/core/agent/approval'
import {
  isReadOnlyShellCommand,
  unwrapShellWrapper
} from '../../src/core/remote/command-whitelist'
import { READ_ONLY_TOOL_NAMES } from '../../src/shared/profile'

/**
 * v2.8.1 — "it still asks for these permissions that I have to approve, and it is
 * annoying."
 *
 * Two verified causes, both fixed here:
 *  - the four named diagnostics are read-only (the app tells the model to prefer them over
 *    free-form shell) but were missing from the read-only sets, so `auto-write` raised an
 *    ApprovalDialog with a **Write** badge;
 *  - the read-only shell classifier is textual and all-or-nothing, so the wrapper commands
 *    the agent actually used — `timeout … ssh …`, `for … do … done`, `bash -c '…'` — made
 *    an otherwise pure chain count as a write.
 */
describe('read-only tools are classified as reads (v2.8.1)', () => {
  it('classifies every canonical read-only tool as a read', () => {
    for (const name of READ_ONLY_TOOL_NAMES) {
      expect(classifyAction({ name, arguments: {} }), name).toBe('read')
    }
  })

  it('classifies the named diagnostics as reads, not writes', () => {
    // Regression: these prompted with a Write badge in `auto-write` mode.
    for (const name of ['get_service_logs', 'get_disk_usage', 'get_system_health', 'get_process_list']) {
      expect(classifyAction({ name, arguments: {} }), name).toBe('read')
    }
  })

  it('classifies the roster tool as a read so it needs no approval', () => {
    expect(classifyAction({ name: 'list_servers', arguments: {} })).toBe('read')
  })

  it('still classifies shell and unknown tools conservatively', () => {
    expect(classifyAction({ name: 'remote_shell', arguments: { command: 'ls' } })).toBe('shell')
    expect(classifyAction({ name: 'run_command', arguments: { command: 'ls' } })).toBe('shell')
    // An unknown tool must never be auto-approved just by being new.
    expect(classifyAction({ name: 'brand_new_tool', arguments: {} })).toBe('write')
    expect(classifyAction({ name: 'migrate_project', arguments: {} })).toBe('write')
  })

  it('does not prompt for a diagnostic in auto-write mode', () => {
    const action = { name: 'get_system_health', arguments: {} }
    expect(requiresApproval('auto-write', action)).toBe(false)
    // …but still does in the strictest mode.
    expect(requiresApproval('ask', action)).toBe(true)
  })
})

describe('the read-only shell classifier unwraps wrappers (v2.8.1)', () => {
  it('reads through timeout, ssh and bash -c', () => {
    // The exact shapes from the user's screenshot.
    expect(isReadOnlyShellCommand('ss -tlnp | grep ssh')).toBe(true)
    expect(isReadOnlyShellCommand("timeout 8 bash -c 'cat /etc/hosts'")).toBe(true)
    expect(isReadOnlyShellCommand('env LANG=C ls -la')).toBe(true)
    expect(isReadOnlyShellCommand('systemctl status ssh')).toBe(true)
    // An ssh *with a read-only remote command* is a read.
    expect(isReadOnlyShellCommand('timeout 12 ssh -o BatchMode=yes root@203.0.113.23 uptime')).toBe(
      true
    )
  })

  it('still refuses a bare ssh, which would open a remote session', () => {
    // Deliberate: `timeout 12 ssh -vv … host` with no remote command starts a session
    // rather than running a known read, so it keeps asking. Being able to prove the
    // command is a read is the whole basis for skipping the prompt.
    expect(
      isReadOnlyShellCommand('timeout 12 ssh -vv -o BatchMode=yes -o ConnectTimeout=8 root@host')
    ).toBe(false)
  })

  it('reads a wrapper used as one stage of a chain', () => {
    expect(isReadOnlyShellCommand(`echo "== sandbox net test =="; timeout 8 bash -c 'whoami'`)).toBe(
      true
    )
    expect(isReadOnlyShellCommand('ls /opt && timeout 5 df -h')).toBe(true)
  })

  it('reads a for/while loop only when its body is a read', () => {
    expect(isReadOnlyShellCommand('for f in /etc/hostname; do cat $f; done')).toBe(true)
    expect(isReadOnlyShellCommand('if true; then uptime; fi')).toBe(true)
  })

  it('REFUSES to launder a write through a wrapper', () => {
    // The entire risk of teaching the classifier about wrappers: each of these would be
    // prompt-free if the wrapper were trusted instead of re-classified.
    for (const command of [
      'timeout 12 rm -rf /srv',
      'timeout 12 ssh root@host rm -rf /srv',
      "bash -c 'rm -rf /srv'",
      'env FOO=1 rm -rf /srv',
      'for f in a b; do rm -rf /srv; done',
      'if true; then rm -rf /srv; fi',
      'timeout 5 bash -c "rm -rf /srv"',
      'timeout 5 sh -c "echo x > /etc/passwd"'
    ]) {
      expect(isReadOnlyShellCommand(command), command).toBe(false)
    }
  })

  it('still refuses redirection, substitution and parent-directory paths', () => {
    expect(isReadOnlyShellCommand('echo hi > /tmp/x')).toBe(false)
    expect(isReadOnlyShellCommand('cat $(ls)')).toBe(false)
    expect(isReadOnlyShellCommand('cat ../secret')).toBe(false)
    // A benign stream merge or /dev/null redirect is not a write.
    expect(isReadOnlyShellCommand('ls -la 2>&1')).toBe(true)
    expect(isReadOnlyShellCommand('ls /nope 2>/dev/null')).toBe(true)
  })

  it('adds the socket and name-service reads it was missing', () => {
    expect(isReadOnlyShellCommand('lsof -i :22')).toBe(true)
    expect(isReadOnlyShellCommand('dig +short example.com')).toBe(true)
    expect(isReadOnlyShellCommand('getent hosts db.internal')).toBe(true)
    expect(isReadOnlyShellCommand('ufw status')).toBe(true)
  })

  it('returns undefined for anything that is not a wrapper', () => {
    expect(unwrapShellWrapper('ls -la')).toBeUndefined()
    expect(unwrapShellWrapper('rm -rf /')).toBeUndefined()
    expect(unwrapShellWrapper('timeout')).toBeUndefined()
    expect(unwrapShellWrapper('bash script.sh')).toBeUndefined()
  })
})
