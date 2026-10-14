import { describe, it, expect, afterEach } from 'vitest'
import {
  keepAliveIds,
  readLastVpsId,
  remoteVpsIds,
  resolveReconnectId,
  vpsIndicator,
  vpsServerName,
  vpsStateFor,
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

/**
 * v2.8.0 — "when I connect three servers, only one stays connected and every connect
 * drops another". No socket was ever closed: the UI read the single `vpsStatus` slot,
 * which every `vps:status` event overwrites, so each newly connected server made the
 * previous one render as disconnected.
 */
describe('vpsStateFor (v2.8.0 per-server connection state)', () => {
  const globalA: VpsConnectionState = { status: 'connected', serverId: 'a' }

  it('reports a server that is connected even when the global slot names another', () => {
    const states: Record<string, VpsConnectionState> = {
      a: { status: 'connected', serverId: 'a' },
      b: { status: 'connected', serverId: 'b' }
    }
    // The exact reported case: b connected last, so the slot says b — a must still
    // read as connected.
    expect(vpsStateFor('a', states, ['a', 'b'], { status: 'connected', serverId: 'b' }).status).toBe(
      'connected'
    )
    expect(vpsStateFor('b', states, ['a', 'b'], { status: 'connected', serverId: 'b' }).status).toBe(
      'connected'
    )
  })

  it('trusts the connected set over a stale per-server error', () => {
    const states: Record<string, VpsConnectionState> = {
      a: { status: 'error', serverId: 'a', error: 'stale' }
    }
    expect(vpsStateFor('a', states, ['a'], globalA).status).toBe('connected')
  })

  it('falls back to the per-server state, then to disconnected for a foreign slot', () => {
    expect(vpsStateFor('c', { c: { status: 'connecting', serverId: 'c' } }, [], globalA).status).toBe(
      'connecting'
    )
    // The slot is about `a`, so it says nothing about `c`.
    expect(vpsStateFor('c', {}, [], globalA).status).toBe('disconnected')
    // An unknown id with the slot naming it is still that server's state.
    expect(vpsStateFor('a', {}, [], globalA).status).toBe('connected')
  })

  it('with no active server, falls back to the global slot', () => {
    expect(vpsStateFor(null, {}, ['a'], globalA).status).toBe('connected')
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

/**
 * v2.8.0 — the second half of the multi-VPS report: "the others need reconnecting".
 * The main process reaps an idle connection after 30 minutes, and the renderer only
 * sent keep-alives for remote-project hosts and the header selection, so a server
 * connected by hand in the Servers view was genuinely torn down.
 */
describe('keepAliveIds (v2.8.0)', () => {
  it('includes every connected server, not just the project hosts and the selection', () => {
    const projects = [{ type: 'remote', vpsId: 'srv-a' }]
    const ids = keepAliveIds(projects, 'srv-header', ['srv-a', 'srv-manual', 'srv-header'])

    expect(ids).toContain('srv-a')
    expect(ids).toContain('srv-header')
    // The one that used to be dropped and reaped.
    expect(ids).toContain('srv-manual')
  })

  it('is deduped and tolerates an empty connected set', () => {
    const projects = [
      { type: 'remote', vpsId: 'srv-a' },
      { type: 'remote', vpsId: 'srv-a' }
    ]
    expect(keepAliveIds(projects, 'srv-a', ['srv-a'])).toEqual(['srv-a'])
    expect(keepAliveIds(projects, undefined, [])).toEqual(['srv-a'])
  })
})
