/**
 * Remote path containment (v2.5, P0-2).
 *
 * A remote project has an absolute root on the VPS. The model may emit any path
 * (absolute, relative, or embedded in a shell command); without this guard an
 * absolute path such as `/etc/nginx/nginx.conf` or `/root/.ssh/authorized_keys`
 * would be accepted verbatim and read or overwritten outside the project.
 *
 * Everything here is a pure function over POSIX strings so it can be unit-tested
 * without SSH. It is deliberately lexical (no `realpath`): resolving symlinks
 * needs a round-trip to the host, and the remote tools already restrict access to
 * connected servers. Callers that can stat the target should resolve symlinks
 * themselves before calling.
 */
import * as path from 'path'
import { refusalMessage } from '@shared/refusal'
import {
  matchPathAllowScope,
  type PathAllowContext,
  type PathAllowScope
} from '@core/agent/server-grant'
import { isDiagnosticAllowed, type DiagnosticPolicy } from './diagnostic-policy'
import {
  isCommandAlwaysAllowed,
  isDiagnosticReadOnlyCommand,
  isReadOnlyShellCommand
} from './command-whitelist'

export interface PathGuardResult {
  ok: boolean
  resolvedPath?: string
  error?: string
  /** Which rule admitted the path: the project root, an allow scope, or Diagnostic Mode. */
  source?: 'project' | 'diagnostic' | 'allow-scope'
  /**
   * S1.3: the path is a WRITE that leaves the project root on a remote host. It is not refused
   * here — a remote write outside the project is an approval, not a wall — so the caller must
   * pass it to the approval gate and only run it once the user said yes.
   */
  approvalRequired?: boolean
  /** The rule that produced this verdict, when it is a refusal or an approval. */
  rule?: 'containment' | 'approval-required'
  /** S2.3: the scope that admitted the path, so the caller can record it in the audit log. */
  allowScope?: PathAllowScope
}

/** Device/pseudo files that are safe to reference regardless of the project. */
const BENIGN_PREFIXES = ['/dev/'] as const
const BENIGN_EXACT = new Set(['/dev', '/proc/self/fd'])

function isBenign(absolute: string): boolean {
  if (BENIGN_EXACT.has(absolute)) return true
  return BENIGN_PREFIXES.some((prefix) => absolute.startsWith(prefix))
}

/** Normalize a project root, keeping `/` as `/` (never an empty string). */
function normalizeRoot(projectRoot: string): string {
  const normalized = path.posix.normalize(projectRoot)
  if (normalized === '/' || normalized === '.') return '/'
  return normalized.replace(/\/+$/, '')
}

/**
 * Resolve `requestedPath` (absolute or relative) against `projectRoot` and prove
 * it stays inside the root. Rejects empty input, control characters and escapes.
 */
export function enforceProjectPath(
  requestedPath: string,
  projectRoot: string,
  diagnostic?: DiagnosticPolicy | null,
  /**
   * Diagnostic Mode is read-only: a write (`mode: 'write'`) may never leave the
   * project root, even for a path the diagnostic policy would otherwise expose.
   */
  mode: 'read' | 'write' = 'read',
  /**
   * S2.3: the user's time-boxed "allow this path once" scopes. Consulted *inside* this decision —
   * after the empty/control/`..` rules and never for a write — so a scope can only widen a read
   * that every other guard already admitted.
   */
  allow?: PathAllowContext
): PathGuardResult {
  if (!requestedPath || typeof requestedPath !== 'string') {
    return { ok: false, error: 'Invalid path', rule: 'containment' }
  }
  if (!projectRoot || typeof projectRoot !== 'string') {
    return { ok: false, error: 'Invalid project root', rule: 'containment' }
  }

  const root = normalizeRoot(projectRoot)
  const resolved = path.posix.isAbsolute(requestedPath)
    ? path.posix.normalize(requestedPath)
    : path.posix.normalize(path.posix.join(root, requestedPath))

  if (/[\x00-\x1f]/.test(resolved)) {
    return {
      ok: false,
      rule: 'containment',
      error: refusalMessage({
        rule: 'containment',
        detail: `Path ${JSON.stringify(resolved)} contains control characters`,
        path: requestedPath,
        alternatives: ['use a normal path without control characters']
      })
    }
  }

  const contained = root === '/' || resolved === root || resolved.startsWith(root + '/')
  if (contained) {
    return { ok: true, resolvedPath: resolved, source: 'project' }
  }

  if (mode === 'read' && allow !== undefined) {
    const scope = matchPathAllowScope(
      allow.scopes,
      resolved,
      { vpsId: allow.vpsId, projectId: allow.projectId },
      allow.now ?? Date.now()
    )
    if (scope !== undefined) {
      return { ok: true, resolvedPath: resolved, source: 'allow-scope', allowScope: scope }
    }
  }

  // P0-2 says no; Diagnostic Mode (user-enabled, read-only, expiring) may still
  // admit an absolute system path so the agent can inspect logs and metrics.
  if (
    mode === 'read' &&
    path.posix.isAbsolute(resolved) &&
    isDiagnosticAllowed(resolved, diagnostic)
  ) {
    return { ok: true, resolvedPath: resolved, source: 'diagnostic' }
  }

  return {
    ok: false,
    rule: 'containment',
    error: refusalMessage({
      rule: 'containment',
      detail: `Path ${JSON.stringify(requestedPath)} is outside project root ${JSON.stringify(root)}`,
      path: requestedPath
    })
  }
}

/**
 * Heuristic extraction of absolute filesystem paths from a shell command.
 *
 * Only a `/` that *starts a token* is a path separator the shell would read as
 * absolute. Anchoring matters in both directions (v2.6.5):
 *  - `cat src/index.ts` is a relative path, but an unanchored scan saw
 *    `/index.ts`, resolved it as absolute, and refused a perfectly legal read;
 *  - `cat etc/shadow` (after a `cd ..`) yielded `/shadow`, so the guard blocked
 *    or admitted commands for the wrong reason instead of on the `..` itself.
 * URLs (`https://host/x`) are stripped first so a `curl` target is not mistaken
 * for a local path. Relative paths are handled by
 * {@link commandReferencesParent}.
 */
export function extractAbsolutePaths(command: string): string[] {
  if (typeof command !== 'string' || !command) return []
  const withoutUrls = command.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, ' ')
  const anchored = withoutUrls.match(/(?:^|[\s=('"`<>|;&])\/[A-Za-z0-9_\-./]+/g) ?? []
  return anchored
    .map((value) => value.replace(/^[\s=('"`<>|;&]/, ''))
    .filter((value) => value.length > 1)
}

/**
 * A `..` token that can escape the project root, e.g. `cd ..`,
 * `cat ../../etc/shadow` or a bare `..` argument (v2.6.5).
 *
 * Absolute paths already go through {@link extractAbsolutePaths}, and
 * `/a/../b` is normalised there, so this only needs to catch the forms that
 * carry no leading slash. A quoted `..` such as `git commit -m "fix .."` is
 * deliberately not matched.
 */
const PARENT_SEGMENT = /(?:^|[\s;&|(])\.\.(?:\/|[\s;&|)]|$)/

export function commandReferencesParent(command: string): boolean {
  return typeof command === 'string' && PARENT_SEGMENT.test(command)
}

/** Short options of those transports that consume the following token as their value. */
const TRANSPORT_OPTIONS_WITH_VALUE = /^-(?:o|p|i|l|F|J|c|e|m|D|Q|W|b)$/

/** One shell token: a word, a quoted chunk, or a separator, with its offsets in the source. */
interface ShellToken {
  raw: string
  quoted: boolean
  separator: boolean
  start: number
  end: number
}

/**
 * Split a command into tokens, keeping quoted text together.
 *
 * Quoting is the whole point: a separator inside `'…'` belongs to the remote payload, not to the
 * command being run here, so it must never split the command.
 */
function tokenizeCommand(command: string): ShellToken[] {
  const tokens: ShellToken[] = []
  let index = 0
  const push = (start: number, end: number, quoted: boolean, separator: boolean): void => {
    tokens.push({ raw: command.slice(start, end), quoted, separator, start, end })
  }
  while (index < command.length) {
    const char = command[index]!
    if (/\s/.test(char)) {
      index += 1
      continue
    }
    if (command.startsWith('&&', index) || command.startsWith('||', index)) {
      push(index, index + 2, false, true)
      index += 2
      continue
    }
    if (char === ';' || char === '|' || char === '&') {
      push(index, index + 1, false, true)
      index += 1
      continue
    }
    if (char === '"' || char === "'") {
      const quote = char
      let cursor = index + 1
      while (cursor < command.length && command[cursor] !== quote) {
        if (command[cursor] === '\\' && quote === '"') cursor += 1
        cursor += 1
      }
      push(index, Math.min(cursor + 1, command.length), true, false)
      index = cursor + 1
      continue
    }
    let cursor = index
    while (
      cursor < command.length &&
      !/[\s]/.test(command[cursor]!) &&
      command[cursor] !== ';' &&
      command[cursor] !== '|' &&
      command[cursor] !== '&' &&
      command[cursor] !== '"' &&
      command[cursor] !== "'"
    ) {
      cursor += 1
    }
    push(index, cursor, false, false)
    index = cursor
  }
  return tokens
}

/**
 * Drop the payload of every remote transport (v4.1).
 *
 * "Every absolute path in the command" was wrong for one common shape: `ssh host '…'`, where the
 * quoted text describes the target machine. The guard blocked a legitimate disk check with a message
 * about the wrong filesystem, and the agent had to rewrite a correct command.
 *
 * Tokens are used only to FIND the payload; the command itself is cut, never rebuilt. An earlier version
 * rebuilt it from tokens and silently turned `2>&1` into `2 & >1` — a cosmetic change that made a read
 * look like a redirection to a file.
 */
export function stripRemotePayloads(command: string): string {
  if (typeof command !== 'string' || command === '') return ''
  const tokens = tokenizeCommand(command)
  const cuts: Array<[number, number]> = []

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!
    if (token.separator || token.quoted) continue
    if (token.raw !== 'ssh' && token.raw !== 'mosh') continue

    let cursor = index + 1
    let host: ShellToken | undefined
    while (cursor < tokens.length && !tokens[cursor]!.separator) {
      const candidate = tokens[cursor]!
      if (!candidate.quoted && candidate.raw.startsWith('-')) {
        const takesValue = TRANSPORT_OPTIONS_WITH_VALUE.test(candidate.raw)
        cursor += 1
        if (takesValue && cursor < tokens.length && !tokens[cursor]!.separator) cursor += 1
        continue
      }
      host = candidate
      cursor += 1
      break
    }
    if (host === undefined) continue

    // The payload runs from the end of the host to the next top-level separator.
    let cutTo = command.length
    while (cursor < tokens.length) {
      const next = tokens[cursor]!
      if (next.separator) {
        cutTo = next.start
        break
      }
      cursor += 1
    }
    if (cutTo > host.end) cuts.push([host.end, cutTo])
    index = cursor
  }

  let stripped = command
  for (const [from, to] of cuts.sort((left, right) => right[0] - left[0])) {
    stripped = stripped.slice(0, from) + stripped.slice(to)
  }
  return stripped.replace(/\s+/g, ' ').trim()
}

/**
 * Which filesystem a command's paths refer to (S1, formerly X8).
 *
 * `local` — the command runs here, inside the project, so the project root is a boundary: an
 * absolute path that leaves it, or a `..` that walks out, is refused.
 *
 * `remote-host` — the command is a payload for a host we reach over SSH. **Containment does not
 * apply to it at all** (S1). The project root is a *write-scope for the tools that write on the
 * agent's behalf*, not a read-scope for a shell on a machine the user is root on: `ls /opt/other`
 * there protects nothing and only blocks the work. That is why the earlier version — which stood
 * containment down only when the command was *provably* read-only — was wrong in practice: every
 * real diagnostic (`2>/dev/null`, `| head`, a `for … done` loop) failed the proof and was
 * contained anyway. What still governs a remote command is the deny list, the secret-path guard,
 * the host policy, the approval gate and the audit log, and every remote call site runs them.
 *
 * The one protection kept is a *write*: a write-shaped command whose path leaves the project root
 * is not refused here — it is marked `approvalRequired` so the caller asks the user (S1.3).
 */
export type CommandHost = 'local' | 'remote-host'

/**
 * Absolute paths a **write-shaped** command names that leave `projectRoot`, plus `..` when the
 * command can write (S1.3).
 *
 * A command that inspects the host and can prove it is read-only never appears here — that is
 * S1.1. The harder case is a read that merely *moves* (`cd .. && ls /opt`): the parent-directory
 * rule alone makes the classifier call it a write, which is exactly the fail-closed behaviour that
 * kept the whole exemption unreachable. It is neutralised here — the `..` is replaced with `/` and
 * the command is re-classified — so a move that only reads is a read, while `cd .. && echo hi > x`
 * (which writes through the move) still escalates.
 */
export function escapedWritePaths(command: string, projectRoot: string): string[] {
  if (typeof command !== 'string' || command.trim() === '') return []
  if (typeof projectRoot !== 'string' || projectRoot.trim() === '') return []
  if (isCommandAlwaysAllowed(command) || isReadOnlyShellCommand(command)) return []
  const root = normalizeRoot(projectRoot)
  if (root === '/') return []

  const localCommand = stripRemotePayloads(command)
  const neutralized = localCommand.replace(/(^|[\s=/])\.\.(?=$|[\s/])/g, '$1/')
  if (isCommandAlwaysAllowed(neutralized) || isReadOnlyShellCommand(neutralized)) return []

  const escaped: string[] = []
  if (commandReferencesParent(localCommand)) escaped.push('..')
  for (const candidate of extractAbsolutePaths(localCommand)) {
    const resolved = path.posix.normalize(candidate)
    if (isBenign(resolved)) continue
    if (resolved === root || resolved.startsWith(root + '/')) continue
    escaped.push(resolved)
  }
  return escaped
}

/**
 * Validate every absolute path referenced by a shell command against the
 * project root. Benign device paths (`/dev/null`, ...) are allowed so ordinary
 * redirections keep working. Returns the first rejection found.
 *
 * `host` says which filesystem those paths belong to: a command that runs on the
 * remote host is not path-checked against the project root (S1), while a write
 * that leaves it needs an approval (S1.3).
 */
export function enforceCommandPaths(
  command: string,
  projectRoot: string,
  diagnostic?: DiagnosticPolicy | null,
  /** Where the command runs. `remote-host` means "any path on that machine" (S1). */
  host: CommandHost = 'local'
): PathGuardResult {
  /*
   * S1.1: a remote payload is not contained by this project's root.
   *
   * The project root is the working directory of that command on the host (`cd <root> && …`), not
   * a sandbox: its owner is root on that machine and may `ls /opt`, `du -sh /srv`, `cat
   * /etc/nginx/…` exactly as the shell allows. The whole read-only-proof shortcut is gone, because
   * requiring a proof that no real diagnostic can produce made the exemption unreachable.
   *
   * S1.3: the one thing that still needs a human is a WRITE that lands outside the root. It is
   * reported as `approvalRequired` (never as a block) so the caller can ask, and it runs when the
   * user approves. The deny list and the secret-path guard are not consulted here — they run at
   * the executor for every command, in every mode.
   */
  if (host === 'remote-host') {
    const escaped = escapedWritePaths(command, projectRoot)
    if (escaped.length > 0) {
      return {
        ok: false,
        approvalRequired: true,
        rule: 'approval-required',
        error: refusalMessage({
          rule: 'approval-required',
          detail: `outside project root: ${escaped[0]}`,
          path: escaped[0]
        })
      }
    }
    return { ok: true }
  }

  // A `..` segment escapes the root regardless of what the leading token is, so
  // it is refused before any allow-list shortcut can admit the command (v2.6.5:
  // `cd .. && cd .. && cat etc/shadow` used to pass every other check).
  /*
   * `ssh host 'cd ..'` changes directory on the TARGET; `ls ../x` changes it here. Both checks
   * therefore run on the command with remote payloads removed, so the answer matches whose
   * filesystem the path actually refers to.
   */
  const localCommand = stripRemotePayloads(command)
  if (commandReferencesParent(localCommand)) {
    return {
      ok: false,
      rule: 'containment',
      error: refusalMessage({
        rule: 'containment',
        detail: `".." is not allowed in a project-scoped command`,
        path: '..',
        alternatives: [`use a path inside ${JSON.stringify(normalizeRoot(projectRoot))}`]
      })
    }
  }
  // Read-only host introspection (uname, df, ...) carries no project/system path
  // by design and is allowed before the path scan (v2.5.3, Fix 2). Metacharacters
  // are refused by the whitelist itself, so this cannot smuggle a second command.
  if (isCommandAlwaysAllowed(localCommand)) return { ok: true }
  // A diagnostic bypass is only valid for a read-only command; anything that can
  // write (redirection, `rm`, `sed -i`, chaining) must not reach system paths.
  // v2.5.6: compound read-only commands (`a 2>&1; b && c`) now qualify too.
  const readOnly =
    isDiagnosticReadOnlyCommand(localCommand) || isReadOnlyShellCommand(localCommand)
  for (const candidate of extractAbsolutePaths(localCommand)) {
    if (isBenign(path.posix.normalize(candidate))) continue
    const guard = enforceProjectPath(candidate, projectRoot, diagnostic)
    if (!guard.ok) return guard
    if (guard.source === 'diagnostic' && !readOnly) {
      return {
        ok: false,
        rule: 'containment',
        error: refusalMessage({
          rule: 'containment',
          detail: `Path ${JSON.stringify(candidate)} is exposed by Diagnostic Mode but this is not a read-only command`,
          path: candidate,
          alternatives: ['use a read-only command, or narrow it to a path inside the project']
        })
      }
    }
  }
  return { ok: true }
}
