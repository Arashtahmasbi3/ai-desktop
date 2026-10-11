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
  'ps', 'top', 'htop', 'pgrep', 'ss', 'netstat', 'ip', 'ifconfig', 'ping',
  // Text / lookups
  'echo', 'printf', 'true', 'false', 'which', 'whereis', 'env', 'printenv',
  'journalctl', 'dmesg',
  // Network fetch (read-only unless it writes to a file; guarded below)
  'curl', 'wget',
  // Change directory (absolute targets only; guarded below)
  'cd',
  // Tool CLIs (subcommand-restricted below)
  'systemctl', 'docker', 'pm2', 'kubectl', 'node', 'npm', 'python', 'python3', 'git'
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

/** `git` subcommands that never mutate the repository (v2.5.6). */
const GIT_READ_SUBCOMMANDS = new Set([
  'status', 'log', 'diff', 'show', 'rev-parse', 'describe', 'blame',
  'shortlog', 'ls-files', 'cat-file', 'reflog', 'branch', 'remote', 'config'
])

/** Mutating flags/verbs for the git subcommands that also have read forms. */
const GIT_MUTATING_FLAGS = /^(-d|-D|-m|-M|--delete|--move|--rename|--edit-description)$/
const GIT_REMOTE_MUTATIONS = new Set([
  'add', 'remove', 'rm', 'rename', 'set-url', 'set-branches', 'set-head', 'prune'
])
const GIT_CONFIG_READ_FLAGS = /^(--get|--get-all|--get-regexp|--get-urlmatch|-l|--list|--show-origin|--show-scope)$/

/** Flags that make `curl`/`wget` write a file, which is not a read. */
const DOWNLOAD_WRITE_FLAGS = new Set([
  '-o', '-O', '--output', '--output-document', '--remote-name',
  '-P', '--directory-prefix', '--output-dir'
])

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
  // Privilege escalation and in-place edits are never a read.
  if (/(^|\s|;|&|\|)sudo(\s|$)/.test(command)) return true
  if (/(^|\s)sed\s+[^|;]*\s-i/.test(command)) return true
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
 * Read-only `git` invocation (v2.5.6). `branch`, `remote` and `config` have
 * mutating forms, so their write flags/verbs are refused explicitly.
 */
function allowsGit(tokens: string[]): boolean {
  const sub = tokens.find((token) => !token.startsWith('-'))
  if (sub === undefined || !GIT_READ_SUBCOMMANDS.has(sub)) return false
  const rest = tokens.slice(tokens.indexOf(sub) + 1)
  if (sub === 'branch') return !rest.some((token) => GIT_MUTATING_FLAGS.test(token))
  if (sub === 'config') return rest.some((token) => GIT_CONFIG_READ_FLAGS.test(token))
  if (sub === 'remote') return !rest.some((token) => GIT_REMOTE_MUTATIONS.has(token))
  return true
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
  // A parent-directory reference (`..`, `../x`) can step outside the project
  // root without ever naming an absolute path, so it is never auto-approved.
  // `=` is included as a boundary so an assignment value (`B=../secret`) is
  // caught too - otherwise marking assignments read-only would let it through.
  if (/(^|[\s=/])\.\.($|[\s/])/.test(trimmed)) return false

  const segments = trimmed
    .split(/\s*(?:;|&&|\|\|)\s*/)
    .map((segment) => segment.trim())
    .filter(Boolean)
  if (segments.length === 0) return false

  return segments.every((segment) =>
    segment.split('|').every((part) => {
      const tokens = part.trim().split(/\s+/).filter(Boolean)
      const hadTokens = tokens.length > 0
      while (tokens.length > 0 && isEnvAssignment(tokens[0])) tokens.shift()
      if (tokens.length === 0) {
        // A part that is *only* environment assignments (`B=/path`) mutates the
        // shell's own environment, never the filesystem, so it is a read. An
        // actually empty part (e.g. a trailing `|`) is still rejected.
        return hadTokens
      }
      const base = tokens[0].split('/').pop() ?? tokens[0]
      if (!READ_ONLY_BASE_COMMANDS.has(base)) return false
      if (base === 'find' && tokens.some((token) => /^-(exec|delete|ok)$/.test(token))) return false
      // `cd` is only a read when the target is absolute; a relative target (esp.
      // `..`) could step outside the project root, so it needs approval.
      if (base === 'cd') return typeof tokens[1] === 'string' && tokens[1].startsWith('/')
      // `curl`/`wget` write to disk with an output flag; require the read form.
      if (base === 'curl' || base === 'wget') {
        return !tokens.some((token) => DOWNLOAD_WRITE_FLAGS.has(token))
      }
      if (base === 'git') return allowsGit(tokens.slice(1))
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
