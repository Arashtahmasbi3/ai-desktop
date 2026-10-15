/**
 * Server references by id, name or host (v2.8.1).
 *
 * Reported: the agent demanded a "server UUID" for a migration and told the user to copy
 * it out of a panel that never shows one. Two structural causes — nothing enumerated the
 * saved servers (`list_servers` fixes that) and every id-taking tool resolved by *exact
 * id*, so a name or host was rejected even though it is what the user and the model
 * actually know.
 *
 * This module is the single place that name/host matching lives. It is pure: it resolves
 * against a roster handed in by the caller, so it is testable with no SSH and no store.
 *
 * Safety rules, deliberately:
 *  - an exact id always wins, and ids are compared case-sensitively (they are UUIDs);
 *  - matching is otherwise case-insensitive on name and host;
 *  - an ambiguous or unknown reference FAILS with the candidate list — it never picks the
 *    first match, because silently migrating to the wrong server is the worst outcome;
 *  - resolution is read-only and never selects the host a run is pinned to.
 */
export interface ServerRefTarget {
  id: string
  name: string
  host: string
  port: number
  username: string
}

export type ServerRefMatch =
  | { ok: true; server: ServerRefTarget; matchedBy: 'id' | 'name' | 'host' }
  | { ok: false; error: string; candidates: readonly ServerRefTarget[] }

/** The argument names the model uses to point a tool at a server. */
export const SERVER_REF_ARGS = ['server_id', 'source_vps_id', 'target_vps_id'] as const

export type ServerRefArg = (typeof SERVER_REF_ARGS)[number]

function describe(server: ServerRefTarget): string {
  return `${server.name} (id: ${server.id}) ${server.username}@${server.host}:${server.port}`
}

/** `host` or `host:port`, compared case-insensitively. */
function matchesHost(server: ServerRefTarget, wanted: string): boolean {
  const host = server.host.toLowerCase()
  return host === wanted || `${host}:${server.port}` === wanted
}

/**
 * Resolve one reference against the roster.
 *
 * `requireConnected` is for tools that can only run against an open connection; the
 * candidate list is always returned on failure so the model can correct itself instead
 * of asking the user for an id.
 */
export function resolveServerRef(
  ref: string,
  servers: readonly ServerRefTarget[],
  options: { requireConnected?: boolean; connected?: readonly string[] } = {}
): ServerRefMatch {
  const wanted = ref.trim()
  if (wanted === '') {
    return { ok: false, error: 'A server id, name or host is required.', candidates: [] }
  }

  const connected = options.connected ?? []
  /** A known server that is simply offline deserves its own, precise error. */
  const accept = (server: ServerRefTarget, matchedBy: 'id' | 'name' | 'host'): ServerRefMatch => {
    if (options.requireConnected && !connected.includes(server.id)) {
      return {
        ok: false,
        error: `${describe(server)} is not connected. Connect it first.`,
        candidates: servers
      }
    }
    return { ok: true, server, matchedBy }
  }

  // Matching always runs against the FULL roster, so "known but offline" is distinguishable
  // from "unknown" — otherwise a disconnected server reported "no such server" and the
  // model would go hunting for a different id instead of asking the user to connect it.

  // 1. Exact id. Never second-guessed.
  const byId = servers.find((server) => server.id === wanted)
  if (byId) return accept(byId, 'id')

  const lowered = wanted.toLowerCase()

  const byName = servers.filter((server) => server.name.toLowerCase() === lowered)
  if (byName.length === 1) return accept(byName[0]!, 'name')
  if (byName.length > 1) {
    return {
      ok: false,
      error:
        `"${wanted}" matches ${byName.length} servers by name. Use the id instead: ` +
        byName.map((server) => `${server.name} (id: ${server.id})`).join(', '),
      candidates: byName
    }
  }

  const byHost = servers.filter((server) => matchesHost(server, lowered))
  if (byHost.length === 1) return accept(byHost[0]!, 'host')
  if (byHost.length > 1) {
    return {
      ok: false,
      error:
        `"${wanted}" matches ${byHost.length} servers by host. Use the id instead: ` +
        byHost.map((server) => `${server.name} (id: ${server.id})`).join(', '),
      candidates: byHost
    }
  }

  return {
    ok: false,
    error: `No saved server matches "${wanted}".`,
    candidates: servers
  }
}

/**
 * The sentence appended to a failed resolution. Listing the roster is the whole point:
 * the model must be able to retry without asking the user for an id it cannot see.
 */
export function formatServerRefFailure(match: Extract<ServerRefMatch, { ok: false }>): string {
  if (match.candidates.length === 0) return match.error
  return `${match.error} Saved servers: ${match.candidates.map(describe).join('; ')}`
}
