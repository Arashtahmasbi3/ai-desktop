// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import VpsSelector from '../../src/renderer/src/components/VpsSelector'
import { useStore } from '../../src/renderer/src/store'
import type { VpsConnectionState, VpsServerView } from '@shared/vps'

/**
 * R5 - the chat-header selector lists every saved server and its dot is that server's own fact.
 *
 * Before this, the option dot and the indicator both read the singular `vpsStatus`, which names
 * whichever server changed last: with two connections only one of them could ever look connected.
 * These cases keep the connected *set* stale on purpose, so only `vpsStates` can answer.
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

const connected = (serverId: string): VpsConnectionState => ({ status: 'connected', serverId })

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    vps: {
      list: () => Promise.resolve(SERVERS),
      status: () => Promise.resolve({ status: 'disconnected' }),
      connected: () => Promise.resolve(['srv-a', 'srv-b'])
    }
  }
  useStore.setState({
    vpsServers: SERVERS,
    vpsServerId: 'srv-a',
    vpsConnected: ['srv-a', 'srv-b'],
    vpsStates: { 'srv-a': connected('srv-a'), 'srv-b': connected('srv-b') },
    running: false
  })
})

afterEach(cleanup)

function option(label: string): HTMLElement {
  const found = screen
    .getAllByRole('option')
    .find((entry) => (entry.textContent ?? '').startsWith(label))
  if (!found) throw new Error('no option for ' + label)
  return found
}

describe('R5 - the selector reads vpsStates, one server at a time', () => {
  it('lists both connected servers and marks each one with its own dot', async () => {
    render(<VpsSelector />)
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3))
    expect(option('alpha').textContent).toContain('🟢')
    expect(option('bravo').textContent).toContain('🟢')
  })

  it('keeps the other server connected when one is disconnected', async () => {
    render(<VpsSelector />)
    await waitFor(() => expect(option('alpha').textContent).toContain('🟢'))

    // Only the per-server fact changes. The connected set main reported is still stale.
    act(() => {
      useStore.setState({
        vpsStates: {
          'srv-a': { status: 'disconnected', serverId: 'srv-a' },
          'srv-b': connected('srv-b')
        }
      })
    })

    expect(option('alpha').textContent).not.toContain('🟢')
    expect(option('bravo').textContent).toContain('🟢')
    expect(useStore.getState().vpsConnected).toEqual(['srv-a', 'srv-b'])
    // The selected server is the disconnected one, so the reconnect hint is offered.
    expect(screen.getByText(i18n.t('vpsSelector.reconnect'))).toBeTruthy()
  })
})
