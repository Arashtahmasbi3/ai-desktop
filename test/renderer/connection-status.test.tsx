import { describe, it, expect } from 'vitest'
import {
  deriveConnectionStatus,
  CONNECTION_TONE_CLASS,
  type ConnectionInput
} from '../../src/renderer/src/lib/connection-status'
import type { VpsConnectionState } from '@shared/vps'

const servers = [
  { id: 'vps-1', name: 'prod-box' } as unknown as ConnectionInput['vpsServers'][number]
]

function input(overrides: Partial<ConnectionInput> = {}): ConnectionInput {
  return {
    ready: true,
    workerOnline: true,
    project: { type: 'local', path: '/home/me/app' },
    vpsStatus: { status: 'disconnected' } as VpsConnectionState,
    vpsServers: servers,
    ...overrides
  }
}

/**
 * v2.6.0, D.1 - a single connection verdict. Every state must be expressed by
 * icon + label + tone (never colour alone), and remote/local must not be
 * conflated.
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

  it('4. a remote project reflects the VPS lifecycle and names the server', () => {
    const remote = { type: 'remote' as const, path: '/srv/api', vpsId: 'vps-1' }
    expect(
      deriveConnectionStatus(input({ project: remote, vpsStatus: { status: 'connected', serverId: 'vps-1' } }))
    ).toMatchObject({ kind: 'connected', tone: 'ok', detail: 'prod-box' })
    expect(
      deriveConnectionStatus(input({ project: remote, vpsStatus: { status: 'connecting' } }))
    ).toMatchObject({ kind: 'connecting', tone: 'warn' })
    expect(
      deriveConnectionStatus(input({ project: remote, vpsStatus: { status: 'error', error: 'auth failed' } }))
    ).toMatchObject({ kind: 'error', tone: 'bad', detail: 'auth failed' })
    expect(
      deriveConnectionStatus(input({ project: remote, vpsStatus: { status: 'disconnected' } }))
    ).toMatchObject({ kind: 'disconnected', tone: 'bad' })
  })

  it('5. a remote project connected to a different server is still disconnected', () => {
    const status = deriveConnectionStatus(
      input({
        project: { type: 'remote', path: '/srv/api', vpsId: 'vps-1' },
        vpsStatus: { status: 'connected', serverId: 'vps-2' }
      })
    )
    expect(status.kind).toBe('disconnected')
  })

  it('6. every tone maps to its own colour class', () => {
    expect(new Set(Object.values(CONNECTION_TONE_CLASS)).size).toBe(4)
  })
})
