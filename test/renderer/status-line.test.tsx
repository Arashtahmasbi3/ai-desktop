// @vitest-environment jsdom
/**
 * v4.3 — one status line, four facts.
 *
 * The footer used to carry seven chips on screen (agent, model, access, workspace, the
 * Simple/Advanced switch, an overflow hint) plus a right-click menu, and two of those facts were
 * also printed by the execution bar above it. The report asked for a Linux-desktop status line:
 * state, mode, spend. This pins both halves of that — the four items that remain, and the absence
 * of the ones that were removed rather than moved.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import StatusBar from '../../src/renderer/src/components/StatusBar'
import { useStore } from '../../src/renderer/src/store'
import { formatTokens } from '../../src/renderer/src/lib/usage'
import type { ProjectRecord, SettingsView, WorkerStatus } from '@shared/ui'

const worker: WorkerStatus = {
  state: 'idle',
  active: 0,
  queued: 0,
  completed: 0,
  failed: 0,
  maxConcurrent: 2,
  memoryMb: 4096,
  cpuCores: 4,
  online: true,
  remoteEnabled: false,
  jobs: []
}

const project: ProjectRecord = {
  id: 'p1',
  name: 'demo',
  path: '/home/u/demo',
  createdAt: 1,
  updatedAt: 1,
  environment: 'development',
  exists: true
}

const settings: SettingsView = { providers: {}, projects: [project], activeProjectId: 'p1' }

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

beforeEach(() => {
  useStore.setState({
    ready: true,
    worker,
    remote: null,
    settings,
    planMode: false,
    selection: { provider: 'deepseek', model: 'deepseek-flash' },
    usageRecords: [],
    sessionStartedAt: Date.now() - 1000,
    vpsServers: [],
    vpsStatus: { status: 'disconnected' },
    vpsConnected: []
  })
})

describe('v4.3 — the status line', () => {
  it('1. is exactly one line with the state, the mode, the tokens and the spend', () => {
    render(<StatusBar />)

    expect(document.querySelectorAll('footer')).toHaveLength(1)
    const bar = screen.getByTestId('status-bar')
    expect(bar.className).toContain('ui-row')
    // The four facts, each once.
    expect(screen.getByTestId('status-item-agent')).toBeTruthy()
    expect(screen.getByTestId('status-item-access')).toBeTruthy()
    expect(screen.getByTestId('status-tokens')).toBeTruthy()
    expect(screen.getByTestId('status-spend')).toBeTruthy()
  })

  it('2. reports the session tokens grouped, and a priced spend', () => {
    const now = Date.now()
    useStore.setState({
      usageRecords: [
        {
          provider: 'deepseek',
          model: 'deepseek-flash',
          inputTokens: 10_000,
          outputTokens: 2_400,
          timestamp: now
        }
      ]
    })
    render(<StatusBar />)

    expect(screen.getByTestId('status-tokens').textContent).toContain(formatTokens(12_400))
    expect(screen.getByTestId('status-tokens').textContent).toContain('12,400')
    // Priced, so a dollar figure — not the "cost unknown" placeholder.
    expect(screen.getByTestId('status-spend').textContent).toMatch(/^\$/)
  })

  it('3. counts only this session, so a new chat starts the spend at zero', () => {
    const now = Date.now()
    useStore.setState({
      sessionStartedAt: now,
      usageRecords: [
        {
          provider: 'deepseek',
          model: 'deepseek-flash',
          inputTokens: 9_999_999,
          outputTokens: 0,
          timestamp: now - 60_000
        }
      ]
    })
    render(<StatusBar />)

    expect(screen.getByTestId('status-tokens').textContent).toContain('0 tokens')
  })

  it('4. no longer carries the model, the interface switch or a hidden overflow menu', () => {
    render(<StatusBar />)

    // The model moved to the composer, which already picks it.
    expect(screen.queryByTestId('status-item-model')).toBeNull()
    // The interface switch moved to the title bar's menu.
    expect(screen.queryByTestId('status-ui-mode')).toBeNull()
    expect(screen.queryByTestId('status-more-hint')).toBeNull()
    // The connection moved to the workspace line, where it is stated once.
    expect(screen.queryByTestId('status-item-workspace')).toBeNull()
  })

  it('5. has no right-click menu at all — the preferences live in the title bar', () => {
    render(<StatusBar />)
    const bar = screen.getByTestId('status-bar')
    expect(bar.getAttribute('oncontextmenu')).toBeNull()
    // Nothing in the line claims to hold more than it shows.
    expect(screen.queryByTestId('status-menu')).toBeNull()
  })

  it('6. the agent state says unknown rather than claiming to be ready', () => {
    useStore.setState({ worker: null })
    render(<StatusBar />)

    expect(screen.getByTestId('status-item-agent').getAttribute('data-state')).toBe('unknown')
  })
})
