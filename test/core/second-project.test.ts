import { describe, it, expect, beforeEach } from 'vitest'
import {
  Persistence,
  migrateProjectRecord,
  normalizeRemoteProjectPath,
  projectTypeForPath
} from '@core/agent/persistence'
import { routeToolCall } from '@core/agent/remote-routing'
import { remoteWorkspaceHint } from '@core/agent/remote-routing'
import { buildWorkspaceSystemHint } from '@core/agent/workspace-prompt'
import { XorCipher } from '../helpers/fake-cipher'

/**
 * S3.1 / S3.2 at the core boundary — two projects on ONE server.
 *
 * The task that produced S3 is `/opt/zoonestore` on `spmotor` while `/opt/sepehr-motor` (same
 * server) is the active project. The model and the fence are *not* the problem: containment is the
 * active root, and it must stay that. What must exist is a project record that carries the right
 * remote root, and a router that follows the selection.
 *
 * The failing half of this file is about the **root a record gets**: an absolute POSIX path added
 * on Windows cannot be a local folder, and the "give this project another root" path must keep a
 * remote project remote. Both are how a second root on one server ends up *not* existing.
 */
const MOTOR = '/opt/sepehr-motor'
const ZOONE = '/opt/zoonestore'
const SERVER = 'spmotor'

let file: string
let counter: number

beforeEach(() => {
  file = `/tmp/ai-desktop-second-project-${Math.random().toString(36).slice(2)}.json`
  counter = 0
})

function make(): Persistence {
  return new Persistence({
    file,
    cipher: new XorCipher(),
    now: () => 1000,
    idFactory: () => `project-${++counter}`
  })
}

describe('S3.1 — a second root on the same server', () => {
  it('stores both projects with their own root and the same server', async () => {
    const persistence = make()
    const motor = await persistence.addProject('sepehr-motor', MOTOR, {
      type: 'remote',
      vpsId: SERVER
    })
    const zoone = await persistence.addProject('zoonestore', ZOONE, {
      type: 'remote',
      vpsId: SERVER
    })

    expect(zoone.id).not.toBe(motor.id)
    expect(persistence.listProjects()).toHaveLength(2)
    expect(persistence.listProjects().map((project) => project.path)).toEqual([MOTOR, ZOONE])
    expect(persistence.listProjects().map((project) => project.vpsId)).toEqual([SERVER, SERVER])
    // Adding the second one makes it active — that is what the "add" action means.
    expect(persistence.getActiveProject()?.id).toBe(zoone.id)
  })

  it('survives a reload as two remote projects on one server', async () => {
    const first = make()
    await first.addProject('sepehr-motor', MOTOR, { type: 'remote', vpsId: SERVER })
    await first.addProject('zoonestore', ZOONE, { type: 'remote', vpsId: SERVER })

    const reloaded = make()
    await reloaded.load()
    expect(reloaded.listProjects().map((project) => [project.path, project.type, project.vpsId])).toEqual([
      [MOTOR, 'remote', SERVER],
      [ZOONE, 'remote', SERVER]
    ])
  })

  it('treats `/opt/x` and `/opt/x/` as the same remote root', () => {
    expect(normalizeRemoteProjectPath(`${ZOONE}/`)).toBe(ZOONE)
    expect(normalizeRemoteProjectPath(`  ${ZOONE}/  `)).toBe(ZOONE)
  })

  it('gives a POSIX path added on Windows the same kind a reload gives it', () => {
    /*
     * `migrateProjectRecord` has always promoted a POSIX path stored on Windows to a *remote*
     * project, because `/opt/app` cannot be a folder on this machine. `addProject` did not apply
     * that rule, so the record a user had just created was `local` for the rest of the session and
     * `remote` after a restart — neither of them a working project, and the difference invisible in
     * the UI until the next launch.
     */
    const asAdded = projectTypeForPath(ZOONE, undefined, 'win32')
    const asMigrated = migrateProjectRecord({ path: ZOONE }, 'win32', 1000).type
    expect(asAdded).toBe('remote')
    expect(asMigrated).toBe('remote')
    expect(asAdded).toBe(asMigrated)

    // An explicit choice always wins, and a real POSIX platform keeps `/opt/app` local.
    expect(projectTypeForPath(ZOONE, 'local', 'win32')).toBe('local')
    expect(projectTypeForPath(ZOONE, undefined, 'linux')).toBeUndefined()
    expect(projectTypeForPath('C:\\work\\app', undefined, 'win32')).toBeUndefined()
  })

  it('does not create a local record for a POSIX path added without a type on Windows', async () => {
    const persistence = make()
    const project = await persistence.addProject('zoonestore', ZOONE)

    // Whatever the platform, the record is *stable*: a reload must not change its kind.
    const reloaded = make()
    await reloaded.load()
    const after = reloaded.listProjects()[0]!
    expect(after.type).toBe(project.type)
    expect(after.path).toBe(ZOONE)
    // On Windows the only possible kind for `/opt/zoonestore` is remote.
    if (process.platform === 'win32') expect(project.type).toBe('remote')
  })
})

describe('S3.1 — a project’s root is edited with the right normaliser', () => {
  it('refuses to move a remote project onto a path on this computer', async () => {
    const persistence = make()
    const project = await persistence.addProject('zoonestore', ZOONE, {
      type: 'remote',
      vpsId: SERVER
    })

    // A Windows path is not a root on the server; accepting it would silently point the file tools
    // at a folder that does not exist there (and leave `type: 'remote'` claiming otherwise).
    await expect(
      persistence.updateProjectPath(project.id, 'C:\\Users\\me\\zoonestore')
    ).rejects.toThrow(/absolute/)
    expect(persistence.listProjects()[0]?.path).toBe(ZOONE)
  })

  it('normalises a remote root and keeps it on its server', async () => {
    const persistence = make()
    const project = await persistence.addProject('sepehr-motor', MOTOR, {
      type: 'remote',
      vpsId: SERVER
    })

    const updated = await persistence.updateProjectPath(project.id, `${ZOONE}/`)
    expect(updated?.path).toBe(ZOONE)
    expect(updated?.type).toBe('remote')
    expect(updated?.vpsId).toBe(SERVER)
  })

  it('still normalises a local project the local way', async () => {
    const persistence = make()
    const local = await persistence.addProject('demo', '/home/me/demo', { type: 'local' })

    const updated = await persistence.updateProjectPath(local.id, '/home/me/other')
    expect(updated?.type).toBe('local')
    expect(updated?.path).toBe('/home/me/other')
  })
})

describe('S3.2 — the router and the hint follow the selected project', () => {
  const contextFor = (remotePath: string): Parameters<typeof routeToolCall>[2] => ({
    workspaceType: 'remote',
    serverId: SERVER,
    remotePath,
    connected: true
  })

  it('rebases the same relative call onto two different roots', () => {
    const motor = routeToolCall('read_file', { path: 'apps/web/package.json' }, contextFor(MOTOR))
    const zoone = routeToolCall('read_file', { path: 'apps/web/package.json' }, contextFor(ZOONE))

    expect(motor).toMatchObject({ args: { path: `${MOTOR}/apps/web/package.json` } })
    expect(zoone).toMatchObject({ args: { path: `${ZOONE}/apps/web/package.json` } })
    expect(motor).not.toEqual(zoone)
  })

  it('refuses the other project’s root while it is not the active one', () => {
    const blocked = routeToolCall('read_file', { path: `${ZOONE}/app.ts` }, contextFor(MOTOR))
    expect(blocked.kind).toBe('error')
    expect(blocked.kind === 'error' && blocked.message).toContain(MOTOR)
    // …and the same absolute path is fine once that project is the active one.
    expect(routeToolCall('read_file', { path: `${ZOONE}/app.ts` }, contextFor(ZOONE))).toMatchObject({
      kind: 'redirect'
    })
  })

  it('names the active root in the model’s hint, one root per project', () => {
    const motorHint = remoteWorkspaceHint(SERVER, MOTOR)
    const zooneHint = remoteWorkspaceHint(SERVER, ZOONE)

    expect(motorHint).toContain(MOTOR)
    expect(motorHint).not.toContain(ZOONE)
    expect(zooneHint).toContain(ZOONE)
    expect(zooneHint).not.toContain(MOTOR)
    // The git/non-git workspace hint carries the root too.
    expect(buildWorkspaceSystemHint({ path: ZOONE, isGitRepo: false })).toContain(ZOONE)
  })
})
