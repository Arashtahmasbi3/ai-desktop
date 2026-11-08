// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import { useStore } from '../../src/renderer/src/store'
import ErrorBanner from '../../src/renderer/src/components/ErrorBanner'
import ProjectsSection from '../../src/renderer/src/components/ProjectsSection'
import ProjectCard from '../../src/renderer/src/components/ProjectCard'
import { refusedPathFromMessage } from '../../src/renderer/src/lib/add-project-from-refusal'
import { refusalMessage } from '@shared/refusal'
import type { ProjectRecord, SettingsView } from '@shared/ui'
import type { VpsServerView } from '@shared/vps'

/**
 * S3.3 — one click from a refusal to a project.
 *
 * The refusal the user actually saw was:
 *
 *   Blocked: Path "/opt/zoonestore/apps" is outside project root "/opt/sepehr-motor"
 *
 * Both roots are on the same server. The fix is not to widen the fence — it is to let the user
 * make the second root a project of its own, from the surface that refused. The offer is a button:
 * it opens the add form pre-filled, and the user still presses Add. If a test could make this
 * happen without a click, the feature would have widened scope behind the user's back.
 *
 * No `vi.mock`: `window.api` is the injected boundary and is assigned per test.
 */
const SERVER = 'spmotor'
const MOTOR = '/opt/sepehr-motor'
const ZOONE = '/opt/zoonestore'
/**
 * What the app emits now (S2's `refusalMessage`), built with the same helper the agent uses so the
 * two cannot drift: it names the rule, quotes the refused path and offers a runnable alternative.
 */
const REFUSAL = refusalMessage({
  rule: 'containment',
  detail: `Path "${ZOONE}" is outside project root "${MOTOR}"`,
  path: ZOONE
})
/** What the user actually saw before S2 — the parser has to keep working on it too. */
const LEGACY_REFUSAL = `Blocked: Path "${ZOONE}" is outside project root "${MOTOR}"`

const server: VpsServerView = {
  id: SERVER,
  name: 'spmotor',
  host: '91.107.174.210',
  port: 22,
  username: 'root',
  authType: 'key',
  hasPassword: false,
  hasPrivateKey: true,
  createdAt: 1,
  updatedAt: 1
}

const motor: ProjectRecord = {
  id: 'p-motor',
  name: 'sepehr-motor',
  path: MOTOR,
  createdAt: 1,
  updatedAt: 1,
  environment: 'development',
  type: 'remote',
  vpsId: SERVER,
  exists: true
}

const zoonestore: ProjectRecord = {
  id: 'p-zoone',
  name: 'zoonestore',
  path: ZOONE,
  createdAt: 2,
  updatedAt: 2,
  environment: 'development',
  type: 'remote',
  vpsId: SERVER,
  exists: false
}

const addRemoteProject = vi.fn()
const addProject = vi.fn()
const workspaceInfo = vi.fn()

function settingsView(projects: ProjectRecord[]): SettingsView {
  return { providers: {}, projects, activeProjectId: projects[0]?.id }
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  addRemoteProject.mockReset().mockResolvedValue(settingsView([motor]))
  addProject.mockReset().mockResolvedValue(settingsView([motor]))
  workspaceInfo.mockReset().mockResolvedValue({ isGitRepo: true })
  ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
    settings: { addProject, addRemoteProject, removeProject: vi.fn() },
    projects: { updateMetadata: vi.fn(), open: vi.fn(), getMetadata: vi.fn() },
    dialog: { pickDirectory: vi.fn().mockResolvedValue(null) },
    vps: { workspaceInfo },
    fs: { list: vi.fn().mockResolvedValue([]) },
    agent: {
      goal: { list: vi.fn().mockResolvedValue([]), resolve: vi.fn().mockResolvedValue(null) }
    }
  }
  useStore.setState({
    settings: settingsView([motor]),
    vpsServers: [server],
    vpsConnected: [SERVER],
    vpsServerId: SERVER,
    error: null,
    projectPrefill: null,
    settingsOpen: false,
    settingsTab: null,
    goals: []
  })
})

afterEach(cleanup)

describe('the path a refusal is about', () => {
  it('reads the other root out of the message, never the active one', () => {
    expect(refusedPathFromMessage(REFUSAL, { activePath: MOTOR })).toBe(ZOONE)
    expect(refusedPathFromMessage(LEGACY_REFUSAL, { activePath: MOTOR })).toBe(ZOONE)
    // The same message with no active root still names a path, and it is the one being refused.
    expect(refusedPathFromMessage(LEGACY_REFUSAL)).toBe(ZOONE)
    // An ancestor of the active root is the active root, not a new project.
    expect(refusedPathFromMessage(`Blocked: Path "${MOTOR}/apps" is outside project root "${MOTOR}"`, { activePath: MOTOR })).toBeUndefined()
  })

  it('offers nothing for a failure that names no path', () => {
    expect(refusedPathFromMessage('ssh: handshake failed')).toBeUndefined()
    expect(refusedPathFromMessage('')).toBeUndefined()
    expect(refusedPathFromMessage(null)).toBeUndefined()
    expect(refusedPathFromMessage('Path /opt/zoonestore is outside the project')).toBeUndefined()
  })
})

describe('the error surface offers the refused path as a project', () => {
  it('pre-fills the add form with the path and the server, on a click', () => {
    useStore.setState({ error: REFUSAL })
    render(<ErrorBanner />)

    const button = screen.getByTestId('add-refused-path')
    // Nothing happens until the click: the refusal on its own changes no project.
    expect(useStore.getState().projectPrefill).toBeNull()

    fireEvent.click(button)

    expect(useStore.getState().projectPrefill).toMatchObject({ path: ZOONE, vpsId: SERVER })
    // …and it lands the user on the form that can act on it.
    expect(useStore.getState().settingsOpen).toBe(true)
    expect(useStore.getState().settingsTab).toBe('projects')
    expect(addRemoteProject).not.toHaveBeenCalled()
  })

  it('is absent when the failure names no path', () => {
    useStore.setState({ error: 'VPS "spmotor" is not connected.' })
    render(<ErrorBanner />)
    expect(screen.queryByTestId('add-refused-path')).toBeNull()
  })
})

describe('a project pre-filled from a refusal is the same project as one typed by hand', () => {
  it('adds the same record, path and server both ways', async () => {
    // (a) By hand: type the path into the remote form and press Add.
    render(<ProjectsSection />)
    fireEvent.change(screen.getByTestId('remote-project-path'), { target: { value: ZOONE } })
    fireEvent.click(screen.getByTestId('add-remote-project'))
    await waitFor(() => expect(addRemoteProject).toHaveBeenCalledTimes(1))
    const byHand = addRemoteProject.mock.calls[0]
    cleanup()

    // (b) From the refusal: click the strip, then press Add on the pre-filled form.
    addRemoteProject.mockClear()
    useStore.setState({ error: REFUSAL })
    render(<ErrorBanner />)
    fireEvent.click(screen.getByTestId('add-refused-path'))
    cleanup()

    render(<ProjectsSection />)
    expect((screen.getByTestId('remote-project-path') as HTMLInputElement).value).toBe(ZOONE)
    expect((screen.getByTestId('remote-project-server') as HTMLSelectElement).value).toBe(SERVER)
    fireEvent.click(screen.getByTestId('add-remote-project'))
    await waitFor(() => expect(addRemoteProject).toHaveBeenCalledTimes(1))
    const fromRefusal = addRemoteProject.mock.calls[0]

    expect(fromRefusal).toEqual(byHand)
    // The name is derived from the path in both flows, so the two records cannot differ in it.
    expect(fromRefusal[1]).toBe(ZOONE)
    expect(fromRefusal[2]).toBe(SERVER)
  })

  it('can be added while the server is only saved, not connected', async () => {
    // A second root on a server whose session is down is still a project on that server.
    useStore.setState({ vpsConnected: [], projectPrefill: { path: ZOONE, vpsId: SERVER, at: 3 } })
    render(<ProjectsSection />)

    fireEvent.click(screen.getByTestId('add-remote-project'))
    await waitFor(() => expect(addRemoteProject).toHaveBeenCalledTimes(1))
    expect(addRemoteProject.mock.calls[0]?.slice(1)).toEqual([ZOONE, SERVER])
  })
})

describe('the project card keeps a remote root on its server', () => {
  /**
   * The control is the local folder picker, whose accessible name is `settings.missingPath` ("Path
   * not found"). Asserting on the label rather than on a test id matters: the point is that the
   * *control the user sees* is gone, and a click target that exists but is unfindable would make
   * this test pass for the wrong reason.
   */
  const locateControls = (): number =>
    screen.queryAllByLabelText(i18n.t('settings.missingPath')).length

  it('offers no local folder picker for a disconnected remote project', () => {
    render(<ProjectCard project={zoonestore} />)
    // The card really rendered — otherwise "no Locate" would be true of an empty page.
    expect(screen.getByText(ZOONE)).toBeTruthy()
    // `exists: false` here means "the server is not connected", not "the folder is gone".
    expect(locateControls()).toBe(0)
  })

  it('still offers it for a local project whose folder is missing', () => {
    render(
      <ProjectCard
        project={{
          id: 'p-local',
          name: 'old-local',
          path: 'C:\\gone\\old-local',
          createdAt: 1,
          updatedAt: 1,
          environment: 'development',
          type: 'local',
          exists: false
        }}
      />
    )
    expect(locateControls()).toBe(1)
  })
})

/**
 * The stage's keys live outside the repo (the two shipped locale files are frozen while this work
 * is in flight), so nothing else checks them. Merging them must not break the Persian build, and a
 * key nobody wrote a translation for must not reach `en.json` alone.
 */
describe('S3 staged i18n keys are mergeable', () => {
  const DIR = join(__dirname, '..', 'fixtures', 'i18n')

  function leaves(node: unknown, prefix = ''): string[] {
    if (typeof node !== 'object' || node === null) return [prefix]
    return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
      leaves(value, prefix === '' ? key : prefix + '.' + key)
    )
  }

  function load(name: string): unknown {
    return JSON.parse(readFileSync(join(DIR, name), 'utf8')) as unknown
  }

  it('are the same key set in English and Persian, with no empty translation', () => {
    const en = leaves(load('secondproject-en.json')).sort()
    const fa = leaves(load('secondproject-fa.json')).sort()

    expect(en.length).toBeGreaterThan(0)
    expect(fa).toEqual(en)
    expect(JSON.stringify(load('secondproject-en.json'))).not.toMatch(/:\s*""/)
    expect(JSON.stringify(load('secondproject-fa.json'))).not.toMatch(/:\s*""/)
  })
})
