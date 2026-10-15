// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import SettingsDeveloper from '../../src/renderer/src/components/SettingsDeveloper'
import StatusBar from '../../src/renderer/src/components/StatusBar'
import { useStore } from '../../src/renderer/src/store'
import type { RemoteStatus } from '../../src/shared/ui'

/**
 * v2.8.1 — "the remote button is still undecided about what it is for."
 *
 * It was a bare on/off chip in the status bar of a chat app with no explanation. It is
 * a developer API (a localhost JSON endpoint), so it now lives in Settings → Developer
 * with what it is, why no client ships with it, the URL, the token and a copyable
 * example — and the status bar no longer offers it.
 */
beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

const OFF: RemoteStatus = { enabled: false, host: '127.0.0.1', port: 61796, clients: 0 }
const ON: RemoteStatus = {
  enabled: true,
  host: '127.0.0.1',
  port: 61796,
  clients: 2,
  token: 'tok-abcdef0123456789'
}

const start = vi.fn(async () => ON)
const stop = vi.fn(async () => OFF)

beforeEach(() => {
  start.mockClear()
  stop.mockClear()
  ;(window as unknown as { api: unknown }).api = {
    app: { version: vi.fn(async () => '2.8.1') },
    remote: { start, stop, status: vi.fn(async () => OFF) }
  }
  // jsdom has no clipboard by default; the copy buttons must not throw without it.
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } })
  useStore.setState({ remote: OFF, settings: null })
})

describe('Settings → Developer: the remote access API (v2.8.1)', () => {
  it('explains what the feature is instead of leaving a mystery switch', () => {
    render(<SettingsDeveloper />)

    expect(screen.getByTestId('remote-access')).toBeTruthy()
    expect(screen.getByText(/A small JSON API on this machine only/i)).toBeTruthy()
    expect(screen.getByText(/No client ships with AI Desktop/i)).toBeTruthy()
    expect(screen.getByTestId('remote-toggle')).toBeTruthy()
  })

  it('starts the server when switched on', async () => {
    render(<SettingsDeveloper />)
    fireEvent.click(screen.getByTestId('remote-toggle'))
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1))
  })

  it('shows the URL, the token, the client count and a runnable example once on', async () => {
    useStore.setState({ remote: ON })
    render(<SettingsDeveloper />)

    expect(screen.getByText('http://127.0.0.1:61796')).toBeTruthy()
    expect(screen.getByText(/Connected clients: 2/)).toBeTruthy()
    expect(screen.getByTestId('remote-examples').textContent).toContain('curl')
    expect(screen.getByTestId('remote-examples').textContent).toContain(
      'http://127.0.0.1:61796/status'
    )
    // The token is masked until the user asks for it, so a screenshot or a shared
    // screen does not leak a live credential.
    const tokenField = screen.getByTestId('remote-token')
    expect(tokenField.textContent).not.toBe('tok-abcdef0123456789')
    expect(tokenField.textContent).toContain('•')

    fireEvent.click(screen.getByTestId('remote-reveal-token'))
    expect(screen.getByTestId('remote-token').textContent).toBe('tok-abcdef0123456789')
  })

  it('copies the URL without throwing when a clipboard exists', async () => {
    useStore.setState({ remote: ON })
    render(<SettingsDeveloper />)

    fireEvent.click(screen.getByTestId('remote-copy-url'))
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('http://127.0.0.1:61796')
    )
  })

  it('hides the details while the server is off', () => {
    useStore.setState({ remote: OFF })
    render(<SettingsDeveloper />)
    expect(screen.queryByTestId('remote-examples')).toBeNull()
  })
})

describe('StatusBar no longer offers the remote toggle (v2.8.1)', () => {
  it('renders no remote on/off control', () => {
    useStore.setState({ remote: ON, ready: true, worker: null, settings: null })
    render(<StatusBar />)

    // The word "remote" must not appear as a clickable control any more.
    const buttons = Array.from(document.querySelectorAll('button')).map((node) =>
      (node.textContent ?? '').trim()
    )
    expect(buttons.some((label) => /127\.0\.0\.1:61796/.test(label))).toBe(false)
    expect(screen.queryByTitle(/remote/i)).toBeNull()
  })
})
