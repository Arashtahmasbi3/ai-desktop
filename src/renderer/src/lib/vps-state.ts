import type { VpsConnectionState, VpsServerView } from '@shared/vps'

/**
 * The connection state the UI should show for the *selected* VPS. The main
 * process reports a single {@link VpsConnectionState}; the UI derives the
 * indicator for the VPS it is currently pointing at.
 */
export type VpsIndicator = 'off' | 'connected' | 'connecting' | 'disconnected' | 'error'

export const VPS_RECONNECT_KEY = 'last-active-vps'

/** Derive the indicator for the active VPS from the single main-process state. */
export function vpsIndicator(
  activeVpsId: string | undefined | null,
  status: VpsConnectionState,
  /**
   * v2.6.4: every connected server id. When provided, the selected server's
   * indicator is decided by whether *it* is connected, not by whichever server
   * the single global status last touched (multi-connection).
   */
  connectedServers?: string[]
): VpsIndicator {
  if (!activeVpsId) return 'off'
  if (status.status === 'connecting' && status.serverId === activeVpsId) return 'connecting'
  if (status.status === 'error' && status.serverId === activeVpsId) return 'error'
  if (connectedServers) {
    return connectedServers.includes(activeVpsId) ? 'connected' : 'disconnected'
  }
  if (status.status === 'connected' && status.serverId === activeVpsId) return 'connected'
  return 'disconnected'
}

/** Display name of a saved server, or undefined when it is unknown. */
export function vpsServerName(
  servers: VpsServerView[],
  id: string | undefined | null
): string | undefined {
  if (!id) return undefined
  return servers.find((server) => server.id === id)?.name
}

/**
 * The connection state to show for ONE server (v2.8.0).
 *
 * `vpsStatus` is a single slot and every `vps:status` event overwrites it, so with
 * two servers connected it names whichever changed last — and every other server
 * rendered as disconnected. That is the reported bug: "when I connect one, the other
 * gets disconnected". No socket was ever closed; only the display was wrong.
 *
 * Order of authority:
 *  1. membership in the main process's connected set (authoritative, per server),
 *  2. this server's own last known state (the v2.6.5 `vpsStates` map),
 *  3. the global slot, but only when it is actually about this server.
 */
export function vpsStateFor(
  serverId: string | undefined | null,
  states: Record<string, VpsConnectionState>,
  connected: readonly string[],
  globalStatus: VpsConnectionState
): VpsConnectionState {
  if (!serverId) return globalStatus
  if (connected.includes(serverId)) return { status: 'connected', serverId }
  const known = states[serverId]
  if (known) return known
  return globalStatus.serverId === serverId ? globalStatus : { status: 'disconnected' }
}

/**
 * Pick the VPS to auto-reconnect on startup: the last active id, but only when
 * that server still exists in the saved list.
 */
export function resolveReconnectId(
  servers: VpsServerView[],
  lastActiveId: string | null | undefined
): string | undefined {
  if (!lastActiveId) return undefined
  return servers.some((server) => server.id === lastActiveId) ? lastActiveId : undefined
}

/** Read the last active VPS id persisted by the store (best-effort). */
export function readLastVpsId(): string | undefined {
  try {
    return globalThis.localStorage?.getItem(VPS_RECONNECT_KEY) ?? undefined
  } catch {
    return undefined
  }
}

/**
 * Every server the app should keep connected: each remote project's own VPS,
 * plus the chat-header selection. v2.6.4 multi-connection — switching projects
 * must not drop another project's host, so they are all kept up in the
 * background rather than only the currently-selected one.
 */
export function remoteVpsIds(
  projects: readonly { type?: string; vpsId?: string }[],
  explicitVpsId?: string | undefined
): string[] {
  const ids = new Set<string>()
  for (const project of projects) {
    if (project.type === 'remote' && project.vpsId) ids.add(project.vpsId)
  }
  if (explicitVpsId) ids.add(explicitVpsId)
  return [...ids]
}

/**
 * Every server the renderer should send `vps:keepAlive` for (v2.8.0).
 *
 * The main process reaps a connection that has been idle for 30 minutes, and the
 * renderer's keep-alive only covered `remoteVpsIds(...)`. A server the user
 * connected **by hand** in the Servers view, and which is not attached to a remote
 * project or selected in the chat header, therefore got no keep-alive and was really
 * disconnected — the second half of "the others need reconnecting".
 *
 * Tradeoff, stated plainly: a manually connected and then forgotten server now stays
 * open instead of being reaped. That is the behaviour the user asked for — an
 * explicit Connect is deliberate — and the 30-minute reaper still covers anything the
 * renderer has stopped asking about. Reverting is a one-line change to this function.
 */
export function keepAliveIds(
  projects: readonly { type?: string; vpsId?: string }[],
  explicitVpsId: string | undefined,
  connected: readonly string[]
): string[] {
  const ids = new Set(remoteVpsIds(projects, explicitVpsId))
  for (const id of connected) ids.add(id)
  return [...ids]
}
