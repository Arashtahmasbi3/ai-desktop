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

/** Chaining / substitution / redirection / globbing that could smuggle a command. */
const SHELL_METACHARACTERS = /[;&|`$(){}<>\\\n\r*?[\]]/

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
