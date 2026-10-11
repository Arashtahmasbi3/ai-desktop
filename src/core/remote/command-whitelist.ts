/**
 * Always-allowed read-only system commands (v2.5.3, Fix 2).
 *
 * P0-2 blocks any shell command that references an absolute path outside the
 * project, which is right for `cat /etc/shadow` but also stops harmless system
 * introspection such as `uname -a` or `df -h`. Those commands take **no path
 * argument** and only report host facts, so they are allowed unconditionally.
 *
 * Security note: matching on the first token alone is exploitable —
 * `uname -a && cat /etc/shadow` starts with `uname` but smuggles a second
 * command. {@link isCommandAlwaysAllowed} therefore refuses anything containing
 * shell metacharacters (chaining, substitution, redirection, globbing), so only a
 * single, simple, argument-only command can take this shortcut. Anything else
 * falls through to the normal P0-2 path check.
 */

/** Host-introspection commands that never read a project/system file. */
export const ALWAYS_ALLOWED_COMMANDS = new Set([
  // System info
  'uname', 'hostname', 'uptime', 'whoami', 'id', 'pwd', 'date',
  'free', 'df', 'du', 'lscpu', 'lsmem', 'nproc',
  // Process
  'ps', 'top', 'htop',
  // Network
  'ss', 'netstat', 'ip', 'ifconfig',
  // Service (restricted to `status`, see below)
  'systemctl',
  // Utils
  'which', 'whereis', 'env', 'printenv',
  // Disk
  'lsblk', 'mount'
])

/**
 * Commands allowed to *read* the system paths Diagnostic Mode exposes (v2.5.3).
 * Deliberately excludes anything that can write to a named path argument even
 * when it looks harmless: `sed -i`, `sort -o`, `find -delete/-exec`, `tee`,
 * `cp`, `mv`, `rm`, `chmod`, `chown`, `truncate`, `tar`, ...
 */
export const DIAGNOSTIC_READ_ONLY_COMMANDS = new Set([
  'cat', 'head', 'tail', 'less', 'more', 'tac', 'nl',
  'grep', 'egrep', 'fgrep', 'zgrep', 'zcat', 'bzcat', 'xzcat',
  'journalctl', 'dmesg', 'stat', 'file', 'strings', 'wc', 'readlink', 'realpath',
  'ls', 'll', 'dir', 'tree', 'blkid', 'tcpdump', 'systemctl'
])

/** Chaining / substitution / redirection / globbing that could smuggle a command. */
const SHELL_METACHARACTERS = /[;&|`$(){}<>\\\n\r*?[\]]/

/**
 * Metacharacters that make a command unsafe to admit under Diagnostic Mode.
 * Globs (`*?[]`) are allowed - they only widen a read - but command chaining,
 * substitution and (critically) redirection are not, so a diagnostic read can
 * never be turned into a write (`cat x > /etc/y`) or a smuggled second command.
 */
const READ_ONLY_FORBIDDEN = /[;&`$(){}<>\\\n\r]/

/** The executable basename, so `/usr/bin/uptime` matches `uptime`. */
function baseCommand(command: string): string {
  const first = command.trim().split(/\s+/)[0] ?? ''
  const parts = first.split('/')
  return parts[parts.length - 1] ?? ''
}

/**
 * True when `command` is a single, metacharacter-free invocation of an
 * always-allowed command. `systemctl` is only allowed for the read-only
 * `status` subcommand.
 */
export function isCommandAlwaysAllowed(command: string): boolean {
  if (typeof command !== 'string') return false
  const trimmed = command.trim()
  if (!trimmed) return false
  if (SHELL_METACHARACTERS.test(trimmed)) return false

  const base = baseCommand(trimmed)
  if (!ALWAYS_ALLOWED_COMMANDS.has(base)) return false

  // systemctl is allowed for `status` only; restart/stop/start must still go
  // through approval and the normal guards.
  if (base === 'systemctl') {
    return /^systemctl\s+status\b/.test(trimmed)
  }

  return true
}

/** A single read-only segment, e.g. one stage of a pipeline. */
function isReadOnlySegment(segment: string): boolean {
  const base = baseCommand(segment)
  if (!DIAGNOSTIC_READ_ONLY_COMMANDS.has(base)) return false
  if (base === 'systemctl') return /^systemctl\s+status\b/.test(segment)
  return true
}

/**
 * True when `command` is a read-only invocation (optionally a pipeline of them)
 * that may therefore read Diagnostic Mode system paths. Chaining (`;`, `&&`),
 * substitution and redirection are refused so a read cannot become a write.
 */
export function isDiagnosticReadOnlyCommand(command: string): boolean {
  if (typeof command !== 'string') return false
  const trimmed = command.trim()
  if (!trimmed) return false
  if (READ_ONLY_FORBIDDEN.test(trimmed)) return false
  const segments = trimmed
    .split('|')
    .map((segment) => segment.trim())
    .filter(Boolean)
  if (segments.length === 0) return false
  return segments.every(isReadOnlySegment)
}
