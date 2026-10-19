// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import ExecutionBar from '../../src/renderer/src/components/ExecutionBar'
import { useStore } from '../../src/renderer/src/store'
import { formatCountdown } from '../../src/renderer/src/lib/countdown'
import type { ProjectRecord, SettingsView } from '@shared/ui'
import type { VpsServerView } from '@shared/vps'
import type { ApprovalMode } from '@shared/approval'

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

const remote: ProjectRecord = {
  id: 'p1',
  name: 'demo-project',
  path: '/opt/demo-project',
  createdAt: 1,
  updatedAt: 1,
  environment: 'production',
  exists: true,
  type: 'remote',
  vpsId: 'srv-9'
}

const local: ProjectRecord = {
  id: 'p2',
  name: 'ai-desktop',
  path: 'C:/projects/ai-desktop',
  createdAt: 1,
  updatedAt: 1,
  environment: 'development',
  exists: true
}

const servers: VpsServerView[] = [
  {
    id: 'srv-9',
    name: 'my-server',
    host: '10.0.0.9',
    port: 22,
    username: 'root',
    authType: 'password',
    hasPassword: true,
    hasPrivateKey: false,
    createdAt: 1,
    updatedAt: 1
  }
]

const settings: SettingsView = {
  providers: {},
  projects: [remote, local],
  activeProjectId: 'p1'
}

function mount(mode: ApprovalMode = 'ask'): void {
  useStore.setState({
    settings: { ...settings, approvalMode: mode },
    vpsServers: servers,
    vpsStatus: { status: 'connected', serverId: 'srv-9' },
    vpsConnected: ['srv-9'],
    worker: null,
    projectMissing: false,
    ready: true,
    fullAccessExpiresAt: null,
    running: false,
    planMode: false,
    terminalOpen: false,
    workspacePanelOpen: false,
    chatTreeOpen: false
  })
}

const bar = (): JSX.Element => (
  <ExecutionBar timelineOpen={false} onToggleTimeline={() => undefined} />
)

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    vps: {
      list: () => Promise.resolve(servers),
      status: () => Promise.resolve({ status: 'connected', serverId: 'srv-9' }),
      connected: () => Promise.resolve(['srv-9']),
      testConnection: () => Promise.resolve({ ok: true, host: '10.0.0.9', port: 22, outcome: 'open', from: 'this-machine' })
    },
    agent: { abort: vi.fn() }
  }
  mount()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

/**
 * The workspace line (v4.3) — one row, and every fact on it appears once.
 *
 * The bar used to be two lines under the title bar: line 1 named the project, the server and the
 * path, line 2 repeated the connection and carried the approval-mode chip — which the status bar
 * then printed again, and which in the user's screenshots disagreed with it. The contract now is:
 * the breadcrumb names where the run works, the connection truth is stated once beside it, and the
 * approval mode is **not here at all** (it lives in the title bar's menu and reads back in the
 * status line).
 */
describe('v4.3 - the workspace line', () => {
  it('1. names the project and the working path as a breadcrumb', () => {
    render(bar())
    expect(screen.getByTestId('exec-project').textContent).toBe('demo-project')
    const path = screen.getByTestId('exec-path')
    expect(path.textContent).toBe('/opt/demo-project')
    expect(path.getAttribute('dir')).toBe('ltr')
  })

  it('2. states the connection truth once: the server and its address', () => {
    render(bar())

    const item = screen.getByTestId('status-item-workspace')
    expect(item.getAttribute('data-connection')).toBe('connected')
    // The machine and the address it is reached at — never a bare "Connected".
    expect(item.textContent).toContain('my-server')
    expect(item.textContent).toContain('10.0.0.9')
    // …and the server is still readable under its own id, so nothing was lost in the merge.
    expect(screen.getByTestId('exec-server').textContent).toBe('my-server')
  })

  it('3. does NOT carry the approval mode — that fact has one home, not three', () => {
    render(bar())
    // The chip that duplicated the status line is gone, and no control here claims the mode.
    expect(screen.queryByTestId('exec-approval')).toBeNull()
    expect(screen.queryByText(/Safe mode|Ask before write|Full access/)).toBeNull()
  })

  it('4. shows the full-access countdown where the connection is, because it changes the run', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    mount('full')
    const expiresAt = Date.now() + (25 * 60 + 14) * 1000
    useStore.setState({ fullAccessExpiresAt: expiresAt })

    render(bar())
    expect(screen.getByTestId('exec-approval-timer').textContent).toBe('25:14')

    act(() => {
      vi.advanceTimersByTime(61_000)
    })
    expect(screen.getByTestId('exec-approval-timer').textContent).toBe('24:13')
    expect(formatCountdown(25 * 60 * 1000)).toBe('25:00')
  })

  it('5. renders no second Stop — the composer owns the only one', () => {
    useStore.setState({ running: true })
    render(bar())
    expect(screen.queryByTestId('exec-stop')).toBeNull()
    expect(screen.queryByRole('button', { name: /stop/i })).toBeNull()
  })

  it('6. is ONE row of 28px, with the path truncating instead of wrapping the bar', () => {
    render(bar())
    const header = screen.getByTestId('execution-bar')
    // One flex row, no stacked lines: the row height is the shared 28px token.
    expect(header.className).toContain('ui-row')
    expect(header.className).not.toContain('flex-col')
    const path = screen.getByTestId('exec-path')
    expect(path.className).toContain('truncate')
    expect(path.className).toContain('min-w-0')
    // The connection item may shrink but never wraps its own label.
    expect(screen.getByTestId('status-item-workspace').className).toContain('min-w-0')
  })

  it('7. offers exactly one entry point to the project menu and no duplicate git banner', async () => {
    render(bar())
    // The git status moved to the sidebar's project header; it must not be printed twice.
    await waitFor(() => expect(screen.queryByText('main · clean')).toBeNull())
    expect(document.querySelectorAll('[data-testid="execution-bar"]').length).toBe(1)
  })
})
