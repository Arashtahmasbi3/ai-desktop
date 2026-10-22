/**
 * S2.3 — the time-boxed one-shot allow for the file tools.
 *
 * The refusal offers "allow this path once". This is that promise kept, and it reuses the
 * scoped-grant pattern the app already has (`server-grant.ts`): a scope is bound to ONE path
 * prefix, ONE server and ONE project, it expires, and expiry is evaluated on read — never by a
 * timer, so a stale file cannot resurrect it.
 *
 * The check sits INSIDE the containment decision (`enforceProjectPath`), so the deny list, the
 * secret-path guard and the `..` rule are untouched: this widens a read of one folder that already
 * passed those, and it is recorded in the SSH audit log as `allow-scope <path> until <time>`.
 */
import { describe, expect, it } from 'vitest'
import type { VpsExecResult } from '@shared/vps'
import {
  PATH_ALLOW_TTL_MS,
  createPathAllowScope,
  isPathAllowScopeValid,
  matchPathAllowScope,
  parsePathAllowScopes,
  pathAllowAuditEntry,
  pathAllowAuditLine
} from '../../src/core/agent/server-grant'
import { enforceProjectPath } from '../../src/core/remote/path-guard'
import { executeRemoteFs, type RemoteFsDeps } from '../../src/core/tools/remote-fs-tools'

const ROOT = '/opt/sepehr-motor'
const SERVER = 'srv-1'
const PROJECT = 'project-1'
const T0 = 1_760_000_000_000

function allow(prefix = '/opt/zoonestore', now = T0): ReturnType<typeof createPathAllowScope> {
  return createPathAllowScope(SERVER, PROJECT, prefix, { now })
}

describe('S2.3 — the scope itself', () => {
  it('is bound to one path prefix, one server, one project and a TTL', () => {
    const scope = allow()
    expect(scope.vpsId).toBe(SERVER)
    expect(scope.projectId).toBe(PROJECT)
    expect(scope.pathPrefix).toBe('/opt/zoonestore')
    expect(scope.expiresAt - scope.createdAt).toBe(PATH_ALLOW_TTL_MS)
    expect(PATH_ALLOW_TTL_MS).toBeLessThanOrEqual(30 * 60 * 1000)
  })

  it('expires on read, not on a timer', () => {
    const scope = allow()
    expect(isPathAllowScopeValid(scope, { vpsId: SERVER, projectId: PROJECT }, T0)).toBe(true)
    expect(
      isPathAllowScopeValid(scope, { vpsId: SERVER, projectId: PROJECT }, scope.expiresAt - 1)
    ).toBe(true)
    expect(isPathAllowScopeValid(scope, { vpsId: SERVER, projectId: PROJECT }, scope.expiresAt)).toBe(
      false
    )
  })

  it('never matches another server, another project or an empty scope', () => {
    const scope = allow()
    expect(matchPathAllowScope([scope], '/opt/zoonestore/x', { vpsId: 'other', projectId: PROJECT }, T0)).toBeUndefined()
    expect(matchPathAllowScope([scope], '/opt/zoonestore/x', { vpsId: SERVER, projectId: 'other' }, T0)).toBeUndefined()
    const empty = createPathAllowScope('', '', '/opt/zoonestore', { now: T0 })
    expect(matchPathAllowScope([empty], '/opt/zoonestore/x', { vpsId: SERVER, projectId: PROJECT }, T0)).toBeUndefined()
  })

  it('matches a prefix, never a sibling that merely shares the text', () => {
    const scope = allow('/opt/zoonestore/')
    expect(matchPathAllowScope([scope], '/opt/zoonestore', { vpsId: SERVER, projectId: PROJECT }, T0)).toBeDefined()
    expect(matchPathAllowScope([scope], '/opt/zoonestore/apps', { vpsId: SERVER, projectId: PROJECT }, T0)).toBeDefined()
    expect(matchPathAllowScope([scope], '/opt/zoonestore2', { vpsId: SERVER, projectId: PROJECT }, T0)).toBeUndefined()
    expect(matchPathAllowScope([scope], '/opt/zoonestore-evil/x', { vpsId: SERVER, projectId: PROJECT }, T0)).toBeUndefined()
  })
})

describe('S2.3 — the audit line', () => {
  it('reads `allow-scope <path> until <time>`', () => {
    const scope = allow()
    const line = pathAllowAuditLine(scope)
    expect(line).toBe(`allow-scope /opt/zoonestore until ${new Date(scope.expiresAt).toISOString()}`)
    const entry = pathAllowAuditEntry(scope)
    expect(entry).toMatchObject({ type: 'exec', ok: true, serverId: SERVER })
    expect(entry.command).toBe(line)
  })
})

describe('S2.3 — checked inside the containment decision', () => {
  const context = { scopes: [allow()], vpsId: SERVER, projectId: PROJECT, now: T0 + 1000 }

  it('admits a read under the allowed prefix', () => {
    const result = enforceProjectPath('/opt/zoonestore/apps', ROOT, null, 'read', context)
    expect(result.ok).toBe(true)
    expect(result.source).toBe('allow-scope')
    expect(result.resolvedPath).toBe('/opt/zoonestore/apps')
  })

  it('is blocked again once it expires', () => {
    const expired = { ...context, now: T0 + PATH_ALLOW_TTL_MS }
    expect(enforceProjectPath('/opt/zoonestore/apps', ROOT, null, 'read', expired).ok).toBe(false)
  })

  it('does not admit a write, and does not admit a neighbouring folder', () => {
    expect(enforceProjectPath('/opt/zoonestore/apps/x', ROOT, null, 'write', context).ok).toBe(false)
    expect(enforceProjectPath('/opt/zoonestore2/x', ROOT, null, 'read', context).ok).toBe(false)
  })

  it('leaves the secret guard and containment in front of it', async () => {
    const deps = fsDeps(() => T0 + 1000)
    const env = await executeRemoteFs(deps, 'remote_read_file', {
      server_id: SERVER,
      path: '/opt/zoonestore/.env'
    })
    expect(env.ok).toBe(false)
    // A scope for one prefix must not become a scope for the machine.
    const elsewhere = await executeRemoteFs(deps, 'remote_read_file', {
      server_id: SERVER,
      path: '/opt/other/package.json'
    })
    expect(elsewhere.ok).toBe(false)
    expect(elsewhere.blocked).toBe(true)
  })
})

function fsDeps(now?: () => number): RemoteFsDeps & { reads: string[]; audits: string[] } {
  const reads: string[] = []
  const audits: string[] = []
  const deps: RemoteFsDeps & { reads: string[]; audits: string[] } = {
    reads,
    audits,
    connectedServers: () => [SERVER],
    projectRoot: ROOT,
    projectId: PROJECT,
    pathAllows: () => [allow()],
    readFile: async (_serverId, path) => {
      reads.push(path)
      return 'content'
    },
    writeFile: async () => undefined,
    listFiles: async () => [],
    exec: async (): Promise<VpsExecResult> => ({ ok: true, stdout: '', stderr: '', exitCode: 0 }),
    audit: async (entry) => {
      if (entry.command) audits.push(entry.command)
    }
  }
  if (now) deps.now = now
  return deps
}

describe('S2.3 — the file tool uses the scope and audits it', () => {
  it('reads the allowed folder and records the scope', async () => {
    const deps = fsDeps(() => T0 + 1000)
    const result = await executeRemoteFs(deps, 'remote_read_file', {
      server_id: SERVER,
      path: '/opt/zoonestore/package.json'
    })
    expect(result.ok).toBe(true)
    expect(deps.reads).toEqual(['/opt/zoonestore/package.json'])
    const scopeLine = deps.audits.find((command) => command.startsWith('allow-scope '))
    expect(scopeLine).toBe(`allow-scope /opt/zoonestore until ${new Date(T0 + PATH_ALLOW_TTL_MS).toISOString()}`)
  })

  it('blocks the same read after the scope expired', async () => {
    const deps = fsDeps(() => T0 + PATH_ALLOW_TTL_MS)
    const result = await executeRemoteFs(deps, 'remote_read_file', {
      server_id: SERVER,
      path: '/opt/zoonestore/package.json'
    })
    expect(result.ok).toBe(false)
    expect(result.blocked).toBe(true)
    expect(deps.reads).toEqual([])
    expect(deps.audits).toEqual([])
  })
})

describe('S2.3 — persisted scopes are parsed defensively', () => {
  it('drops anything unparseable and keeps a valid scope', () => {
    const valid = allow()
    const parsed = parsePathAllowScopes([valid, null, {}, { id: 1 }, { ...valid, expiresAt: 'soon' }])
    expect(parsed).toHaveLength(1)
    expect(parsed[0]!.pathPrefix).toBe('/opt/zoonestore')
  })

  it('returns no scopes for a non-array payload', () => {
    expect(parsePathAllowScopes(undefined)).toEqual([])
    expect(parsePathAllowScopes({ scopes: [] })).toEqual([])
  })
})
