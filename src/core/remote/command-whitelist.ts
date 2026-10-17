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
  // Disk (v2.6.5: `mount` was removed — `mount -o remount,rw /` carries no
  // metacharacter, so it skipped the whole P0-2 path scan and could remount the
  // root filesystem read-write.)
  'lsblk'
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
  'free', 'df', 'lscpu', 'lsmem', 'nproc', 'lsblk',
  'ps', 'top', 'htop', 'pgrep', 'ss', 'netstat', 'ip', 'ifconfig', 'ping',
  // v2.8.1: socket/name-service inspection the agent reaches for during diagnosis.
  'lsof', 'dig', 'host', 'nslookup', 'getent', 'arp', 'route',
  // Text / lookups
  'echo', 'printf', 'true', 'false', 'which', 'whereis', 'env', 'printenv',
  'journalctl', 'dmesg',
  // Network fetch (read-only unless it writes to a file; guarded below)
  'curl', 'wget',
  // Change directory (absolute targets only; guarded below)
  'cd',
  // Tool CLIs (subcommand-restricted below)
  'systemctl', 'docker', 'pm2', 'kubectl', 'node', 'npm', 'python', 'python3', 'git',
  // v2.8.1: `ufw` only through the read-only subcommands below; without it in this set
  // the subcommand gate below is never consulted.
  'ufw'
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
  python3: ['--version', '-V'],
  // v2.8.1: read-only ufw forms.
  ufw: ['status', 'show']
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

/**
 * Split a command on top-level separators, ignoring any separator inside quotes (v4.1).
 *
 * `ssh host 'a; b'` is ONE command whose argument happens to contain a semicolon. Splitting it blindly
 * invented a second command (`ssh host 'a`) whose first word was a dangling quote — and that phantom
 * segment is why read-only diagnostics kept asking for approval.
 */
export function splitTopLevel(command: string, separators: readonly string[]): string[] {
  const parts: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]!
    if (quote !== null) {
      current += char
      if (char === '\\' && quote === '"') {
        current += command[index + 1] ?? ''
        index += 1
        continue
      }
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      current += char
      continue
    }
    const pair = command.slice(index, index + 2)
    const matched = separators.find((candidate) =>
      candidate.length === 2 ? pair === candidate : char === candidate
    )
    if (matched !== undefined) {
      parts.push(current)
      current = ''
      index += matched.length - 1
      continue
    }
    current += char
  }
  parts.push(current)
  return parts.map((part) => part.trim())
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
/**
 * Strip a single wrapper layer and return the command it runs, or undefined when this is
 * not a wrapper. The caller must RE-CLASSIFY the result: trusting `timeout`, `bash -c`
 * or a `for` loop outright would make `timeout 12 rm -rf /srv` prompt-free, which is the
 * entire risk of teaching the classifier about wrappers.
 */
export function unwrapShellWrapper(command: string): string | undefined {
  const text = command.trim()
  const first = text.split(/\s+/)[0] ?? ''
  const tokens = text.split(/\s+/)

  // timeout [opts] <duration> <command …>
  if (first === 'timeout') {
    let index = 1
    while (index < tokens.length && tokens[index].startsWith('-')) {
      if (tokens[index] === '-k' || tokens[index] === '-s') index += 1
      index += 1
    }
    index += 1 // the duration
    const inner = tokens.slice(index).join(' ')
    return inner.trim() === '' || inner === text ? undefined : inner
  }

  // sh|bash|dash|zsh -c '<script>'
  if (first === 'sh' || first === 'bash' || first === 'dash' || first === 'zsh') {
    const match = text.match(/^(?:sh|bash|dash|zsh)\s+-c\s+([\s\S]+)$/)
    if (!match) return undefined
    const inner = stripOuterQuotes(match[1].trim())
    return inner === text ? undefined : inner
  }

  // env VAR=… <command …>
  if (first === 'env') {
    let index = 1
    while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index])) index += 1
    const inner = tokens.slice(index).join(' ')
    return inner.trim() === '' || inner === text ? undefined : inner
  }

  // for|while|until … do <body> done  →  the body
  if (first === 'for' || first === 'while' || first === 'until') {
    const open = text.search(/\bdo\b/)
    const close = text.lastIndexOf('done')
    if (open < 0 || close <= open) return undefined
    const inner = text.slice(open + 2, close).replace(/^[;\s]+/, '').trim()
    return inner === '' ? undefined : inner
  }

  // if … then <body> fi  →  the body
  if (first === 'if') {
    const open = text.search(/\bthen\b/)
    const close = text.lastIndexOf('fi')
    if (open < 0 || close <= open) return undefined
    const inner = text.slice(open + 4, close).trim()
    return inner === '' ? undefined : inner
  }

  // ssh [opts] <host> <remote command …> — the remote command is what runs.
  if (first === 'ssh') {
    let index = 1
    while (index < tokens.length && tokens[index].startsWith('-')) {
      if (['-p', '-i', '-o', '-l', '-F', '-J', '-b', '-c', '-D', '-e', '-L', '-R', '-W'].includes(tokens[index])) {
        index += 1
      }
      index += 1
    }
    index += 1 // the host
    const inner = tokens.slice(index).join(' ')
    return inner.trim() === '' ? undefined : inner
  }

  return undefined
}

/**
 * Remove the quotes a wrapper put around its payload (v4.1).
 *
 * The opening quote must be first, but the closing one need not be last: a redirection can follow it
 * (`'df -h /opt' 2>&1`), and requiring both ends is exactly why a quoted remote read stayed graded as a
 * write. Whatever trails the closing quote is kept, so a real write hidden behind it still counts.
 */
function stripOuterQuotes(text: string): string {
  const quote = text[0]
  if (quote !== "'" && quote !== '"') return text
  const close = text.indexOf(quote, 1)
  if (close === -1) return text
  const inner = text.slice(1, close)
  const rest = text.slice(close + 1).trim()
  return rest === '' ? inner : `${inner} ${rest}`
}

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

  /*
   * v2.8.1: unwrap one layer and re-classify. The agent writes probes such as
   * `timeout 12 ssh -vv …` and `timeout 8 bash -c '…'`, which the base-command test
   * below cannot recognise — so a chain of pure reads prompted because of its wrapper.
   * Recursion shrinks the string every time and the deny list, path containment and
   * secret guard all still run afterwards.
   */
  const unwrapped = unwrapShellWrapper(trimmed)
  /*
   * v4.1: strip the quotes the wrapper carried. `ssh host 'df -h'` returned `'df -h'`, so the first
   * segment's base command was `'df` — unrecognised, therefore graded as a write, therefore prompted.
   * Every read-only probe written the natural way (a quoted remote command) paid a click for this.
   */
  if (unwrapped !== undefined) return isReadOnlyShellCommand(stripOuterQuotes(unwrapped))

  const segments = splitTopLevel(trimmed, [';', '&&', '||']).filter(Boolean)
  if (segments.length === 0) return false

  return segments.every((segment) =>
    splitTopLevel(segment, ['|']).every((part) => {
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
      // v2.8.1: a wrapper as one stage of a chain is judged by the stage it runs.
      if (!READ_ONLY_BASE_COMMANDS.has(base)) {
        const inner = unwrapShellWrapper(part.trim())
        // Same quote problem one level down: a wrapper used as a pipeline stage.
        return inner !== undefined && isReadOnlyShellCommand(stripOuterQuotes(inner))
      }
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
