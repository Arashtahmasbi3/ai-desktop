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
 * Commands that only inspect the host and are therefore safe to run without an
 * explicit approval (v2.5.5). This is a superset of
 * {@link ALWAYS_ALLOWED_COMMANDS} that additionally admits the diagnostic
 * readers (`cat`, `grep`, `ls`, `journalctl`, ...) and a few tool CLIs whose
 * subcommands can be restricted to inspections.
 */
export const READ_ONLY_BASE_COMMANDS = new Set([
  // File inspection
  'cat', 'head', 'tail', 'less', 'more', 'tac', 'nl',
  'grep', 'egrep', 'fgrep', 'zgrep', 'zcat', 'bzcat', 'xzcat',
  'ls', 'll', 'dir', 'tree', 'find', 'stat', 'file', 'wc',
  'readlink', 'realpath', 'strings', 'blkid', 'du',
  // System introspection
  'uname', 'hostname', 'uptime', 'whoami', 'id', 'pwd', 'date',
  'free', 'df', 'lscpu', 'lsmem', 'nproc', 'lsblk', 'mount',
  'ps', 'top', 'htop', 'ss', 'netstat', 'ip', 'ifconfig',
  // Text / lookups
  'echo', 'printf', 'true', 'false', 'which', 'whereis', 'env', 'printenv',
  'journalctl', 'dmesg',
  // Tool CLIs (subcommand-restricted below)
  'systemctl', 'docker', 'pm2', 'kubectl', 'node', 'npm', 'python', 'python3'
])

/**
 * Read-only subcommands for the multi-purpose CLIs above. `null` means the
 * command has no subcommand gate (its own write flags are checked separately).
 */
const READ_ONLY_SUBCOMMANDS: Record<string, string[] | null> = {
  systemctl: ['status', 'show', 'cat', 'is-active', 'is-enabled', 'is-failed', 'list-units', 'list-unit-files'],
  docker: ['logs', 'ps', 'inspect', 'stats', 'images', 'version', 'info', 'top', 'port', 'diff'],
  pm2: ['list', 'status', 'logs', 'describe', 'show', 'prettylist', 'jlist'],
  kubectl: ['get', 'describe', 'logs', 'top', 'explain', 'version', 'config', 'cluster-info', 'api-resources', 'api-versions'],
  node: ['--version', '-v'],
  npm: ['--version', '-v', 'ls', 'list', 'view', 'outdated'],
  python: ['--version', '-V'],
  python3: ['--version', '-V']
}

/** Output redirection to a real file, command substitution, or `tee`. */
function hasWriteIndicator(command: string): boolean {
  // `2>&1` and `[2]>/dev/null` are benign: they discard or merge streams.
  const stripped = command
    .replace(/\d?>&\d/g, ' ')
    .replace(/\d?>>?\/dev\/null/g, ' ')
  if (/>>?/.test(stripped)) return true
  if (/[`]/.test(command)) return true
  if (/\$\(/.test(command)) return true
  if (/(^|[^A-Za-z0-9_-])tee([^A-Za-z0-9_-]|$)/.test(command)) return true
  return false
}

/** True when a token looks like an inline environment assignment (`FOO=bar`). */
function isEnvAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)
}

/** `token` is the executable's subcommand, allowing global flags to precede it. */
function allowsSubcommand(base: string, tokens: string[]): boolean {
  const allowed = READ_ONLY_SUBCOMMANDS[base]
  if (allowed === null) return true
  if (!allowed) return true
  const sub = tokens.find((token) => !token.startsWith('-'))
  return sub !== undefined && allowed.includes(sub)
}

/**
 * True when `command` is a read-only shell command that may skip explicit
 * approval (v2.5.5). Compound commands (`;`, `&&`, `||`, pipelines) are allowed
 * as long as **every** segment is read-only; output redirection to a real file,
 * command substitution and `tee` are refused because they can write.
 *
 * This is deliberately conservative: it only relaxes the *approval* prompt. Path
 * containment (P0-2) and the deny list still run afterwards, so a read-only
 * command that references a path outside the project is still blocked.
 */
export function isReadOnlyShellCommand(command: string): boolean {
  if (typeof command !== 'string') return false
  const trimmed = command.trim()
  if (!trimmed) return false
  if (hasWriteIndicator(trimmed)) return false

  const segments = trimmed
    .split(/\s*(?:;|&&|\|\|)\s*/)
    .map((segment) => segment.trim())
    .filter(Boolean)
  if (segments.length === 0) return false

  return segments.every((segment) =>
    segment.split('|').every((part) => {
      const tokens = part.trim().split(/\s+/).filter(Boolean)
      while (tokens.length > 0 && isEnvAssignment(tokens[0])) tokens.shift()
      if (tokens.length === 0) return false
      const base = tokens[0].split('/').pop() ?? tokens[0]
      if (!READ_ONLY_BASE_COMMANDS.has(base)) return false
      if (base === 'find' && tokens.some((token) => /^-(exec|delete|ok)$/.test(token))) return false
      return allowsSubcommand(base, tokens.slice(1))
    })
  )
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
