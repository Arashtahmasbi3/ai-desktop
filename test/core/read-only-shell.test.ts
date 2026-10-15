import { describe, it, expect } from 'vitest'
import {
  isReadOnlyShellCommand,
  isDiagnosticReadOnlyCommand
} from '@core/remote/command-whitelist'
import { enforceCommandPaths } from '@core/remote/path-guard'
import { createDiagnosticPolicy } from '@core/remote/diagnostic-policy'
import { shouldRequireApproval } from '@main/approval-gate'

const ROOT = '/opt/demo-project'

/**
 * Task 3.1 - the read-only shell classifier accepts *compound* commands
 * (`;`, `&&`, `||`, pipes) when every segment is read-only, so crash diagnosis
 * like `ls ... 2>&1; echo '==='` no longer needs approval. Writes still refuse.
 */
describe('Task 3.1 - read-only compound shell commands', () => {
  it('1. allows a plain listing', () => {
    expect(isReadOnlyShellCommand(`ls ${ROOT}`)).toBe(true)
  })

  it('2. allows stderr redirection (2>&1)', () => {
    expect(isReadOnlyShellCommand(`ls ${ROOT} 2>&1`)).toBe(true)
  })

  it('3. allows a `;`-chained read-only command', () => {
    expect(isReadOnlyShellCommand(`ls ${ROOT}/releases/ 2>&1; echo '==== curl localhost:3000'`)).toBe(
      true
    )
  })

  it('4. allows `cd` into the project followed by a read', () => {
    expect(isReadOnlyShellCommand(`cd ${ROOT}/releases/x && ls -la`)).toBe(true)
  })

  it('5. allows `&&`-chained host introspection', () => {
    expect(isReadOnlyShellCommand('uname -a && uptime && free -h')).toBe(true)
  })

  it('6. allows reading a file with /dev/null redirection', () => {
    expect(isReadOnlyShellCommand('cat /etc/os-release 2>/dev/null')).toBe(true)
  })

  it('7. allows echo', () => {
    expect(isReadOnlyShellCommand("echo 'hello'")).toBe(true)
  })

  it('8. allows a read-only systemctl subcommand', () => {
    expect(isReadOnlyShellCommand('systemctl status x')).toBe(true)
  })

  it('9. rejects a mutating systemctl subcommand', () => {
    expect(isReadOnlyShellCommand('systemctl restart x')).toBe(false)
  })

  it('10. rejects output redirection to a file', () => {
    expect(isReadOnlyShellCommand(`ls ${ROOT} > /tmp/out`)).toBe(false)
  })

  it('11. rejects tee', () => {
    expect(isReadOnlyShellCommand(`ls ${ROOT} | tee /tmp/out`)).toBe(false)
  })

  it('12. rejects a destructive command', () => {
    expect(isReadOnlyShellCommand(`rm ${ROOT}`)).toBe(false)
  })
})

/** Extra guards: the relaxation must not open a path-containment hole. */
describe('Task 3.1 - containment is preserved', () => {
  it('still rejects an absolute path outside the project root', () => {
    const result = enforceCommandPaths(`ls -la /etc/shadow`, ROOT)
    expect(result.ok).toBe(false)
  })

  it('rejects a `cd` + `..` escape even though both segments look readable', () => {
    expect(isReadOnlyShellCommand(`cd ${ROOT} && cat ../../etc/shadow`)).toBe(false)
  })

  it('admits a compound read-only command against a diagnostic path when enabled', () => {
    const diagnostic = createDiagnosticPolicy(Date.now(), ['/var/log'])
    // `;`-chained, not a pure diagnostic read -> previously refused.
    expect(isDiagnosticReadOnlyCommand('tail /var/log/app.log 2>&1; echo done')).toBe(false)
    expect(enforceCommandPaths('tail /var/log/app.log 2>&1; echo done', ROOT, diagnostic).ok).toBe(
      true
    )
  })

  it('still refuses to reach a diagnostic path when the command can write', () => {
    const diagnostic = createDiagnosticPolicy(Date.now(), ['/var/log'])
    const result = enforceCommandPaths('cat /var/log/app.log > /var/log/copy', ROOT, diagnostic)
    expect(result.ok).toBe(false)
  })

  it('skips approval only when the command is genuinely read-only', () => {
    expect(shouldRequireApproval({ name: 'remote_shell', arguments: { command: 'ls -la' } }).required).toBe(
      false
    )
    expect(
      shouldRequireApproval({ name: 'remote_shell', arguments: { command: 'ls -la > out' } }).required
    ).toBe(true)
  })
})
