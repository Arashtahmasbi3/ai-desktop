// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  name: 'sepehr-motor',
  path: '/opt/sepehr-motor',
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
    name: 'spmotor',
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

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    vps: {
      list: () => Promise.resolve(servers),
      status: () => Promise.resolve({ status: 'connected', serverId: 'srv-9' }),
      gitStatusParsed: () =>
        Promise.resolve({ branch: 'main', changes: 0, ahead: 0, behind: 0, clean: true })
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
 * v2.6.1, B.3 - the execution contract bar. Two lines: where the agent works
 * (project / server / path) and how it is allowed to work (git, connection,
 * approval mode), with the run controls.
 */
describe('v2.6.1 B.3 - execution bar', () => {
  it('1. line 1 names the project, server and working path', () => {
    render(<ExecutionBar timelineOpen={false} onToggleTimeline={() => undefined} />)
    expect(screen.getByTestId('exec-project').textContent).toBe('sepehr-motor')
    expect(screen.getByTestId('exec-server').textContent).toBe('spmotor')
    const path = screen.getByTestId('exec-path')
    expect(path.textContent).toBe('/opt/sepehr-motor')
    expect(path.getAttribute('dir')).toBe('ltr')
  })

  it('2. line 2 shows git status, connection and the approval mode badge', async () => {
    render(<ExecutionBar timelineOpen={false} onToggleTimeline={() => undefined} />)
    await waitFor(() => expect(screen.getByText('main · clean')).toBeTruthy())
    expect(screen.getByTestId('exec-connection').textContent).toContain('Connected')
    expect(screen.getByTestId('exec-approval').textContent).toContain('Safe mode')
  })

  it('3. the approval badge reflects each mode with its own colour', () => {
    const { rerender } = render(<ExecutionBar timelineOpen={false} onToggleTimeline={() => undefined} />)
    const ask = screen.getByTestId('exec-approval')
    expect(ask.textContent).toContain('Safe mode')
    // v2.7.0: the badge colour is the semantic `info` token.
    expect(ask.className).toContain('info')

    mount('auto-write')
    rerender(<ExecutionBar timelineOpen={false} onToggleTimeline={() => undefined} />)
    const auto = screen.getByTestId('exec-approval')
    expect(auto.textContent).toContain('Ask before write')
    expect(auto.className).toContain('bg-bg-tertiary')

    mount('full')
    rerender(<ExecutionBar timelineOpen={false} onToggleTimeline={() => undefined} />)
    const full = screen.getByTestId('exec-approval')
    expect(full.textContent).toContain('Full access')
    expect(full.className).toContain('warning')
  })

  it('4. full access shows a live auto-disable countdown', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    mount('full')
    const expiresAt = Date.now() + (25 * 60 + 14) * 1000
    useStore.setState({ fullAccessExpiresAt: expiresAt })

    render(<ExecutionBar timelineOpen={false} onToggleTimeline={() => undefined} />)
    expect(screen.getByTestId('exec-approval-timer').textContent).toBe('25:14')

    act(() => {
      vi.advanceTimersByTime(61_000)
    })
    expect(screen.getByTestId('exec-approval-timer').textContent).toBe('24:13')
    expect(formatCountdown(25 * 60 * 1000)).toBe('25:00')
  })

  it('5. run controls appear only while the agent is running', () => {
    useStore.setState({ running: true })
    render(<ExecutionBar timelineOpen={false} onToggleTimeline={() => undefined} />)
    const stop = screen.getByTestId('exec-stop')
    fireEvent.click(stop)
    expect((window.api as unknown as { agent: { abort: ReturnType<typeof vi.fn> } }).agent.abort).toHaveBeenCalled()
  })

  it('6. stays readable in a narrow window (wrap + truncate, never clip)', () => {
    render(<ExecutionBar timelineOpen={false} onToggleTimeline={() => undefined} />)
    const bar = screen.getByTestId('execution-bar')
    const lines = Array.from(bar.children) as HTMLElement[]
    expect(lines).toHaveLength(2)
    for (const line of lines) expect(line.className).toContain('flex-wrap')
    expect(screen.getByTestId('exec-path').className).toContain('truncate')
    expect(screen.getByTestId('exec-approval').className).toContain('shrink-0')
    expect(screen.getByTestId('exec-approval').querySelector('span')!.className).toContain(
      'whitespace-nowrap'
    )
  })
})
