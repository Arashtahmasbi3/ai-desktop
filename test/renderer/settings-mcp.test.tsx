// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import SettingsMcp, {
  parseEnvLines,
  splitArgs
} from '../../src/renderer/src/components/SettingsMcp'
import SettingsPanel from '../../src/renderer/src/components/SettingsPanel'
import { useStore } from '../../src/renderer/src/store'
import type { McpServerStatus, McpServerView } from '../../src/shared/mcp'

/**
 * Settings → MCP (F0-2e).
 *
 * The page exists because the MCP client was a library nobody could reach. Three things must hold
 * for that to be true rather than nominal:
 *
 *  1. **What is configured is visible** — name, launch line, enabled state, and either a tool count
 *     or the error the last connection produced. A server that failed to start is the interesting
 *     row, not the one to hide.
 *  2. **Adding a server sends what the user typed, in the shape main expects** — including the
 *     `KEY=value` environment lines that carry a token, which never travel back.
 *  3. **Enable/disable and remove actually call main**, because a switch wired to local state is
 *     the exact lie this settings page was rebuilt to avoid once already.
 */
beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(() => {
  cleanup()
  // The panel's own tests below flip this; leaving it set would leak between files.
  useStore.setState({ settingsOpen: false, settingsTab: null })
})

const NOTES: McpServerView = {
  id: 'notes',
  name: 'Notes',
  enabled: true,
  launch: 'node server.js',
  createdAt: 0,
  toolCount: 2
}

const DEAD: McpServerView = {
  id: 'dead',
  name: 'Dead server',
  enabled: false,
  launch: 'node missing.js',
  createdAt: 0,
  error: 'spawn ENOENT'
}

const STATUSES: McpServerStatus[] = [
  { serverId: 'notes', state: 'connected', toolCount: 2 },
  { serverId: 'dead', state: 'error', toolCount: 0, error: 'spawn ENOENT' }
]

const listApi = vi.fn()
const statusApi = vi.fn()
const saveApi = vi.fn()
const setEnabledApi = vi.fn()
const removeApi = vi.fn()

function installApi(): void {
  ;(window as unknown as { api: unknown }).api = {
    mcp: {
      list: listApi,
      status: statusApi,
      save: saveApi,
      setEnabled: setEnabledApi,
      remove: removeApi
    }
  }
}

beforeEach(() => {
  listApi.mockReset().mockResolvedValue([NOTES, DEAD])
  statusApi.mockReset().mockResolvedValue(STATUSES)
  saveApi.mockReset().mockResolvedValue([NOTES, DEAD])
  setEnabledApi.mockReset().mockImplementation(async (id: string, enabled: boolean) =>
    [NOTES, DEAD].map((server) => (server.id === id ? { ...server, enabled } : server))
  )
  removeApi.mockReset().mockImplementation(async (id: string) =>
    [NOTES, DEAD].filter((server) => server.id !== id)
  )
  installApi()
})

const addButton = (): HTMLElement => screen.getByRole('button', { name: i18n.t('settings.mcpAdd') })

describe('Settings → MCP (F0-2e)', () => {
  it('lists every configured server with its launch line, state and outcome', async () => {
    render(<SettingsMcp />)

    await waitFor(() => expect(screen.getAllByTestId('mcp-server-row')).toHaveLength(2))
    const rows = screen.getAllByTestId('mcp-server-row')
    expect(within(rows[0]!).getByText('Notes')).toBeTruthy()
    expect(within(rows[0]!).getByText('node server.js')).toBeTruthy()
    expect(within(rows[1]!).getByText('Dead server')).toBeTruthy()

    expect(rows[0]!.textContent).toContain(i18n.t('settings.mcpEnabled'))
    expect(rows[0]!.textContent).toContain('2')
    // The failure is a row attribute with its message, not a silent absence.
    expect(rows[1]!.textContent).toContain(i18n.t('settings.mcpDisabled'))
    expect(rows[1]!.textContent).toContain('spawn ENOENT')
    // …and the last status section reports the same observation per server id.
    expect(screen.getAllByTestId('mcp-status-row')).toHaveLength(2)
    expect(screen.getByTestId('mcp-last-status').textContent).toContain(
      i18n.t('settings.mcpState_connected')
    )
  })

  it('says so plainly when nothing is configured yet', async () => {
    listApi.mockResolvedValue([])
    statusApi.mockResolvedValue([])
    render(<SettingsMcp />)
    await waitFor(() => expect(screen.getByTestId('mcp-empty')).toBeTruthy())
  })

  it('adds a server with the arguments and environment the user typed', async () => {
    render(<SettingsMcp />)
    await waitFor(() => expect(screen.getAllByTestId('mcp-server-row')).toHaveLength(2))

    fireEvent.change(screen.getByLabelText(i18n.t('settings.mcpName')), {
      target: { value: '  Notes ' }
    })
    fireEvent.change(screen.getByLabelText(i18n.t('settings.mcpCommand')), {
      target: { value: 'node' }
    })
    fireEvent.change(screen.getByLabelText(i18n.t('settings.mcpArgs')), {
      target: { value: 'server.js  --verbose' }
    })
    fireEvent.change(screen.getByLabelText(i18n.t('settings.mcpEnv')), {
      target: { value: 'TOKEN=secret\n\nnot-a-variable\nPORT=8080\n' }
    })
    fireEvent.click(addButton())

    await waitFor(() => expect(saveApi).toHaveBeenCalledTimes(1))
    expect(saveApi).toHaveBeenCalledWith({
      name: 'Notes',
      command: 'node',
      args: ['server.js', '--verbose'],
      env: { TOKEN: 'secret', PORT: '8080' }
    })
    // The answer from main is what renders, so the page and the store cannot disagree.
    expect(screen.getAllByTestId('mcp-server-row')).toHaveLength(2)
  })

  it('refuses an empty name or command instead of saving an unusable server', async () => {
    render(<SettingsMcp />)
    fireEvent.change(screen.getByLabelText(i18n.t('settings.mcpCommand')), {
      target: { value: 'node' }
    })
    fireEvent.click(addButton())

    await waitFor(() => expect(screen.getByTestId('mcp-form-error')).toBeTruthy())
    expect(saveApi).not.toHaveBeenCalled()
  })

  it('toggles a server through main rather than local state', async () => {
    render(<SettingsMcp />)
    await waitFor(() => expect(screen.getAllByTestId('mcp-server-row')).toHaveLength(2))

    fireEvent.click(screen.getByRole('button', { name: 'Disable Notes' }))
    await waitFor(() => expect(setEnabledApi).toHaveBeenCalledWith('notes', false))
    await waitFor(() =>
      expect(screen.getAllByTestId('mcp-server-row')[0]!.textContent).toContain(
        i18n.t('settings.mcpDisabled')
      )
    )
  })

  it('removes a server through main', async () => {
    render(<SettingsMcp />)
    await waitFor(() => expect(screen.getAllByTestId('mcp-server-row')).toHaveLength(2))

    fireEvent.click(screen.getByRole('button', { name: 'Remove Notes' }))
    await waitFor(() => expect(removeApi).toHaveBeenCalledWith('notes'))
    await waitFor(() => expect(screen.queryByText('Notes')).toBeNull())
  })

  it('is reachable from the settings navigation', async () => {
    useStore.setState({ settingsOpen: true, settingsTab: null })
    render(<SettingsPanel />)

    fireEvent.click(screen.getByRole('button', { name: i18n.t('settings.mcp') }))
    await waitFor(() => expect(screen.getByTestId('settings-mcp')).toBeTruthy())
    await waitFor(() => expect(screen.getAllByTestId('mcp-server-row')).toHaveLength(2))
  })
})

describe('the add form parsers', () => {
  it('keeps KEY=value lines and ignores a line without a usable key', () => {
    expect(parseEnvLines('A=1\n B = two \n\nno-equals\n=C\n')).toEqual({ A: '1', B: 'two' })
  })

  it('splits arguments on whitespace and nothing else', () => {
    expect(splitArgs('  a   b\tc ')).toEqual(['a', 'b', 'c'])
    expect(splitArgs('   ')).toEqual([])
  })
})
