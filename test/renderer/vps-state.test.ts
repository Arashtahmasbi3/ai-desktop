import { describe, it, expect, afterEach } from 'vitest'
import {
  readLastVpsId,
  remoteVpsIds,
  resolveReconnectId,
  vpsIndicator,
  vpsServerName,
  VPS_RECONNECT_KEY
} from '../../src/renderer/src/lib/vps-state'
import type { VpsConnectionState, VpsServerView } from '@shared/vps'

function server(id: string, name = id): VpsServerView {
  return {
    id,
    name,
    host: '10.0.0.1',
    port: 22,
    username: 'root',
    authType: 'password',
    hasPassword: true,
    hasPrivateKey: false,
    createdAt: 0,
    updatedAt: 0
  }
}

describe('vpsIndicator (Task A.4)', () => {
  it('is off when no VPS is selected', () => {
    expect(vpsIndicator(undefined, { status: 'connected', serverId: 'a' })).toBe('off')
  })

  it('is connected only when the selected server is the connected one', () => {
    expect(vpsIndicator('a', { status: 'connected', serverId: 'a' })).toBe('connected')
  })

  it('is disconnected when a different server holds the connection', () => {
    expect(vpsIndicator('a', { status: 'connected', serverId: 'b' })).toBe('disconnected')
    expect(vpsIndicator('a', { status: 'disconnected' })).toBe('disconnected')
  })

  it('surfaces connecting and error states', () => {
    expect(vpsIndicator('a', { status: 'connecting', serverId: 'a' })).toBe('connecting')
    expect(vpsIndicator('a', { status: 'error', serverId: 'a', error: 'boom' })).toBe('error')
  })
})

describe('vpsServerName (Task A.4)', () => {
  it('resolves a saved server name and tolerates unknown ids', () => {
    const servers = [server('a', 'Production'), server('b')]
    expect(vpsServerName(servers, 'a')).toBe('Production')
    expect(vpsServerName(servers, 'ghost')).toBeUndefined()
    expect(vpsServerName(servers, undefined)).toBeUndefined()
  })
})

describe('resolveReconnectId (Task A.4)', () => {
  it('reconnects the last active server when it still exists', () => {
    expect(resolveReconnectId([server('a'), server('b')], 'b')).toBe('b')
  })

  it('skips a last active server that was deleted', () => {
    expect(resolveReconnectId([server('a')], 'gone')).toBeUndefined()
  })

  it('returns undefined without a stored id', () => {
    expect(resolveReconnectId([server('a')], null)).toBeUndefined()
  })
})

describe('readLastVpsId (Task A.4)', () => {
  const original = globalThis.localStorage

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: original, configurable: true })
  })

  it('reads the persisted id and returns undefined when absent', () => {
    const store = new Map<string, string>([[VPS_RECONNECT_KEY, 'vps-42']])
    Object.defineProperty(globalThis, 'localStorage', {
      value: { getItem: (k: string) => store.get(k) ?? null },
      configurable: true
    })
    expect(readLastVpsId()).toBe('vps-42')
    store.clear()
    expect(readLastVpsId()).toBeUndefined()
  })
})

describe('single connection state derivation (Task A.4)', () => {
  it('every UI surface derives the same indicator from one status object', () => {
    const status: VpsConnectionState = { status: 'connected', serverId: 'a' }
    const surfaces = [
      vpsIndicator('a', status), // StatusBar
      vpsIndicator('a', status), // chat header
      vpsIndicator('a', status) // sidebar / projects
    ]
    expect(new Set(surfaces).size).toBe(1)
    expect(surfaces[0]).toBe('connected')
  })

  it('(v2.6.4) derives the indicator for the selected server from the connected set', () => {
    // A status that names another host must not make the selected server look
    // connected, and vice versa.
    expect(vpsIndicator('a', { status: 'connected', serverId: 'b' }, ['a', 'b'])).toBe('connected')
    expect(vpsIndicator('a', { status: 'connected', serverId: 'b' }, ['b'])).toBe('disconnected')
    expect(vpsIndicator('a', { status: 'error', serverId: 'b', error: 'x' }, ['a'])).toBe('connected')
  })
})

describe('remoteVpsIds (v2.6.4 multi-connection)', () => {
  it('collects every remote project server plus an explicit selection, deduped', () => {
    const projects = [
      { type: 'remote', vpsId: 'srv-a' },
      { type: 'remote', vpsId: 'srv-b' },
      { type: 'local' },
      { type: 'remote' }
    ]
    expect(remoteVpsIds(projects, 'srv-a')).toEqual(['srv-a', 'srv-b'])
    expect(remoteVpsIds(projects, 'srv-header')).toEqual(['srv-a', 'srv-b', 'srv-header'])
  })

  it('returns just the explicit selection when there are no remote projects', () => {
    expect(remoteVpsIds([{ type: 'local' }], 'srv-header')).toEqual(['srv-header'])
    expect(remoteVpsIds([], undefined)).toEqual([])
  })
})
