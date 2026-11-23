import { describe, expect, it } from 'vitest'
import { isReadOnlyShellCommand } from '../../src/core/remote/command-whitelist'
import { escapedWritePaths } from '../../src/core/remote/path-guard'

/**
 * v4.3.14 — SEC-1.
 *
 * The read-only classifier split a command on `;`, `&&` and `||` only. A newline and a bare `&` are statement
 * separators to every POSIX shell, so `ls\nrm -rf /srv/x` was ONE segment whose first word was `ls` and was graded
 * a read: `shouldRequireApproval` answered `read_only_shell` (no dialog), and `escapedWritePaths` short-circuits on
 * the same predicate, so the off-root write skipped the S1.3 escalation even in `full` mode.
 *
 * A redirection (`2>&1`) must keep working: it is one statement, not two.
 */
describe('statement separators (v4.3.14)', () => {
  it('does not grade a newline-separated write as a read', () => {
    expect(isReadOnlyShellCommand('ls\nrm -rf /srv/other-project')).toBe(false)
  })

  it('does not grade a bare-& write as a read', () => {
    expect(isReadOnlyShellCommand('ls & rm -rf /srv/other-project')).toBe(false)
  })

  it('still reads a redirection as a single statement', () => {
    expect(isReadOnlyShellCommand('ls -la 2>&1')).toBe(true)
    expect(isReadOnlyShellCommand('df -h /opt 1>&2')).toBe(true)
  })

  it('still reads a `;`-chained probe as a read', () => {
    expect(isReadOnlyShellCommand('cd /opt && ls -la; df -h')).toBe(true)
  })

  it('escalates a write hidden on a second line', () => {
    const command = 'ls\nrm -rf /srv/other-project'
    // The S1.3 guard: a write outside the project root is an explicit consent, even in `full` mode.
    // (`stripRemotePayloads` used to flatten the newline into a space, which made this a null test.)
    expect(escapedWritePaths(command, '/srv/app')).toEqual(['/srv/other-project'])
  })
})
