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
  ok: 'text-emerald-400',
  warn: 'text-amber-400',
  bad: 'text-red-400',
  muted: 'text-neutral-500'
}

export interface ConnectionInput {
  ready: boolean
  workerOnline: boolean
  project?: { type: 'local' | 'remote'; path: string; vpsId?: string }
  vpsStatus: VpsConnectionState
  vpsServers: VpsServerView[]
}

/** Pure derivation, so it can be unit-tested without mounting React. */
export function deriveConnectionStatus(input: ConnectionInput): ConnectionStatus {
  const { ready, workerOnline, project, vpsStatus, vpsServers } = input

  if (!ready) {
    return { kind: 'initializing', tone: 'warn', labelKey: 'connection.initializing', detail: '' }
  }
  if (!workerOnline) {
    return { kind: 'offline', tone: 'bad', labelKey: 'connection.workerOffline', detail: '' }
  }
  if (project?.type === 'remote') {
    const serverId = project.vpsId
    const name = vpsServerName(vpsServers, serverId) ?? serverId ?? ''
    if (vpsStatus.status === 'connecting') {
      return { kind: 'connecting', tone: 'warn', labelKey: 'connection.connecting', detail: name, serverId }
    }
    if (vpsStatus.status === 'error') {
      return {
        kind: 'error',
        tone: 'bad',
        labelKey: 'connection.error',
        detail: vpsStatus.error ?? name,
        serverId
      }
    }
    if (vpsStatus.status === 'connected' && vpsStatus.serverId === serverId) {
      return { kind: 'connected', tone: 'ok', labelKey: 'connection.connected', detail: name, serverId }
    }
    return {
      kind: 'disconnected',
      tone: 'bad',
      labelKey: 'connection.disconnected',
      detail: name,
      serverId
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
  const vpsStatus = useStore((state) => state.vpsStatus)
  const vpsServers = useStore((state) => state.vpsServers)

  const active = settings?.projects.find((project) => project.id === settings.activeProjectId)
  const project =
    active && (active.type === 'local' || active.type === 'remote')
      ? { type: active.type, path: active.path, vpsId: active.vpsId }
      : undefined

  const status = deriveConnectionStatus({
    ready,
    workerOnline: worker?.online ?? true,
    project,
    vpsStatus,
    vpsServers
  })

  if (projectMissing) {
    return { ...status, tone: 'warn', kind: 'local', labelKey: 'connection.missing' }
  }
  return status
}
