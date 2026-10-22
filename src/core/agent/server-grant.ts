/**
 * A scoped, expiring "approve every command on THIS server in THIS project" grant
 * (v2.8.1).
 *
 * Reported: "it still asks for these permissions that I have to approve, and it is
 * annoying." The read-only classifier fixes cover provably-read work, but a user doing real
 * shell work on their own VPS still gets one dialog per command — and cannot suppress them
 * at all, because the v2.5 hardening deliberately made shell/write tools non-rememberable
 * (`REMEMBERABLE_TOOLS` is reads only, and `ApprovedCommands.isApproved` returns false for
 * anything outside it).
 *
 * This is the escape hatch, and it is deliberately narrow:
 *  - bound to one `vpsId` **and** one `projectId`, so a remote grant can never cover local
 *    work or another server;
 *  - it expires (30 minutes by default) and expiry is evaluated on read, never by a
 *    renderer timer;
 *  - it is never written into the permanent `always`/`tools`/`sessions` forms, so a stale
 *    file cannot resurrect a permanent shell allow;
 *  - it only suppresses the *user approval*. It is checked after the deny list, so a
 *    deny-listed command still blocks, and the host policy, remote path containment, the
 *    secret-path guard, the rate limiter and the audit log all still run.
 */
export const SERVER_GRANT_TTL_MS = 30 * 60 * 1000

export interface ServerGrant {
  id: string
  vpsId: string
  projectId: string
  createdAt: number
  expiresAt: number
}

export interface ServerGrantContext {
  vpsId: string
  projectId: string
}

/** Mint a grant. The caller supplies the clock so this stays testable. */
export function createServerGrant(
  vpsId: string,
  projectId: string,
  options: { ttlMs?: number; now?: number; id?: string } = {}
): ServerGrant {
  const now = options.now ?? Date.now()
  const ttlMs = options.ttlMs ?? SERVER_GRANT_TTL_MS
  return {
    id: options.id ?? `server:${vpsId}:${projectId}:${now}`,
    vpsId,
    projectId,
    createdAt: now,
    expiresAt: now + ttlMs
  }
}

/**
 * Fail closed: any missing/empty scope, any mismatch, or an expired grant is invalid.
 * An empty `vpsId` means a local run, so it can never match a remote grant.
 */
export function isServerGrantValid(
  grant: ServerGrant,
  context: ServerGrantContext,
  now: number = Date.now()
): boolean {
  if (!grant.vpsId || !grant.projectId) return false
  if (grant.vpsId !== context.vpsId) return false
  if (grant.projectId !== context.projectId) return false
  if (!Number.isFinite(grant.expiresAt)) return false
  return now < grant.expiresAt
}

/**
 * S2.3 — the one-shot allow, in the same shape as the server grant above.
 *
 * The containment refusal offers "allow this path once"; this is what that click mints. It is
 * deliberately narrower than the server grant:
 *  - ONE path prefix (a prefix, never a subtree regex, with a path-segment boundary so
 *    `/opt/app` cannot admit `/opt/app-evil`);
 *  - one `vpsId` **and** one `projectId`, so an allow for a remote project can never cover local
 *    work or another server;
 *  - it admits **reads only** — the refusal it answers is about reading a directory the user owns,
 *    and a write outside the project still goes through the approval gate;
 *  - it expires, and expiry is evaluated on read (`Date.now()` at the decision), never by a timer.
 *
 * Shorter than the 30-minute server grant on purpose: it clears one inspection, not a work session.
 */
export const PATH_ALLOW_TTL_MS = 10 * 60 * 1000

export interface PathAllowScope {
  id: string
  vpsId: string
  projectId: string
  /** Absolute path prefix that may be read, e.g. `/opt/zoonestore`. */
  pathPrefix: string
  createdAt: number
  expiresAt: number
}

export interface PathAllowContext {
  scopes: readonly PathAllowScope[]
  vpsId: string
  projectId: string
  /** Clock read at decision time, so a test (and a restart) sees the real expiry. */
  now?: number
}

/** Lexically collapse `.`/`..`, keep an absolute prefix, never return an empty string. */
function normalizeAllowPrefix(prefix: string): string {
  if (typeof prefix !== 'string' || !prefix.trim().startsWith('/')) return ''
  const parts: string[] = []
  for (const part of prefix.trim().split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.length === 0 ? '/' : `/${parts.join('/')}`
}

/** Mint a path allow. The caller supplies the clock so this stays testable. */
export function createPathAllowScope(
  vpsId: string,
  projectId: string,
  pathPrefix: string,
  options: { ttlMs?: number; now?: number; id?: string } = {}
): PathAllowScope {
  const now = options.now ?? Date.now()
  const ttlMs = options.ttlMs ?? PATH_ALLOW_TTL_MS
  const normalized = normalizeAllowPrefix(pathPrefix)
  return {
    id: options.id ?? `allow-scope:${vpsId}:${projectId}:${normalized}:${now}`,
    vpsId,
    projectId,
    pathPrefix: normalized,
    createdAt: now,
    expiresAt: now + ttlMs
  }
}

/**
 * Fail closed: a missing/empty scope, a missing prefix, any mismatch, or an expired scope is
 * invalid. An empty `vpsId`/`projectId` (a local run) can never match a remote allow.
 */
export function isPathAllowScopeValid(
  scope: PathAllowScope,
  context: { vpsId: string; projectId: string },
  now: number = Date.now()
): boolean {
  if (!scope.vpsId || !scope.projectId) return false
  if (scope.vpsId !== context.vpsId) return false
  if (scope.projectId !== context.projectId) return false
  if (normalizeAllowPrefix(scope.pathPrefix) === '') return false
  if (!Number.isFinite(scope.expiresAt)) return false
  return now < scope.expiresAt
}

/** Whether `path` is the allowed prefix itself or lives under it (segment boundary, not text). */
export function pathAllowCovers(scope: PathAllowScope, path: string): boolean {
  const prefix = normalizeAllowPrefix(scope.pathPrefix)
  const target = normalizeAllowPrefix(path)
  if (prefix === '' || target === '') return false
  if (prefix === '/') return true
  return target === prefix || target.startsWith(`${prefix}/`)
}

/**
 * The first valid, unexpired scope that covers `path` — or `undefined`.
 *
 * This is the containment-side API: `enforceProjectPath` calls it inside its own decision, so a
 * scope can only ever widen a read that the secret guard and the `..` rule already passed.
 */
export function matchPathAllowScope(
  scopes: readonly PathAllowScope[],
  path: string,
  context: { vpsId: string; projectId: string },
  now: number = Date.now()
): PathAllowScope | undefined {
  for (const scope of scopes) {
    if (!isPathAllowScopeValid(scope, context, now)) continue
    if (pathAllowCovers(scope, path)) return scope
  }
  return undefined
}

/** Seed scopes from disk, dropping anything unparseable. */
export function parsePathAllowScopes(raw: unknown): PathAllowScope[] {
  if (!Array.isArray(raw)) return []
  const scopes: PathAllowScope[] = []
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const { id, vpsId, projectId, pathPrefix, createdAt, expiresAt } = record
    if (typeof id !== 'string' || typeof vpsId !== 'string' || typeof projectId !== 'string') continue
    if (typeof pathPrefix !== 'string') continue
    if (typeof createdAt !== 'number' || typeof expiresAt !== 'number') continue
    scopes.push({ id, vpsId, projectId, pathPrefix, createdAt, expiresAt })
  }
  return scopes
}

/** The audit line for a scope: `allow-scope <path> until <time>` (S2.3). */
export function pathAllowAuditLine(scope: PathAllowScope): string {
  return `allow-scope ${normalizeAllowPrefix(scope.pathPrefix)} until ${new Date(scope.expiresAt).toISOString()}`
}

/** The audit entry for a scope, ready for `AuditLog.record` / `recordAudit`. */
export function pathAllowAuditEntry(scope: PathAllowScope): {
  type: 'exec'
  ok: true
  serverId: string
  command: string
} {
  return {
    type: 'exec',
    ok: true,
    serverId: scope.vpsId,
    command: pathAllowAuditLine(scope)
  }
}

/** Seed grants from disk, dropping anything unparseable. */
export function parseServerGrants(raw: unknown): ServerGrant[] {
  if (!Array.isArray(raw)) return []
  const grants: ServerGrant[] = []
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const { id, vpsId, projectId, createdAt, expiresAt } = record
    if (typeof id !== 'string' || typeof vpsId !== 'string' || typeof projectId !== 'string') continue
    if (typeof createdAt !== 'number' || typeof expiresAt !== 'number') continue
    grants.push({ id, vpsId, projectId, createdAt, expiresAt })
  }
  return grants
}
