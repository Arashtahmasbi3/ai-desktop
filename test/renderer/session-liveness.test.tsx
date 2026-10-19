// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import ChatPanel from '../../src/renderer/src/components/ChatPanel'
import Sidebar from '../../src/renderer/src/components/Sidebar'
import { useStore, subscribeToEvents } from '../../src/renderer/src/store'
import type { ProjectRecord, SettingsView } from '@shared/ui'
import type { VpsConnectionState, VpsServerView } from '@shared/vps'

/**
 * R1 - the header dot and the tree dot read ONE per-server fact.
 *
 * The screenshots showed the banner saying `Remote: /opt/... (connected)` while every remote tool
 * failed with `Not connected` in 0.01 s. The surfaces were reading different things: the banner and
 * the tree read the connected set (refreshed a round-trip later), the header read the singular
 * `vpsStatus` slot (whichever server changed last). These cases keep that connected set stale on
 * purpose and change only the liveness fact, so a surface reading anything else cannot pass.
 *
 * R6 removed the `Remote: … (connected)` banner itself (it duplicated the breadcrumb and the bar,
 * and it was the claim that lied). The connected fact is now asserted on the execution bar's
 * connection item; the disconnected banner and its Reconnect action stay, because that one carries
 * a fact the bar does not.
 */
beforeAll(async () => {
  await i18n.changeLanguage('en')
})

const server = (id: string, name: string): VpsServerView => ({
  id,
  name,
  host: `${id}.example.com`,
  port: 22,
  username: 'root',
  authType: 'password',
  hasPassword: true,
  hasPrivateKey: false,
  createdAt: 1,
  updatedAt: 1
})

const SERVERS = [server('srv-a', 'alpha'), server('srv-b', 'bravo')]

const remote: ProjectRecord = {
  id: 'p1',
  name: 'motor',
  path: '/opt/app',
  createdAt: 1,
  updatedAt: 1,
  environment: 'production',
  exists: true,
  type: 'remote',
  vpsId: 'srv-a'
}

const settings: SettingsView = { providers: {}, projects: [remote], activeProjectId: 'p1' }

const connected = (serverId: string): VpsConnectionState => ({ status: 'connected', serverId })

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    vps: {
      list: () => Promise.resolve(SERVERS),
      status: () => Promise.resolve({ status: 'disconnected' }),
      connected: () => Promise.resolve(['srv-a', 'srv-b'])
    },
    agent: { explainStep: () => Promise.resolve(null), abort: () => undefined },
    dialog: {
      pickDirectory: () => Promise.resolve(null),
      pickFile: () => Promise.resolve([])
    },
    chats: { load: () => Promise.resolve(null) }
  }
  useStore.setState({
    ready: true,
    worker: null,
    settings,
    projectMissing: false,
    messages: [],
    decisions: [],
    logs: [],
    warnings: [],
    error: null,
    loopStop: null,
    running: false,
    fileChanges: [],
    changedFiles: [],
    vpsServers: SERVERS,
    vpsServerId: 'srv-a',
    vpsConnected: ['srv-a', 'srv-b'],
    vpsStates: { 'srv-a': connected('srv-a'), 'srv-b': connected('srv-b') }
  })
})

afterEach(cleanup)

// The translated strings, not the English copy: a new exact-copy assertion is forbidden here.
const bannerConnected = (): HTMLElement | null =>
  screen.queryByText(i18n.t('chat.remoteConnected', { path: '/opt/app' }))
const bannerDisconnected = (): HTMLElement | null =>
  screen.queryByText(i18n.t('chat.remoteDisconnected'))

describe('R1 - the connection truth follows the per-server fact in both directions', () => {
  it('shows connected, flips on a liveness disconnect in the same tick, and flips back', () => {
    render(<ChatPanel />)
    // R6: no `Remote: … (connected)` banner at all; the bar carries the fact.
    expect(bannerConnected()).toBeNull()
    const bar = screen.getByTestId('status-item-workspace')
    expect(bar.getAttribute('data-connection')).toBe('connected')

    act(() => {
      useStore
        .getState()
        .applyVpsLiveness({ serverId: 'srv-a', state: { status: 'disconnected' }, at: 1 })
    })

    // The contradiction from the screenshots: no "(connected)" while the fact is disconnected.
    expect(bannerConnected()).toBeNull()
    expect(bannerDisconnected()).toBeTruthy()
    expect(bar.getAttribute('data-connection')).toBe('disconnected')
    // The connected set is still stale, so only the per-server fact can be what decided.
    expect(useStore.getState().vpsConnected).toContain('srv-a')

    act(() => {
      useStore
        .getState()
        .applyVpsLiveness({ serverId: 'srv-a', state: { status: 'connected' }, at: 2 })
    })

    expect(bannerConnected()).toBeNull()
    expect(bannerDisconnected()).toBeNull()
    expect(bar.getAttribute('data-connection')).toBe('connected')
  })

  it('does not repaint the project when a different server transitions', () => {
    render(<ChatPanel />)
    act(() => {
      useStore
        .getState()
        .applyVpsLiveness({ serverId: 'srv-b', state: { status: 'disconnected' }, at: 1 })
    })
    expect(bannerConnected()).toBeNull()
    expect(bannerDisconnected()).toBeNull()
    expect(screen.getByTestId('status-item-workspace').getAttribute('data-connection')).toBe(
      'connected'
    )
    expect(useStore.getState().vpsStates['srv-b']?.status).toBe('disconnected')
  })
})

describe('R1 - the tree dot reads the same fact', () => {
  it('shows the project as connected, then disconnected, from the per-server fact alone', () => {
    render(<Sidebar />)
    const node = screen.getByTestId('project-node-p1')
    expect(within(node).getByRole('img', { name: 'Connected' })).toBeTruthy()

    act(() => {
      useStore
        .getState()
        .applyVpsLiveness({ serverId: 'srv-a', state: { status: 'disconnected' }, at: 1 })
    })

    expect(within(node).getByRole('img', { name: 'Disconnected' })).toBeTruthy()
    expect(useStore.getState().vpsConnected).toContain('srv-a')
  })
})

/** A fake main→renderer event bus, so a test can send the exact IPC events main sends. */
interface EventBus {
  emit(channel: string, payload: unknown): void
}

function eventBus(): EventBus {
  type Listener = (payload: unknown) => void
  const listeners = new Map<string, Listener[]>()
  const api = (window as unknown as { api: Record<string, unknown> }).api
  api.events = {
    on: (channel: string, listener: Listener) => {
      const list = listeners.get(channel) ?? []
      list.push(listener)
      listeners.set(channel, list)
      return () => {
        listeners.set(
          channel,
          (listeners.get(channel) ?? []).filter((entry) => entry !== listener)
        )
      }
    }
  }
  return {
    emit: (channel, payload) => {
      for (const listener of listeners.get(channel) ?? []) listener(payload)
    }
  }
}

/**
 * The half-open path as the window really receives it.
 *
 * The two cases above called `applyVpsLiveness` directly, which proves the store can hold the fact
 * but not that a transition reaches it. Here the event travels through the same `vps:liveness`
 * subscription the app wires at startup, carrying what the probe/reconnect left on the state: the
 * manager now publishes `disconnected` for a handle that answered nothing (it used to publish
 * nothing at all), so this is the path the 4.3.1 dot missed. The reason must survive to the header,
 * too — a dot that says "disconnected" with no why is the question the card had to answer.
 */
describe('R1 - a liveness transition that arrives over IPC moves the header and the tree', () => {
  it('flips both dots on a probe transition, names the reason, and flips them back', () => {
    const bus = eventBus()
    subscribeToEvents()

    render(
      <>
        <ChatPanel />
        <Sidebar />
      </>
    )
    const bar = screen.getByTestId('status-item-workspace')
    const node = screen.getByTestId('project-node-p1')
    expect(bar.getAttribute('data-connection')).toBe('connected')
    expect(within(node).getByRole('img', { name: 'Connected' })).toBeTruthy()

    act(() => {
      bus.emit('vps:liveness', {
        serverId: 'srv-a',
        state: { status: 'disconnected', serverId: 'srv-a', error: 'ECONNRESET' },
        at: 1
      })
    })

    expect(bar.getAttribute('data-connection')).toBe('disconnected')
    expect(within(node).getByRole('img', { name: 'Disconnected' })).toBeTruthy()
    expect(bar.getAttribute('title')).toContain('ECONNRESET')
    // The connected set main reported is still stale: only the per-server fact produced this.
    expect(useStore.getState().vpsConnected).toContain('srv-a')

    act(() => {
      bus.emit('vps:liveness', {
        serverId: 'srv-a',
        state: { status: 'connected', serverId: 'srv-a' },
        at: 2
      })
    })

    expect(bar.getAttribute('data-connection')).toBe('connected')
    expect(within(node).getByRole('img', { name: 'Connected' })).toBeTruthy()
  })
})
