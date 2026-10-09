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
  status: VpsConnectionState
): VpsIndicator {
  if (!activeVpsId) return 'off'
  if (status.status === 'connecting') return 'connecting'
  if (status.status === 'error') return 'error'
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
