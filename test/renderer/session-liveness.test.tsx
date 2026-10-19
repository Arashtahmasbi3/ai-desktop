// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import ChatPanel from '../../src/renderer/src/components/ChatPanel'
import Sidebar from '../../src/renderer/src/components/Sidebar'
import { useStore } from '../../src/renderer/src/store'
import type { ProjectRecord, SettingsView } from '@shared/ui'
import type { VpsConnectionState, VpsServerView } from '@shared/vps'

/**
 * R1 - the header dot, the `Remote: ...` banner and the tree dot read ONE per-server fact.
 *
 * The screenshots showed the banner saying `Remote: /opt/... (connected)` while every remote tool
 * failed with `Not connected` in 0.01 s. The surfaces were reading different things: the banner and
 * the tree read the connected set (refreshed a round-trip later), the header read the singular
 * `vpsStatus` slot (whichever server changed last). These cases keep that connected set stale on
 * purpose and change only the liveness fact, so a surface reading anything else cannot pass.
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

describe('R1 - the banner text follows the per-server fact in both directions', () => {
  it('shows connected, flips on a liveness disconnect in the same tick, and flips back', () => {
    render(<ChatPanel />)
    expect(bannerConnected()).toBeTruthy()
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

    expect(bannerConnected()).toBeTruthy()
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
    expect(bannerConnected()).toBeTruthy()
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
