import type { VpsConnectionState, VpsServerView } from '@shared/vps'
import { vpsServerName } from './vps-state'
import { useStore } from '../store'

/**
 * One connection verdict for every surface (v2.6.0, D.1).
 *
 * The header, status bar, project cards and workspace badge used to each
 * re-derive "are we connected?" from a different mix of `ready`, `worker` and
 * `vpsStatus`, so they could disagree. They now share this single source of
 * truth, which encodes state in an icon *and* a label *and* a colour rather
 * than colour alone.
 *
 * R5: the truth is **per server**. The verdict used to read the singular
 * `vpsStatus`, which is the last server that changed, so a second connection
 * overwrote the first one's display. It now reads `vpsStates` — the map the
 * liveness event writes — and nothing else can answer for a server.
 */
export type ConnectionKind =
  | 'initializing'
  | 'local'
  | 'connected'
  | 'connecting'
  | 'error'
  | 'disconnected'
  | 'offline'

export type ConnectionTone = 'ok' | 'warn' | 'bad' | 'muted'

export interface ConnectionStatus {
  kind: ConnectionKind
  tone: ConnectionTone
  /** i18n key under the `connection` namespace describing the state. */
  labelKey: string
  /** Target of the connection (server name or workspace path) for the tooltip. */
  detail: string
  serverId?: string
}

/** Tailwind text colour for a tone (paired with an icon + label, never alone). */
export const CONNECTION_TONE_CLASS: Record<ConnectionTone, string> = {
  ok: 'text-success',
  warn: 'text-warning',
  bad: 'text-danger',
  muted: 'text-fg-muted'
}

export interface ConnectionInput {
  ready: boolean
  workerOnline: boolean
  project?: { type: 'local' | 'remote'; path: string; vpsId?: string }
  /** Per-server connection state. The only source of truth for "which servers are connected". */
  vpsStates: Record<string, VpsConnectionState>
  vpsServers: VpsServerView[]
  /**
   * The connected set main reported. Used only as a seed for a server with no entry in
   * `vpsStates` yet (right after a refresh, or before its first event); an explicit state
   * always wins, so a disconnect is visible in the same tick.
   */
  vpsConnected?: string[]
}

/**
 * The connection fact for ONE server.
 *
 * Order of authority: this server's own state (authoritative — it is what the liveness event
 * wrote), then the connected set as a seed, then "disconnected". No other server's state and no
 * global slot can answer for it.
 */
export function serverConnectionState(
  serverId: string,
  states: Record<string, VpsConnectionState>,
  seed: readonly string[] = []
): VpsConnectionState {
  const known = states[serverId]
  if (known) return known
  return seed.includes(serverId)
    ? { status: 'connected', serverId }
    : { status: 'disconnected', serverId }
}

/** True when this one server is connected. The header dot, banner and tree dot all read this. */
export function isServerConnected(
  serverId: string | undefined | null,
  states: Record<string, VpsConnectionState>,
  seed: readonly string[] = []
): boolean {
  if (!serverId) return false
  return serverConnectionState(serverId, states, seed).status === 'connected'
}

/** Every connected server id, decided per server (the connected set is only a seed). */
export function connectedServerIds(
  states: Record<string, VpsConnectionState>,
  seed: readonly string[] = []
): string[] {
  const connected = new Set(seed)
  for (const [serverId, state] of Object.entries(states)) {
    if (state.status === 'connected') connected.add(serverId)
    else connected.delete(serverId)
  }
  return [...connected]
}

/** Pure derivation, so it can be unit-tested without mounting React. */
export function deriveConnectionStatus(input: ConnectionInput): ConnectionStatus {
  const { ready, workerOnline, project, vpsServers } = input

  if (!ready) {
    return { kind: 'initializing', tone: 'warn', labelKey: 'connection.initializing', detail: '' }
  }
  if (!workerOnline) {
    return { kind: 'offline', tone: 'bad', labelKey: 'connection.workerOffline', detail: '' }
  }
  if (project?.type === 'remote') {
    const serverId = project.vpsId
    const name = vpsServerName(vpsServers, serverId) ?? serverId ?? ''
    // R5: only this project's own server answers. A transient state that names another host
    // must never mark this project as connecting/errored/disconnected on its behalf.
    const state = serverId
      ? serverConnectionState(serverId, input.vpsStates, input.vpsConnected)
      : ({ status: 'disconnected' } as VpsConnectionState)
    if (state.status === 'connecting') {
      return {
        kind: 'connecting',
        tone: 'warn',
        labelKey: 'connection.connecting',
        detail: name,
        ...(serverId ? { serverId } : {})
      }
    }
    if (state.status === 'error') {
      return {
        kind: 'error',
        tone: 'bad',
        labelKey: 'connection.error',
        detail: state.error ?? name,
        ...(serverId ? { serverId } : {})
      }
    }
    if (state.status === 'connected') {
      return {
        kind: 'connected',
        tone: 'ok',
        labelKey: 'connection.connected',
        detail: name,
        ...(serverId ? { serverId } : {})
      }
    }
    return {
      kind: 'disconnected',
      tone: 'bad',
      labelKey: 'connection.disconnected',
      detail: name,
      ...(serverId ? { serverId } : {})
    }
  }
  return { kind: 'local', tone: 'ok', labelKey: 'connection.local', detail: project?.path ?? '' }
}

/** The shared connection status for the active project and background worker. */
export function useConnectionStatus(): ConnectionStatus {
  const ready = useStore((state) => state.ready)
  const worker = useStore((state) => state.worker)
  const settings = useStore((state) => state.settings)
  const projectMissing = useStore((state) => state.projectMissing)
  const vpsStates = useStore((state) => state.vpsStates)
  const vpsServers = useStore((state) => state.vpsServers)
  const vpsConnected = useStore((state) => state.vpsConnected)

  const active = settings?.projects.find((project) => project.id === settings.activeProjectId)
  const project =
    active && (active.type === 'local' || active.type === 'remote')
      ? { type: active.type, path: active.path, vpsId: active.vpsId }
      : undefined

  const status = deriveConnectionStatus({
    ready,
    workerOnline: worker?.online ?? true,
    project,
    vpsStates,
    vpsServers,
    vpsConnected
  })

  if (projectMissing) {
    return { ...status, tone: 'warn', kind: 'local', labelKey: 'connection.missing' }
  }
  return status
}
