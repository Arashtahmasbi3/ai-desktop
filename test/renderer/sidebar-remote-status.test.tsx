// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import Sidebar from '../../src/renderer/src/components/Sidebar'
import ProjectBadges from '../../src/renderer/src/components/ProjectBadges'
import { useStore } from '../../src/renderer/src/store'
import type { ProjectRecord, SettingsView, WorkerStatus } from '@shared/ui'

/**
 * v2.9.2 — a disconnected remote project is not a missing local folder.
 *
 * Found live on the user's own machine: both projects are remote (`/opt/sepehr-motor`,
 * `/home/deploy/workspaces/peymabim`), and at startup neither VPS is connected, so the
 * sidebar showed an amber dot, **"Path not found"** and a **Locate** button — a *local*
 * folder picker for a path that lives on a server. The project was fine; only the label was
 * wrong, and it is the kind of wrong that makes a user think their work is gone.
 *
 * Root cause: main sets a remote project's `exists` to "its VPS is connected"
 * (`app-services.ts`), and `projectState()` checked `exists` *before* the remote branch, so
 * "not connected" rendered as "missing". `store.ts` already guards this
 * (`project.exists === false && project.type !== 'remote'`); the sidebar did not.
 *
 * Verified to have teeth: restoring the old ordering makes the first test fail.
 */
beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

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

const remoteDisconnected: ProjectRecord = {
  id: 'p-remote',
  name: 'sepehr-motor',
  path: '/opt/sepehr-motor',
  createdAt: 1,
  updatedAt: 1,
  environment: 'development',
  // What main sends while the VPS is down: `exists` means "the server is connected".
  exists: false,
  type: 'remote',
  vpsId: 'srv-1'
}

const localMissing: ProjectRecord = {
  id: 'p-local',
  name: 'old-local',
  path: 'C:\\gone\\old-local',
  createdAt: 1,
  updatedAt: 1,
  environment: 'development',
  exists: false,
  type: 'local'
}

function setState(projects: ProjectRecord[], vpsConnected: string[] = []): void {
  const settings: SettingsView = { providers: {}, projects, activeProjectId: projects[0]?.id }
  useStore.setState({ settings, worker, chats: [], vpsConnected })
}

beforeEach(() => {
  useStore.setState({ settings: null, worker, chats: [], vpsConnected: [] })
})

/**
 * The connection dot for each row carries the state as its `aria-label` (ProjectBadges), so
 * counting labels counts rows in that state — the dot is the only element with one.
 */
function rowsInState(key: string): number {
  return screen.queryAllByLabelText(i18n.t(key)).length
}

describe('a remote project whose VPS is down (v2.9.2)', () => {
  it('does not report it as a missing path', () => {
    setState([remoteDisconnected])
    render(<Sidebar />)

    // The bug: "Path not found" for a path that was never on this machine.
    expect(screen.queryByText(i18n.t('sidebar.missingPath'))).toBeNull()
    expect(screen.queryByText(i18n.t('sidebar.connMissing'))).toBeNull()
  })

  it('names the real state: not connected', () => {
    setState([remoteDisconnected])
    render(<Sidebar />)

    // The intended state, and the whole point of the fix — this is what changed in the DOM.
    expect(rowsInState('sidebar.connDisconnected')).toBe(1)
    expect(rowsInState('sidebar.connMissing')).toBe(0)
  })

  it('shows connected once its VPS is up', () => {
    setState([remoteDisconnected])
    render(<Sidebar />)

    /*
     * The Sidebar calls `refreshVps()` on mount, which republishes `vpsConnected` from main
     * (and resets it when there is no IPC in jsdom), so the connected set is applied after
     * the render — that is also the real order of events in the app: the list paints first,
     * then the connection status arrives.
     */
    act(() => {
      useStore.setState({ vpsConnected: ['srv-1'] })
    })

    expect(rowsInState('sidebar.connConnected')).toBe(1)
    expect(rowsInState('sidebar.connMissing')).toBe(0)
  })

  it('still reports a genuinely missing LOCAL folder, and only that', () => {
    // The guard must not disable the feature it guards.
    setState([localMissing, remoteDisconnected])
    render(<Sidebar />)

    expect(screen.getAllByText(i18n.t('sidebar.missingPath')).length).toBeGreaterThan(0)
    // Exactly one row is missing — the local one; the remote one is merely disconnected.
    expect(rowsInState('sidebar.connMissing')).toBe(1)
    expect(rowsInState('sidebar.connDisconnected')).toBe(1)
  })
})

describe('ProjectBadges does not double-report a remote path (v2.9.2)', () => {
  it('renders a disconnected remote project without a missing-path label', () => {
    render(<ProjectBadges project={remoteDisconnected} serverName="spmotor" />)
    expect(screen.queryByText(i18n.t('sidebar.missingPath'))).toBeNull()
    expect(screen.getByText('(spmotor)')).toBeTruthy()
  })
})
