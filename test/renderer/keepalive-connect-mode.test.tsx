// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useStore } from '../../src/renderer/src/store'
import type { VpsConnectionState } from '../../src/shared/vps'

/**
 * R7 - which connect requests may reopen a server the user disconnected.
 *
 * The decision is made in main (`SshManager.connect` vs `SshManager.connectAutomatically`), so the
 * bridge has to say which one the caller is. The keep-alive pass brings an open remote project's host
 * back up on its own, and that is the request that must never reopen a user-disconnected server; a
 * click on Connect is the only way back.
 *
 * No component is mounted: the panel renders xterm as soon as a server is connected, which needs a
 * canvas. The store actions are the layer the panel calls, so they are what is pinned here.
 */
type Mode = 'manual' | 'automatic' | undefined

interface Call {
  id: string
  mode: Mode
}

function installBridge(states: Record<string, VpsConnectionState>): Call[] {
  const calls: Call[] = []
  const connected = (): string[] =>
    Object.entries(states)
      .filter(([, state]) => state.status === 'connected')
      .map(([id]) => id)
  ;(window as unknown as { api: unknown }).api = {
    vps: {
      list: () => Promise.resolve([]),
      connected: () => Promise.resolve(connected()),
      connect: (id: string, mode?: Mode): Promise<VpsConnectionState> => {
        calls.push({ id, mode })
        return Promise.resolve(
          states[id] ?? { status: 'disconnected', serverId: id, userDisconnected: true }
        )
      }
    },
    events: { on: () => () => undefined }
  }
  return calls
}

beforeEach(() => {
  useStore.setState({
    vpsServerId: undefined,
    vpsServers: [],
    vpsStatus: { status: 'disconnected' },
    vpsStates: {},
    vpsConnected: []
  })
})

afterEach(() => {
  useStore.setState({
    vpsServerId: undefined,
    vpsServers: [],
    vpsStatus: { status: 'disconnected' },
    vpsStates: {},
    vpsConnected: []
  })
})

describe('R7 - only a click asks for a manual connect', () => {
  it('the background keep-alive asks for an automatic connect and leaves the server down', async () => {
    const calls = installBridge({
      'srv-a': { status: 'disconnected', serverId: 'srv-a', userDisconnected: true }
    })

    await useStore.getState().ensureVpsConnected('srv-a')

    expect(calls).toEqual([{ id: 'srv-a', mode: 'automatic' }])
    // Main refused to open it, and the renderer keeps the fact rather than inventing a connection.
    expect(useStore.getState().vpsStates['srv-a']).toMatchObject({
      status: 'disconnected',
      userDisconnected: true
    })
    expect(useStore.getState().vpsConnected).toEqual([])
  })

  it('a Connect click asks for a manual connect, in place and from the chat header', async () => {
    const calls = installBridge({})

    await useStore.getState().connectVpsInPlace('srv-a')
    await useStore.getState().connectVps('srv-b')

    expect(calls).toEqual([
      { id: 'srv-a', mode: 'manual' },
      { id: 'srv-b', mode: 'manual' }
    ])
    // The in-place action must not move the chat-header selection; the explicit one must.
    expect(useStore.getState().vpsServerId).toBe('srv-b')
  })
})
