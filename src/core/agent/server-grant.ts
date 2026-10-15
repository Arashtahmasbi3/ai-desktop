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
