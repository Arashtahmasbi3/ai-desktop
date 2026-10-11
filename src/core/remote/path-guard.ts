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
import { isDiagnosticAllowed, type DiagnosticPolicy } from './diagnostic-policy'

export interface PathGuardResult {
  ok: boolean
  resolvedPath?: string
  error?: string
  /** Which rule admitted the path: the project root or Diagnostic Mode (v2.5.3). */
  source?: 'project' | 'diagnostic'
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
  diagnostic?: DiagnosticPolicy | null
): PathGuardResult {
  if (!requestedPath || typeof requestedPath !== 'string') {
    return { ok: false, error: 'Invalid path' }
  }
  if (!projectRoot || typeof projectRoot !== 'string') {
    return { ok: false, error: 'Invalid project root' }
  }

  const root = normalizeRoot(projectRoot)
  const resolved = path.posix.isAbsolute(requestedPath)
    ? path.posix.normalize(requestedPath)
    : path.posix.normalize(path.posix.join(root, requestedPath))

  if (/[\x00-\x1f]/.test(resolved)) {
    return { ok: false, error: 'Path contains control characters' }
  }

  const contained = root === '/' || resolved === root || resolved.startsWith(root + '/')
  if (contained) {
    return { ok: true, resolvedPath: resolved, source: 'project' }
  }

  // P0-2 says no; Diagnostic Mode (user-enabled, read-only, expiring) may still
  // admit an absolute system path so the agent can inspect logs and metrics.
  if (path.posix.isAbsolute(resolved) && isDiagnosticAllowed(resolved, diagnostic)) {
    return { ok: true, resolvedPath: resolved, source: 'diagnostic' }
  }

  return {
    ok: false,
    error: `Path "${requestedPath}" is outside project root "${root}"`
  }
}

/**
 * Heuristic extraction of absolute filesystem paths from a shell command.
 * URLs (`https://host/x`) are stripped first so a `curl` target is not mistaken
 * for a local path. Relative paths are ignored — the remote shell's cwd is the
 * project root, so they cannot escape it.
 */
export function extractAbsolutePaths(command: string): string[] {
  if (typeof command !== 'string' || !command) return []
  const withoutUrls = command.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, ' ')
  const matches = withoutUrls.match(/\/[A-Za-z0-9_\-./]+/g) ?? []
  return matches.filter((value) => value.length > 1)
}

/**
 * Validate every absolute path referenced by a shell command against the
 * project root. Benign device paths (`/dev/null`, ...) are allowed so ordinary
 * redirections keep working. Returns the first rejection found.
 */
export function enforceCommandPaths(
  command: string,
  projectRoot: string,
  diagnostic?: DiagnosticPolicy | null
): PathGuardResult {
  for (const candidate of extractAbsolutePaths(command)) {
    if (isBenign(path.posix.normalize(candidate))) continue
    const guard = enforceProjectPath(candidate, projectRoot, diagnostic)
    if (!guard.ok) return guard
  }
  return { ok: true }
}
