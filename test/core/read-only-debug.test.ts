import { describe, it, expect } from 'vitest'
import { isReadOnlyShellCommand } from '@core/remote/command-whitelist'

/**
 * v2.5.8 — regression coverage for the read-only detection root cause.
 *
 * `isReadOnlyShellCommand` treated a segment that was *only* an environment
 * assignment (`B=/path`) as a write, because stripping the assignment left an
 * empty token list and the code returned `false`. Since `.every()` short-
 * circuits on the first failing segment, one assignment poisoned the whole
 * chain: a genuinely read-only probe asked for approval, showed a "Write"
 * badge and looped on the refusal.
 *
 * An assignment only mutates the shell's own environment, never the file
 * system, so it must count as a read. Actual writes (`rm`, redirects, `tee`,
 * `sed -i`, ...) are still refused, and P0-2 path containment still runs in the
 * executor afterwards.
 */
describe('v2.5.8 - read-only detection (variable assignments)', () => {
  it('1. a bare variable assignment is read-only', () => {
    expect(isReadOnlyShellCommand('B=/opt/demo-project/web')).toBe(true)
    expect(isReadOnlyShellCommand('FOO=bar')).toBe(true)
    expect(isReadOnlyShellCommand('A=1 B=2 C=3')).toBe(true)
  })

  it('2. assignment(s) followed by read commands is read-only', () => {
    expect(isReadOnlyShellCommand('B=/opt/app; echo hello; cat "$B"/package.json')).toBe(true)
    expect(isReadOnlyShellCommand('B=/opt/app; find "$B" -maxdepth 2 -name BUILD_ID')).toBe(true)
    expect(isReadOnlyShellCommand('B=/opt/app cat "$B"/pkg.json')).toBe(true)
  })

  it('3. assignment followed by a write command is still a write', () => {
    expect(isReadOnlyShellCommand('B=/tmp/x; rm -rf "$B"')).toBe(false)
    expect(isReadOnlyShellCommand('B=/tmp/x; echo hi > "$B"')).toBe(false)
    expect(isReadOnlyShellCommand('B=/tmp/x; tee "$B"')).toBe(false)
  })

  it('4. a complex chain with `;` and `2>&1` is read-only', () => {
    const command =
      'B=/opt/demo-project/web; echo "=== BUILD_ID ? ==="; ' +
      'find "$B" -maxdepth 2 -name BUILD_ID 2>&1; cat "$B"/package.json 2>&1'
    expect(isReadOnlyShellCommand(command)).toBe(true)
  })

  it('5. the real user command is read-only', () => {
    const command =
      'B=/opt/demo-project/releases/RELEASE-2026-10-05/web; echo "=== BUILD_ID ? ==="; ' +
      'find "$B" -maxdepth 2 -name BUILD_ID 2>&1; ls -la "$B" 2>&1; ' +
      'cat "$B"/.next/package.json 2>&1'
    expect(isReadOnlyShellCommand(command)).toBe(true)
  })

  it('6. an actually empty part is still rejected', () => {
    expect(isReadOnlyShellCommand('ls |')).toBe(false)
    expect(isReadOnlyShellCommand('')).toBe(false)
  })

  it('7. a parent-directory reference is never auto-approved', () => {
    expect(isReadOnlyShellCommand('B=../secret; cat "$B"')).toBe(false)
  })
})
