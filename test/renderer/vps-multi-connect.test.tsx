// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import i18n from '../../src/renderer/src/i18n'
import { useStore } from '../../src/renderer/src/store'
import { vpsStateFor } from '../../src/renderer/src/lib/vps-state'
import type { VpsConnectionState, VpsServerView } from '../../src/shared/vps'

/**
 * v2.8.0 — the reported multi-VPS bug: "when I add three connected servers, only one
 * stays connected; the others need reconnecting, and every time I connect one the
 * other gets disconnected."
 *
 * No socket was ever dropped by connecting another server. Two things made it look
 * that way and one made it real:
 *
 *  1. every surface derived per-server connectedness from the single `vpsStatus`
 *     slot, which each `vps:status` event overwrites — so the newest connection made
 *     the previous one render as disconnected (covered by `vpsStateFor` and by the
 *     source sweep below);
 *  2. the renderer only sent `vps:keepAlive` for remote-project hosts and the
 *     chat-header selection, so a server connected by hand in this panel got no
 *     keep-alive and was really reaped after 30 minutes (covered by `keepAliveIds`).
 *
 * The panel component itself is not mounted here: it renders the xterm terminal as
 * soon as a server is connected, and xterm needs a real canvas and `matchMedia`, so
 * jsdom unmounts the tree. The regression is therefore pinned at the two layers the
 * panel reads from — the selector and the store — plus a sweep that stops the
 * single-slot pattern coming back.
 */
beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(() => {
  useStore.setState({ vpsConnected: [], vpsStates: {}, vpsStatus: { status: 'disconnected' } })
})

function server(id: string, name: string): VpsServerView {
  return {
    id,
    name,
    host: `${id}.example.com`,
    port: 22,
    username: 'root',
    authType: 'password',
    trusted: true,
    hasPassword: true
  } as unknown as VpsServerView
}

const servers = [server('srv-a', 'alpha'), server('srv-b', 'beta'), server('srv-c', 'gamma')]

describe('v2.8.0 — three servers stay connected at once', () => {
  beforeEach(() => {
    let connected: string[] = []
    useStore.setState({
      vpsServers: servers,
      vpsStatus: { status: 'disconnected' },
      vpsStates: {},
      vpsConnected: []
    })
    ;(window as unknown as { api: unknown }).api = {
      vps: {
        list: () => Promise.resolve(servers),
        audit: () => Promise.resolve([]),
        connected: () => Promise.resolve([...connected]),
        connect: (id: string): Promise<VpsConnectionState> => {
          connected = [...new Set([...connected, id])]
          return Promise.resolve({ status: 'connected', serverId: id })
        },
        disconnect: (id: string): Promise<VpsConnectionState> => {
          connected = connected.filter((entry) => entry !== id)
          return Promise.resolve({ status: 'disconnected', serverId: id })
        }
      },
      events: { on: () => () => undefined }
    }
  })

  it('connecting a second and third server keeps all three in the connected set', async () => {
    const store = useStore.getState()
    await store.ensureVpsConnected('srv-a')
    await store.ensureVpsConnected('srv-b')
    await store.ensureVpsConnected('srv-c')

    expect(useStore.getState().vpsConnected).toEqual(['srv-a', 'srv-b', 'srv-c'])
  })

  it('every connected server reads as connected even though the slot names the last one', async () => {
    const store = useStore.getState()
    await store.ensureVpsConnected('srv-a')
    await store.ensureVpsConnected('srv-b')

    // `vps:status` is last-write-wins, so it names whichever changed last. The exact
    // reported situation: b connected last, a must NOT look disconnected.
    const state = useStore.getState()
    expect(state.vpsStatus.serverId).toBe('srv-b')

    for (const id of ['srv-a', 'srv-b']) {
      expect(vpsStateFor(id, state.vpsStates, state.vpsConnected, state.vpsStatus).status).toBe(
        'connected'
      )
    }
    // The third one has never been connected and must still offer Connect.
    expect(
      vpsStateFor('srv-c', state.vpsStates, state.vpsConnected, state.vpsStatus).status
    ).toBe('disconnected')
  })
})

/**
 * The single-slot read is the bug; this sweep stops it coming back, in the same
 * spirit as the theme-token and UI-token sweeps already in this suite.
 */
describe('v2.8.0 — no surface derives per-server state from the single slot', () => {
  const RENDERER = join(__dirname, '..', '..', 'src', 'renderer', 'src')

  function sourceFiles(dir: string): string[] {
    const out: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) out.push(...sourceFiles(full))
      else if (/\.(tsx|ts)$/.test(entry.name)) out.push(full)
    }
    return out
  }

  it('nothing asks vpsStatus whether a *particular* server is connected', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(RENDERER)) {
      const source = readFileSync(file, 'utf8')
      // e.g. `vpsStatus.status === 'connected' && vpsStatus.serverId === project.vpsId`
      const perServer = /vpsStatus\.status\s*===\s*'connected'[\s\S]{0,80}?vpsStatus\.serverId\s*===/
      if (perServer.test(source)) {
        offenders.push(file.replace(RENDERER, 'src/renderer/src'))
      }
    }
    expect(offenders).toEqual([])
  })
})
