import { describe, expect, it } from 'vitest'
import { posix, win32 } from 'node:path'
import {
  DEFAULT_PORT,
  INVARIANTS,
  LIVE_SHOT,
  RUNTIME_DEPS,
  SELECTORS,
  checkDom,
  debugUrl,
  electronArgs,
  findRawUuids,
  launchEnv,
  stagePlan,
  stagingRoot,
  type DomQueries
} from '../../scripts/lib/verify-ui-core.mjs'

/**
 * The part of "does the running app tell the truth?" that can be proven here.
 *
 * `scripts/verify-ui.mjs` launches a real Electron window and reads it over CDP; that half needs a display and a
 * machine that lets an unsigned exe execute, so it cannot run in this suite. Everything that decides *whether what the
 * window rendered is a lie* is data in, data out — and this file is what keeps that decision honest. A check that
 * silently stopped matching (a renamed test id, a regex that no longer fires) would make the live script pass on a
 * broken page, which is the exact failure this repository is trying to leave behind.
 */
const UUID = '3f2a9c1e-4b7d-4e8f-9a1b-2c3d4e5f6a7b'

/** A page that satisfies every invariant: the fixture each failure case is a one-field edit of. */
const cleanQueries = (over: Partial<DomQueries> = {}): DomQueries => ({
  statusBarCount: 1,
  uiMode: {
    exists: true,
    buttons: [
      { pressed: 'true', label: 'Simple' },
      { pressed: 'false', label: 'Advanced' }
    ]
  },
  workspaceConnection: 'local',
  headerConnection: null,
  connections: [{ owner: 'status-item-workspace', value: 'local' }],
  ...over
})

const CLEAN_TEXT = 'AI Desktop\nmy project\nC:/proj\nlocal\n0 tokens\n$0.00'

const onlyFailure = (text: string, queries: DomQueries): string => {
  const report = checkDom(text, queries)
  expect(report.ok).toBe(false)
  expect(report.failures).toHaveLength(1)
  return report.failures[0]!.message
}

describe('stagingRoot', () => {
  it('stages outside Documents on win32, because an unsigned exe may not execute from there', () => {
    const root = stagingRoot({ platform: 'win32' })
    expect(root.toLowerCase()).toBe('c:\\aidverify-verify')
    expect(root.toLowerCase()).not.toContain('documents')
  })

  it('uses the temp directory elsewhere', () => {
    expect(stagingRoot({ platform: 'linux', tmpdir: '/tmp' })).toBe('/tmp/aidverify-verify')
  })

  it('honours an explicit root', () => {
    expect(stagingRoot({ root: 'D:\\elsewhere', platform: 'win32' })).toBe('D:\\elsewhere')
  })
})

describe('stagePlan', () => {
  const plan = stagePlan({ repoRoot: 'C:\\repo', platform: 'win32', root: 'C:\\stage' })

  it('creates the packaged-like layout the shipped app has', () => {
    expect(plan.appDir).toBe(win32.join('C:\\stage', 'app'))
    expect(plan.electronDir).toBe(win32.join('C:\\stage', 'electron'))
    expect(plan.profileDir).toBe(win32.join('C:\\stage', 'profile'))
    // `package.json` says `main: ./out/main/index.js`, so out/ must sit beside it.
    expect(plan.copies.map((copy) => copy.to)).toEqual(
      expect.arrayContaining([
        win32.join(plan.appDir, 'out'),
        win32.join(plan.appDir, 'package.json'),
        plan.electronDir
      ])
    )
  })

  it('ships every runtime dependency, because the main bundle leaves them external', () => {
    const deps = plan.copies
      .filter((copy) => copy.to.startsWith(win32.join(plan.appDir, 'node_modules')))
      .map((copy) => win32.basename(copy.from))
    expect(deps.sort()).toEqual([...RUNTIME_DEPS].sort())
  })

  it('uses electron.exe on Windows and the plain binary elsewhere', () => {
    expect(plan.electronExe).toBe(win32.join(plan.electronDir, 'electron.exe'))
    const linux = stagePlan({ repoRoot: '/repo', platform: 'linux', tmpdir: '/tmp' })
    expect(linux.electronExe).toBe(posix.join(linux.electronDir, 'electron'))
  })

  it('redirects the app data directory instead of reading the developer profile', () => {
    expect(plan.profileEnv).toEqual({ APPDATA: plan.profileDir })
    expect(plan.appDataDir).toBe(win32.join(plan.profileDir, 'AI Desktop'))
    const linux = stagePlan({ repoRoot: '/repo', platform: 'linux', tmpdir: '/tmp' })
    expect(linux.profileEnv).toEqual({ XDG_CONFIG_HOME: linux.profileDir })
  })

  it('seeds a completed first-run wizard, so the screenshots are not of a modal', () => {
    expect(plan.profileFiles).toHaveLength(1)
    const seeded = plan.profileFiles[0]!
    expect(seeded.path).toBe(win32.join(plan.appDataDir, 'onboarding.json'))
    expect(JSON.parse(seeded.content)).toMatchObject({ completedAt: expect.any(Number) })
  })
})

describe('launchEnv', () => {
  const plan = stagePlan({ repoRoot: 'C:\\repo', platform: 'win32', root: 'C:\\stage' })

  it('deletes ELECTRON_RUN_AS_NODE — the variable that made the launch impossible, not broken', () => {
    const env = launchEnv(plan, { ELECTRON_RUN_AS_NODE: '1', PATH: 'C:\\Windows' })
    // With it set, electron.exe runs as plain node and dies with "Cannot find module 'electron'".
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(env.PATH).toBe('C:\\Windows')
  })

  it('adds the profile override without mutating the caller environment', () => {
    const parent: Record<string, string> = { PATH: 'C:\\Windows', ELECTRON_RUN_AS_NODE: '1' }
    const env = launchEnv(plan, parent)
    expect(env.APPDATA).toBe(plan.profileDir)
    expect(parent).toHaveProperty('ELECTRON_RUN_AS_NODE', '1')
  })
})

describe('electronArgs and debugUrl', () => {
  const plan = stagePlan({ repoRoot: 'C:\\repo', platform: 'win32', root: 'C:\\stage' })

  it('opens the debug port and hands Electron the staged app directory', () => {
    expect(electronArgs(plan, 9222)).toEqual(['--remote-debugging-port=9222', plan.appDir])
    expect(electronArgs(plan)).toEqual([`--remote-debugging-port=${DEFAULT_PORT}`, plan.appDir])
  })

  it('polls loopback, never the machine address', () => {
    expect(debugUrl(9222)).toBe('http://127.0.0.1:9222/json')
  })
})

describe('findRawUuids', () => {
  it('finds a UUID wherever it sits in the text', () => {
    expect(findRawUuids(`project ${UUID} attached`)).toEqual([UUID])
  })

  it('dedupes and lowercases, so one repeated id is reported once', () => {
    expect(findRawUuids(`${UUID} and ${UUID.toUpperCase()} and ${UUID}`)).toEqual([UUID])
  })

  it('ignores hex that is not UUID-shaped', () => {
    expect(findRawUuids('sha 3f2a9c1e4b7d4e8f9a1b2c3d4e5f6a7b and 12345678-1234')).toEqual([])
  })
})

describe('checkDom', () => {
  it('passes a page that tells the truth, one result per invariant', () => {
    const report = checkDom(CLEAN_TEXT, cleanQueries())
    expect(report.failures).toEqual([])
    expect(report.results.map((result) => result.id)).toEqual(INVARIANTS.map((entry) => entry.id))
  })

  it('reports a raw UUID and names it', () => {
    const message = onlyFailure(`${CLEAN_TEXT}\n${UUID}`, cleanQueries())
    expect(message).toContain('UUID')
    expect(message).toContain(UUID)
  })

  it('rejects "Cost unknown"', () => {
    expect(onlyFailure(`${CLEAN_TEXT}\nCost unknown`, cleanQueries())).toContain('Cost unknown')
  })

  it('rejects the "(connected)" banner', () => {
    const message = onlyFailure(`${CLEAN_TEXT}\nRemote: /opt/app (connected)`, cleanQueries())
    expect(message).toContain('Remote: /opt/app (connected)')
  })

  it('does not reject a remote banner that is not claiming a connection', () => {
    // The template used to be the lie; the words alone are not the bug.
    const report = checkDom(`${CLEAN_TEXT}\nRemote: /opt/app (not connected)`, cleanQueries())
    expect(report.failures).toEqual([])
  })

  it('fails with a different message for no status line and for several', () => {
    expect(onlyFailure(CLEAN_TEXT, cleanQueries({ statusBarCount: 0 }))).toContain('did not render')
    expect(onlyFailure(CLEAN_TEXT, cleanQueries({ statusBarCount: 2 }))).toContain('more than once')
  })

  it('refuses a probe that reported no status-bar count at all', () => {
    expect(onlyFailure(CLEAN_TEXT, cleanQueries({ statusBarCount: undefined }))).toContain(
      'nothing was checked'
    )
  })

  it('requires the interface switch to exist with exactly two options', () => {
    expect(
      onlyFailure(CLEAN_TEXT, cleanQueries({ uiMode: { exists: false, buttons: [] } }))
    ).toContain('not a visible control')
    expect(
      onlyFailure(
        CLEAN_TEXT,
        cleanQueries({ uiMode: { exists: true, buttons: [{ pressed: 'true', label: 'Simple' }] } })
      )
    ).toContain('exactly two')
  })

  it('requires aria-pressed on every option and exactly one pressed', () => {
    expect(
      onlyFailure(
        CLEAN_TEXT,
        cleanQueries({
          uiMode: {
            exists: true,
            buttons: [
              { pressed: 'true', label: 'Simple' },
              { pressed: null, label: 'Advanced' }
            ]
          }
        })
      )
    ).toContain('aria-pressed')
    expect(
      onlyFailure(
        CLEAN_TEXT,
        cleanQueries({
          uiMode: {
            exists: true,
            buttons: [
              { pressed: 'true', label: 'Simple' },
              { pressed: 'true', label: 'Advanced' }
            ]
          }
        })
      )
    ).toContain('exactly one')
  })

  it('catches the header dot disagreeing with the workspace item', () => {
    const message = onlyFailure(
      CLEAN_TEXT,
      cleanQueries({
        workspaceConnection: 'disconnected',
        headerConnection: 'connected',
        connections: [
          { owner: 'status-item-workspace', value: 'disconnected' },
          { owner: 'header-dot', value: 'connected' }
        ]
      })
    )
    expect(message).toContain('header dot')
    expect(message).toContain('one of them is lying')
  })

  it('catches two surfaces declaring different states even without a header dot', () => {
    const message = onlyFailure(
      CLEAN_TEXT,
      cleanQueries({
        workspaceConnection: 'connected',
        connections: [
          { owner: 'status-item-workspace', value: 'connected' },
          { owner: 'sidebar-project', value: 'disconnected' }
        ]
      })
    )
    expect(message).toContain('surfaces disagree')
    expect(message).toContain('sidebar-project=disconnected')
  })

  it('fails when nothing on the page declares a connection at all', () => {
    const message = onlyFailure(
      CLEAN_TEXT,
      cleanQueries({ workspaceConnection: null, connections: [] })
    )
    expect(message).toContain('did not render')
  })

  it('accepts a missing header dot when the workspace item is the only source', () => {
    const report = checkDom(CLEAN_TEXT, cleanQueries({ headerConnection: null }))
    expect(report.ok).toBe(true)
    expect(report.results.find((result) => result.id === 'connection-agreement')?.message).toContain(
      'nothing to disagree with'
    )
  })

  it('states a pass without a failure list rather than an empty failure', () => {
    const report = checkDom(CLEAN_TEXT, cleanQueries())
    expect(report.ok).toBe(true)
    expect(report.failures).toHaveLength(0)
    expect(report.results.every((result) => result.ok)).toBe(true)
  })
})

describe('the invariant list and the selectors', () => {
  it('gives every invariant a unique id and a stated check', () => {
    const ids = INVARIANTS.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const invariant of INVARIANTS) {
      expect(invariant.title.length).toBeGreaterThan(10)
      expect(invariant.how.length).toBeGreaterThan(10)
    }
  })

  it('keeps the selectors the driver probes the ones the app actually renders', () => {
    // A renamed test id must fail here, not silently make the live check pass on nothing.
    expect(SELECTORS.statusBar).toBe('[data-testid=status-bar]')
    expect(SELECTORS.uiMode).toBe('[data-testid=titlebar-ui-mode]')
    expect(SELECTORS.workspaceItem).toBe('[data-testid=status-item-workspace]')
    expect(LIVE_SHOT).toBe('live-shell')
  })
})
