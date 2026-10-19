import { describe, it, expect } from 'vitest'
import {
  connectedServerIds,
  deriveConnectionStatus,
  isServerConnected,
  serverConnectionState,
  CONNECTION_TONE_CLASS,
  type ConnectionInput
} from '../../src/renderer/src/lib/connection-status'
import type { VpsConnectionState } from '@shared/vps'

const servers = [
  { id: 'vps-1', name: 'prod-box' } as unknown as ConnectionInput['vpsServers'][number],
  { id: 'vps-2', name: 'staging-box' } as unknown as ConnectionInput['vpsServers'][number]
]

const connected = (serverId: string): VpsConnectionState => ({ status: 'connected', serverId })

function input(overrides: Partial<ConnectionInput> = {}): ConnectionInput {
  return {
    ready: true,
    workerOnline: true,
    project: { type: 'local', path: '/home/me/app' },
    vpsStates: {},
    vpsServers: servers,
    ...overrides
  }
}

/**
 * v2.6.0, D.1 - a single connection verdict. Every state must be expressed by
 * icon + label + tone (never colour alone), and remote/local must not be
 * conflated.
 *
 * R5: the verdict is derived per server, from `vpsStates`. The singular `vpsStatus` this file
 * used to feed in was the last server that changed, which is exactly how one connected server
 * repainted another one as disconnected in the screenshots.
 */
describe('v2.6.0 D.1 - deriveConnectionStatus', () => {
  it('1. reports initializing until the app is ready', () => {
    const status = deriveConnectionStatus(input({ ready: false }))
    expect(status.kind).toBe('initializing')
    expect(status.labelKey).toBe('connection.initializing')
  })

  it('2. reports the offline worker as an error, not a healthy local workspace', () => {
    const status = deriveConnectionStatus(input({ workerOnline: false }))
    expect(status.kind).toBe('offline')
    expect(status.tone).toBe('bad')
  })

  it('3. a local project is connected to the local workspace', () => {
    const status = deriveConnectionStatus(input())
    expect(status.kind).toBe('local')
    expect(status.tone).toBe('ok')
    expect(status.detail).toBe('/home/me/app')
  })

  it('4. a remote project reflects its own server lifecycle and names the server', () => {
    const remote = { type: 'remote' as const, path: '/srv/api', vpsId: 'vps-1' }
    expect(
      deriveConnectionStatus(input({ project: remote, vpsStates: { 'vps-1': connected('vps-1') } }))
    ).toMatchObject({ kind: 'connected', tone: 'ok', detail: 'prod-box' })
    expect(
      deriveConnectionStatus(
        input({ project: remote, vpsStates: { 'vps-1': { status: 'connecting', serverId: 'vps-1' } } })
      )
    ).toMatchObject({ kind: 'connecting', tone: 'warn' })
    expect(
      deriveConnectionStatus(
        input({
          project: remote,
          vpsStates: { 'vps-1': { status: 'error', serverId: 'vps-1', error: 'auth failed' } }
        })
      )
    ).toMatchObject({ kind: 'error', tone: 'bad', detail: 'auth failed' })
    expect(
      deriveConnectionStatus(
        input({ project: remote, vpsStates: { 'vps-1': { status: 'disconnected', serverId: 'vps-1' } } })
      )
    ).toMatchObject({ kind: 'disconnected', tone: 'bad' })
  })

  it('5. a remote project connected to a different server is still disconnected', () => {
    const status = deriveConnectionStatus(
      input({
        project: { type: 'remote', path: '/srv/api', vpsId: 'vps-1' },
        vpsStates: { 'vps-2': connected('vps-2') }
      })
    )
    expect(status.kind).toBe('disconnected')
  })

  it('6. every tone maps to its own colour class', () => {
    expect(new Set(Object.values(CONNECTION_TONE_CLASS)).size).toBe(4)
  })

  it('7. (v2.6.4) a remote project stays connected while another host changed last', () => {
    const status = deriveConnectionStatus(
      input({
        project: { type: 'remote', path: '/srv/api', vpsId: 'vps-1' },
        vpsStates: { 'vps-1': connected('vps-1'), 'vps-2': connected('vps-2') }
      })
    )
    expect(status.kind).toBe('connected')
  })

  it('8. (v2.6.4) an error on another server does not mark this project errored', () => {
    const status = deriveConnectionStatus(
      input({
        project: { type: 'remote', path: '/srv/api', vpsId: 'vps-1' },
        vpsStates: {
          'vps-1': connected('vps-1'),
          'vps-2': { status: 'error', serverId: 'vps-2', error: 'boom' }
        }
      })
    )
    expect(status.kind).toBe('connected')
  })

  it('9. (v2.6.4) a dropped connection reports disconnected even if another server is connected', () => {
    const status = deriveConnectionStatus(
      input({
        project: { type: 'remote', path: '/srv/api', vpsId: 'vps-1' },
        vpsStates: {
          'vps-1': { status: 'disconnected', serverId: 'vps-1' },
          'vps-2': connected('vps-2')
        }
      })
    )
    expect(status.kind).toBe('disconnected')
  })
})

describe('R5 - the per-server map is the only source of truth', () => {
  it('10. two connected servers are both in the connected set', () => {
    const states = { 'vps-1': connected('vps-1'), 'vps-2': connected('vps-2') }
    expect(connectedServerIds(states).sort()).toEqual(['vps-1', 'vps-2'])
    expect(isServerConnected('vps-1', states)).toBe(true)
    expect(isServerConnected('vps-2', states)).toBe(true)
  })

  it('11. disconnecting one keeps the other connected, per server', () => {
    const states = {
      'vps-1': { status: 'disconnected', serverId: 'vps-1' } as VpsConnectionState,
      'vps-2': connected('vps-2')
    }
    expect(connectedServerIds(states)).toEqual(['vps-2'])
    expect(isServerConnected('vps-1', states)).toBe(false)
    expect(isServerConnected('vps-2', states)).toBe(true)
    expect(serverConnectionState('vps-2', states).status).toBe('connected')
  })

  it('12. an explicit per-server fact beats the stale connected set (same-tick update)', () => {
    // The set main reported has not answered yet; the liveness fact already says disconnected.
    const states = { 'vps-1': { status: 'disconnected', serverId: 'vps-1' } as VpsConnectionState }
    const seed = ['vps-1', 'vps-2']
    expect(connectedServerIds(states, seed)).toContain('vps-2')
    expect(connectedServerIds(states, seed)).not.toContain('vps-1')
    const status = deriveConnectionStatus(
      input({
        project: { type: 'remote', path: '/srv/api', vpsId: 'vps-1' },
        vpsStates: states,
        vpsConnected: seed
      })
    )
    expect(status.kind).toBe('disconnected')
  })

  it('13. the connected set is only a seed for a server with no event yet', () => {
    expect(isServerConnected('vps-2', {}, ['vps-2'])).toBe(true)
    expect(isServerConnected('vps-1', {}, ['vps-2'])).toBe(false)
    expect(isServerConnected(undefined, {}, ['vps-2'])).toBe(false)
  })
})
