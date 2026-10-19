// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import i18n from '../../src/renderer/src/i18n'
import Sidebar from '../../src/renderer/src/components/Sidebar'
import ExecutionBar from '../../src/renderer/src/components/ExecutionBar'
import ErrorBanner from '../../src/renderer/src/components/ErrorBanner'
import { useStore } from '../../src/renderer/src/store'
import {
  looksLikeConnectionFailure,
  serverForConnectionFailure,
  testSummary
} from '../../src/renderer/src/lib/connection-test'
import type { ConnectionTestResult, VpsServerView } from '@shared/vps'
import type { ProjectRecord, SettingsView, WorkerStatus } from '@shared/ui'

/**
 * B2-2 — the connection test exists; put it where a connection problem is felt.
 *
 * v4.1 added a real TCP probe (`vps:testConnection`) and one button for it on the Servers page.
 * That answers "is the host reachable?", but only for a user who knows the page exists: every
 * surface that *reports* a failure — the sidebar's project row, the workspace line's item,
 * and the strip after a failed run — offered no way to ask. These cases pin the reachability, and
 * they pin the two rules that keep it honest:
 *
 *  - **one call site**: `window.api.vps.testConnection` is called in `ConnectionTest.tsx` and
 *    nowhere else, so the surfaces cannot drift into three half-implementations;
 *  - **no control that cannot act**: with no server to test, the control is absent, never disabled
 *    and silent.
 */

/**
 * The keys land in `_research/i18n/connect-*.json` and are merged into the locale files afterwards.
 * Injecting them here keeps the suite green on both sides of that merge.
 */
const PENDING_EN = {
  connect: {
    testShort: 'Test',
    testRunFrom: 'Test the connection from this computer',
    testRunning: 'Testing…',
    testResultTitle: '{{summary}} — tested from this computer'
  },
  statusBar: {
    accessAsk: 'Ask',
    accessAutoWrite: 'Auto-write',
    accessFull: 'Full access',
    accessPlan: 'Plan',
    accessScopeLocal: 'Local',
    accessScopeRemote: 'Remote',
    accessScopeNone: 'No project',
    accessTitleLocal: 'This run works in a local project on this computer.',
    accessTitleRemote: 'This run works on the server {{server}}.',
    accessTitleRemoteNoServer: 'This remote project has no server selected yet.',
    accessTitleNone: 'No project is open, so this run has no workspace of its own.',
    accessTitlePlan: 'Plan mode is on: the agent drafts a plan and runs no tools.',
    accessTitleAsk: 'Ask: every tool call waits for your approval first.',
    accessTitleAutoWrite: 'Auto-write: reads and searches run freely; writes and shell commands ask first.',
    accessTitleFull: 'Full access: every tool runs without asking until you turn it off.'
  }
}

const OPEN: ConnectionTestResult = {
  ok: true,
  host: '10.0.0.5',
  port: 2222,
  outcome: 'open',
  latencyMs: 82,
  from: 'this-machine'
}

const TIMED_OUT: ConnectionTestResult = {
  ok: false,
  host: '10.0.0.5',
  port: 2222,
  outcome: 'timeout',
  message: 'timed out',
  from: 'this-machine'
}

const SERVER: VpsServerView = {
  id: 'srv-1',
  name: 'prod-1',
  host: '10.0.0.5',
  port: 2222,
  username: 'deploy',
  authType: 'key',
  hasPassword: false,
  hasPrivateKey: true,
  createdAt: 1,
  updatedAt: 1
}

const OTHER_SERVER: VpsServerView = {
  ...SERVER,
  id: 'srv-2',
  name: 'staging-2',
  host: '10.0.0.9'
}

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

const remoteProject: ProjectRecord = {
  id: 'p-remote',
  name: 'demo-project',
  path: '/opt/demo-project',
  createdAt: 1,
  updatedAt: 1,
  environment: 'development',
  // What main sends while the VPS is down: `exists` means "the server is connected".
  exists: false,
  type: 'remote',
  vpsId: 'srv-1'
}

function settings(projects: ProjectRecord[], activeProjectId?: string): SettingsView {
  return { providers: {}, projects, activeProjectId: activeProjectId ?? projects[0]?.id }
}

/** Stub the bridge with only what a surface needs; nothing here re-implements the probe. */
function stubApi(overrides: {
  testConnection?: (id: string) => Promise<ConnectionTestResult>
  connected?: string[]
}): (id: string) => Promise<ConnectionTestResult> {
  const testConnection = vi.fn(overrides.testConnection ?? (async () => OPEN))
  ;(window as unknown as { api: unknown }).api = {
    vps: {
      testConnection,
      list: async () => [SERVER, OTHER_SERVER],
      status: async () => ({ status: 'disconnected' }),
      connected: async () => overrides.connected ?? []
    }
  }
  return testConnection
}

beforeAll(async () => {
  i18n.addResourceBundle('en', 'translation', PENDING_EN, true, true)
  await i18n.changeLanguage('en')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

beforeEach(() => {
  useStore.setState({
    ready: true,
    worker,
    remote: null,
    settings: null,
    chats: [],
    error: null,
    planMode: false,
    vpsServers: [],
    // R5: the per-server map is the source of truth, so a case starts with no known facts and
    // the connected set (stubbed per test) only seeds servers that have no event yet.
    vpsStates: {},
    vpsStatus: { status: 'disconnected' },
    vpsConnected: [],
    vpsServerId: undefined
  })
})

describe('one implementation of the test, wherever it is offered', () => {
  const RENDERER = join(process.cwd(), 'src', 'renderer', 'src')

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) return sourceFiles(full)
      return /\.(tsx|ts)$/.test(entry.name) ? [full] : []
    })
  }

  const files = sourceFiles(RENDERER)
  const name = (file: string): string => relative(RENDERER, file).split(sep).join('/')

  it('calls the IPC channel in exactly one file', () => {
    const offenders = files
      .filter((file) => /window\.api\.vps\.testConnection\s*\(/.test(readFileSync(file, 'utf8')))
      .map(name)
    expect(offenders).toEqual(['components/ConnectionTest.tsx'])
  })

  it('puts the Servers page on that same hook instead of its own copy', () => {
    const panel = readFileSync(join(RENDERER, 'components', 'Vps', 'VpsPanel.tsx'), 'utf8')
    expect(panel).not.toMatch(/window\.api\.vps\.testConnection\s*\(/)
    expect(panel).toContain('useConnectionTest()')
    // …and words the result with the shared helper, so both surfaces say the same sentence.
    expect(panel).toContain("from '../../lib/connection-test'")
  })
})

describe('the result shape decides what the control says', () => {
  it('words an open port with the port and the handshake latency', () => {
    expect(testSummary(OPEN, i18n.t)).toBe(i18n.t('vps.testOpen', { port: 2222, ms: 82 }))
  })

  it("keeps the operating system's own words for a failure", () => {
    expect(testSummary(TIMED_OUT, i18n.t)).toBe(
      i18n.t('vps.testFailed', { port: 2222, reason: 'timed out' })
    )
  })

  it('falls back to the outcome name when the OS said nothing', () => {
    const silent: ConnectionTestResult = { ...TIMED_OUT, message: undefined, outcome: 'refused' }
    expect(testSummary(silent, i18n.t)).toBe(
      i18n.t('vps.testFailed', { port: 2222, reason: 'refused' })
    )
  })
})

describe('which failures deserve a test, and about which server', () => {
  it('recognises the messages the SSH layer and the probe actually produce', () => {
    for (const message of [
      'The selected VPS "prod-1" is not connected. Tell the user to add or connect it, then retry.',
      'connect ECONNREFUSED 10.0.0.5:2222',
      'ssh: handshake failed: read ECONNRESET',
      'The remote command timed out after 60s',
      'Host key verification failed',
      'getaddrinfo ENOTFOUND prod-1.internal'
    ]) {
      expect(looksLikeConnectionFailure(message), message).toBe(true)
    }
  })

  it('leaves every other failure alone — a test it cannot answer is noise', () => {
    for (const message of [
      'No API key is configured for deepseek',
      'Path escapes the project root',
      'The sandbox is unavailable on this machine',
      ''
    ]) {
      expect(looksLikeConnectionFailure(message), message).toBe(false)
    }
  })

  it('tests the server the message names, not the one the project happens to use', () => {
    expect(
      serverForConnectionFailure({
        message: 'staging-2 is not connected',
        servers: [SERVER, OTHER_SERVER],
        projectServerId: 'srv-1'
      })
    ).toBe('srv-2')
  })

  it('accepts a bare host as the reference', () => {
    expect(
      serverForConnectionFailure({
        message: 'connect ECONNREFUSED 10.0.0.9:2222',
        servers: [SERVER, OTHER_SERVER]
      })
    ).toBe('srv-2')
  })

  it("falls back to the run's own server when the message names none", () => {
    expect(
      serverForConnectionFailure({
        message: 'ssh: handshake failed',
        servers: [SERVER, OTHER_SERVER],
        projectServerId: 'srv-1'
      })
    ).toBe('srv-1')
    expect(
      serverForConnectionFailure({
        message: 'ssh: handshake failed',
        servers: [SERVER, OTHER_SERVER],
        selectedServerId: 'srv-2'
      })
    ).toBe('srv-2')
  })

  it('answers "nothing to test" when the failure is not about a connection', () => {
    expect(
      serverForConnectionFailure({
        message: 'No API key is configured for deepseek',
        servers: [SERVER],
        projectServerId: 'srv-1'
      })
    ).toBeUndefined()
  })

  it('answers "nothing to test" when no server can be named', () => {
    expect(serverForConnectionFailure({ message: 'ssh: handshake failed', servers: [] })).toBeUndefined()
  })
})

describe('the sidebar row for a disconnected server', () => {
  it('offers the test, and says what it did when it runs', async () => {
    stubApi({})
    useStore.setState({ settings: settings([remoteProject]) })
    render(<Sidebar />)

    const button = await screen.findByTestId('project-connection-test-p-remote-button')
    expect(button.textContent).toContain(i18n.t('vps.testConnection'))
    // It says how the probe runs, because "reachable" from another machine means nothing here.
    expect(button.getAttribute('title')).toBe(i18n.t('connect.testRunFrom'))
    expect(screen.queryByTestId('project-connection-test-p-remote-result')).toBeNull()

    fireEvent.click(button)

    const result = await screen.findByTestId('project-connection-test-p-remote-result')
    expect(result.textContent).toBe(i18n.t('vps.testOpen', { port: 2222, ms: 82 }))
    expect(result.getAttribute('title')).toBe(
      i18n.t('connect.testResultTitle', {
        summary: i18n.t('vps.testOpen', { port: 2222, ms: 82 })
      })
    )
  })

  it('says what it found when the port is not open', async () => {
    stubApi({ testConnection: async () => TIMED_OUT })
    useStore.setState({ settings: settings([remoteProject]) })
    render(<Sidebar />)

    fireEvent.click(await screen.findByTestId('project-connection-test-p-remote-button'))

    const result = await screen.findByTestId('project-connection-test-p-remote-result')
    expect(result.textContent).toBe(
      i18n.t('vps.testFailed', { port: 2222, reason: 'timed out' })
    )
    expect(result.className).toContain('text-warning')
  })

  it('is absent for a local project', () => {
    stubApi({})
    const local: ProjectRecord = { ...remoteProject, id: 'p-local', type: 'local', exists: true, vpsId: undefined }
    useStore.setState({ settings: settings([local]) })
    render(<Sidebar />)

    expect(screen.queryByTestId('project-connection-test-p-local-button')).toBeNull()
  })

  it('is absent when the remote project has no server yet — not disabled, absent', () => {
    stubApi({})
    const noServer: ProjectRecord = { ...remoteProject, id: 'p-noserver', vpsId: undefined }
    useStore.setState({ settings: settings([noServer]) })
    render(<Sidebar />)

    expect(screen.queryByTestId('project-connection-test-p-noserver-button')).toBeNull()
    // The row still explains the real state instead of going quiet.
    expect(screen.getAllByText(new RegExp(i18n.t('sidebar.remoteNoVps'))).length).toBeGreaterThan(0)
  })

  it('is absent once the server is connected — there is no problem to diagnose', async () => {
    stubApi({ connected: ['srv-1'] })
    useStore.setState({ settings: settings([remoteProject]) })
    render(<Sidebar />)

    await waitFor(() =>
      expect(screen.queryByTestId('project-connection-test-p-remote-button')).toBeNull()
    )
  })
})

describe('the workspace line that reports the remote connection', () => {
  it('offers the test when the server is disconnected', async () => {
    stubApi({ testConnection: async () => TIMED_OUT })
    useStore.setState({ settings: settings([remoteProject]), vpsServers: [SERVER] })
    render(<ExecutionBar timelineOpen={false} onToggleTimeline={() => undefined} />)

    const item = screen.getByTestId('status-item-workspace')
    expect(item.getAttribute('data-connection')).toBe('disconnected')
    const button = screen.getByTestId('status-connection-test-button')
    expect(button.textContent).toContain(i18n.t('connect.testShort'))

    fireEvent.click(button)

    const result = await screen.findByTestId('status-connection-test-result')
    expect(result.textContent).toBe(
      i18n.t('vps.testFailed', { port: 2222, reason: 'timed out' })
    )
  })

  it('offers it when the connection attempt errored', () => {
    stubApi({})
    useStore.setState({
      settings: settings([remoteProject]),
      vpsServers: [SERVER],
      // R5: the error is this server's own fact, not a global slot that names one host.
      vpsStates: { 'srv-1': { status: 'error', serverId: 'srv-1', error: 'Connection failed' } }
    })
    render(<ExecutionBar timelineOpen={false} onToggleTimeline={() => undefined} />)

    expect(screen.getByTestId('status-item-workspace').getAttribute('data-connection')).toBe('error')
    expect(screen.getByTestId('status-connection-test-button')).toBeTruthy()
  })

  it('is absent while the connection is healthy, and for a local workspace', () => {
    stubApi({})
    useStore.setState({
      settings: settings([remoteProject]),
      vpsServers: [SERVER],
      vpsConnected: ['srv-1']
    })
    render(<ExecutionBar timelineOpen={false} onToggleTimeline={() => undefined} />)

    expect(screen.getByTestId('status-item-workspace').getAttribute('data-connection')).toBe('connected')
    expect(screen.queryByTestId('status-connection-test-button')).toBeNull()

    cleanup()

    const local: ProjectRecord = { ...remoteProject, type: 'local', exists: true, vpsId: undefined }
    useStore.setState({ settings: settings([local]), vpsConnected: [] })
    render(<ExecutionBar timelineOpen={false} onToggleTimeline={() => undefined} />)

    expect(screen.getByTestId('status-item-workspace').getAttribute('data-connection')).toBe('local')
    expect(screen.queryByTestId('status-connection-test-button')).toBeNull()
  })
})

describe('the strip after a failed run', () => {
  const failure =
    'The selected VPS "staging-2" is not connected. Tell the user to add or connect it, then retry.'

  it('offers the test, about the server the message names', async () => {
    const testConnection = stubApi({ testConnection: async () => OPEN })
    useStore.setState({
      error: failure,
      vpsServers: [SERVER, OTHER_SERVER],
      settings: settings([remoteProject]),
      vpsServerId: 'srv-1'
    })
    render(<ErrorBanner />)

    expect(screen.getByTestId('error-banner').textContent).toContain('staging-2')
    fireEvent.click(screen.getByTestId('error-connection-test-button'))

    // The message names staging-2, so that is what gets tested — not the project's server.
    expect(testConnection).toHaveBeenCalledWith('srv-2')
    const result = await screen.findByTestId('error-connection-test-result')
    expect(result.textContent).toBe(i18n.t('vps.testOpen', { port: 2222, ms: 82 }))
  })

  it('is absent when the failure is not about a connection', () => {
    stubApi({})
    useStore.setState({
      error: 'No API key is configured for deepseek',
      vpsServers: [SERVER],
      settings: settings([remoteProject])
    })
    render(<ErrorBanner />)

    expect(screen.getByTestId('error-banner')).toBeTruthy()
    expect(screen.queryByTestId('error-connection-test-button')).toBeNull()
  })

  it('is absent when the failure names no server and the run has none', () => {
    stubApi({})
    useStore.setState({
      error: 'connect ECONNREFUSED',
      vpsServers: [],
      settings: settings([{ ...remoteProject, vpsId: undefined }])
    })
    render(<ErrorBanner />)

    expect(screen.queryByTestId('error-connection-test-button')).toBeNull()
  })

  it('still closes the strip', () => {
    stubApi({})
    useStore.setState({ error: 'ssh: handshake failed', vpsServers: [SERVER], settings: settings([remoteProject]) })
    render(<ErrorBanner />)

    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.close') }))
    expect(useStore.getState().error).toBeNull()
  })
})
