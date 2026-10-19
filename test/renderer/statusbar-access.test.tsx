// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import StatusBar from '../../src/renderer/src/components/StatusBar'
import { useStore } from '../../src/renderer/src/store'
import { deriveRunAccess } from '../../src/renderer/src/lib/run-access'
import type { ProjectRecord, SettingsView, WorkerStatus } from '@shared/ui'
import type { VpsServerView } from '@shared/vps'

/**
 * U3-4 — the status bar says what the run may do, and where.
 *
 * The footer named the approval mode and nothing else, so "auto-write" read the same for a local
 * project as for a server, and Plan Mode — the one state that overrides the approval gate entirely —
 * was invisible. The fix is **one** item: a short label, the mode, and the sentence in the tooltip.
 *
 * These cases pin three things:
 *  1. the value comes from the store's own state (`planMode`, `settings.approvalMode`, the active
 *     project), not from a guess or a second copy;
 *  2. plan mode outranks the approval mode, because a plan run never reaches the gate;
 *  3. a long label truncates and keeps its full sentence in `title`, so it can never wrap the bar
 *     or push the other items out.
 *
 * The keys live in `_research/i18n/connect-en.json` until they are merged, so they are injected here
 * and the suite passes on both sides of that merge.
 */
const PENDING_EN = {
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

const localProject: ProjectRecord = {
  id: 'p-local',
  name: 'demo',
  path: 'C:\\work\\demo',
  createdAt: 1,
  updatedAt: 1,
  environment: 'development',
  exists: true,
  type: 'local'
}

const remoteProject: ProjectRecord = {
  ...localProject,
  id: 'p-remote',
  name: 'demo-project',
  path: '/opt/demo-project',
  exists: false,
  type: 'remote',
  vpsId: 'srv-1'
}

function view(
  projects: ProjectRecord[],
  approvalMode: 'ask' | 'auto-write' | 'full' = 'ask'
): SettingsView {
  return { providers: {}, projects, activeProjectId: projects[0]?.id, approvalMode }
}

beforeAll(async () => {
  i18n.addResourceBundle('en', 'translation', PENDING_EN, true, true)
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

beforeEach(() => {
  useStore.setState({
    ready: true,
    worker,
    remote: null,
    chats: [],
    settings: null,
    planMode: false,
    vpsServers: [],
    vpsStatus: { status: 'disconnected' },
    vpsConnected: [],
    vpsServerId: undefined
  })
})

/** The label the reader sees, built from the keys the component uses. */
function label(scopeKey: string, modeKey: string): string {
  return `${i18n.t(scopeKey)} · ${i18n.t(modeKey)}`
}

describe('what the access item says in each state', () => {
  it('local project, ask mode', () => {
    useStore.setState({ settings: view([localProject], 'ask') })
    render(<StatusBar />)

    const item = screen.getByTestId('status-item-access')
    expect(item.getAttribute('data-scope')).toBe('local')
    expect(item.getAttribute('data-mode')).toBe('ask')
    expect(screen.getByTestId('status-access-label').textContent).toBe(
      label('statusBar.accessScopeLocal', 'statusBar.accessAsk')
    )
    expect(item.getAttribute('title')).toBe(
      `${i18n.t('statusBar.accessTitleLocal')} ${i18n.t('statusBar.accessTitleAsk')}`
    )
  })

  it('remote project, auto-write, naming the server in the sentence', () => {
    useStore.setState({ settings: view([remoteProject], 'auto-write'), vpsServers: [SERVER] })
    render(<StatusBar />)

    const item = screen.getByTestId('status-item-access')
    expect(item.getAttribute('data-scope')).toBe('remote')
    expect(item.getAttribute('data-mode')).toBe('auto-write')
    expect(screen.getByTestId('status-access-label').textContent).toBe(
      label('statusBar.accessScopeRemote', 'statusBar.accessAutoWrite')
    )
    expect(item.getAttribute('title')).toBe(
      `${i18n.t('statusBar.accessTitleRemote', { server: 'prod-1' })} ${i18n.t(
        'statusBar.accessTitleAutoWrite'
      )}`
    )
  })

  it('remote project with no server chosen says so instead of naming one', () => {
    useStore.setState({ settings: view([{ ...remoteProject, vpsId: undefined }], 'ask') })
    render(<StatusBar />)

    expect(screen.getByTestId('status-item-access').getAttribute('title')).toContain(
      i18n.t('statusBar.accessTitleRemoteNoServer')
    )
  })

  it('full access is the mode that must stand out', () => {
    useStore.setState({ settings: view([localProject], 'full') })
    render(<StatusBar />)

    const item = screen.getByTestId('status-item-access')
    expect(item.getAttribute('data-mode')).toBe('full')
    expect(screen.getByTestId('status-access-label').textContent).toBe(
      label('statusBar.accessScopeLocal', 'statusBar.accessFull')
    )
    expect(item.className).toContain('text-danger')
  })

  it('no project open', () => {
    useStore.setState({ settings: view([]) })
    render(<StatusBar />)

    const item = screen.getByTestId('status-item-access')
    expect(item.getAttribute('data-scope')).toBe('none')
    expect(screen.getByTestId('status-access-label').textContent).toBe(
      label('statusBar.accessScopeNone', 'statusBar.accessAsk')
    )
    expect(item.getAttribute('title')).toContain(i18n.t('statusBar.accessTitleNone'))
  })
})

describe('plan mode is the answer, not the approval mode', () => {
  it('outranks full access, because a plan run never reaches the gate', () => {
    useStore.setState({ settings: view([localProject], 'full'), planMode: true })
    render(<StatusBar />)

    const item = screen.getByTestId('status-item-access')
    expect(item.getAttribute('data-mode')).toBe('plan')
    expect(screen.getByTestId('status-access-label').textContent).toBe(
      label('statusBar.accessScopeLocal', 'statusBar.accessPlan')
    )
    expect(item.getAttribute('title')).toContain(i18n.t('statusBar.accessTitlePlan'))
    expect(item.getAttribute('title')).not.toContain(i18n.t('statusBar.accessTitleFull'))
  })
})

describe('the item reflects the store, not a first render', () => {
  it('updates when the approval mode changes underneath it', () => {
    useStore.setState({ settings: view([localProject], 'ask') })
    render(<StatusBar />)

    expect(screen.getByTestId('status-item-access').getAttribute('data-mode')).toBe('ask')

    act(() => useStore.setState({ settings: view([localProject], 'full') }))

    expect(screen.getByTestId('status-item-access').getAttribute('data-mode')).toBe('full')
  })

  it('updates when plan mode is switched on', () => {
    useStore.setState({ settings: view([localProject], 'auto-write') })
    render(<StatusBar />)

    expect(screen.getByTestId('status-item-access').getAttribute('data-mode')).toBe('auto-write')

    act(() => useStore.setState({ planMode: true }))

    expect(screen.getByTestId('status-item-access').getAttribute('data-mode')).toBe('plan')
  })
})

describe('a long label cannot break the bar', () => {
  it('truncates, keeps the full sentence in the tooltip, and may shrink in the flex row', () => {
    useStore.setState({ settings: view([remoteProject], 'auto-write'), vpsServers: [SERVER] })
    render(<StatusBar />)

    const item = screen.getByTestId('status-item-access')
    const text = screen.getByTestId('status-access-label')

    // The two mechanisms: the flex child may shrink (`min-w-0`), and the text itself is cut off.
    expect(item.className).toContain('min-w-0')
    expect(text.className).toContain('truncate')
    expect(text.className).toMatch(/max-w-/)
    // Nothing is lost — the whole sentence is still reachable as the tooltip.
    expect(item.getAttribute('title')).toBe(
      `${i18n.t('statusBar.accessTitleRemote', { server: 'prod-1' })} ${i18n.t(
        'statusBar.accessTitleAutoWrite'
      )}`
    )
  })

  it('is one item, and the mode is no longer a second copy of it', () => {
    useStore.setState({ settings: view([localProject], 'ask') })
    render(<StatusBar />)

    expect(document.querySelectorAll('[data-testid="status-item-access"]').length).toBe(1)
    // The old cycling button that printed the raw mode id is gone: the mode is answered once.
    expect(screen.queryByTestId('status-item-mode')).toBeNull()
  })
})

describe('deriveRunAccess (the pure decision)', () => {
  it('maps each approval mode onto its own label key', () => {
    expect(deriveRunAccess({ planMode: false, approvalMode: 'ask' }).modeKey).toBe('statusBar.accessAsk')
    expect(deriveRunAccess({ planMode: false, approvalMode: 'auto-write' }).modeKey).toBe(
      'statusBar.accessAutoWrite'
    )
    expect(deriveRunAccess({ planMode: false, approvalMode: 'full' }).modeKey).toBe(
      'statusBar.accessFull'
    )
  })

  it('reports "no project" only when there is no active project', () => {
    expect(deriveRunAccess({ planMode: false, approvalMode: 'ask' }).scope).toBe('none')
    expect(
      deriveRunAccess({ planMode: false, approvalMode: 'ask', project: { type: 'local' } }).scope
    ).toBe('local')
    expect(
      deriveRunAccess({ planMode: false, approvalMode: 'ask', project: { type: 'remote' } }).scope
    ).toBe('remote')
  })

  it('only names a server for a remote project', () => {
    expect(
      deriveRunAccess({
        planMode: false,
        approvalMode: 'ask',
        project: { type: 'local' },
        serverName: 'prod-1'
      }).serverName
    ).toBeUndefined()
    expect(
      deriveRunAccess({
        planMode: false,
        approvalMode: 'ask',
        project: { type: 'remote', vpsId: 'srv-1' },
        serverName: 'prod-1'
      }).serverName
    ).toBe('prod-1')
  })
})
