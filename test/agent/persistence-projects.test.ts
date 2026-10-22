import { describe, it, expect, beforeEach } from 'vitest'
import { Persistence } from '@core/agent/persistence'
import { XorCipher } from '../helpers/fake-cipher'

let file: string
let counter: number

beforeEach(() => {
  file = `/tmp/ai-desktop-projects-${Math.random().toString(36).slice(2)}.json`
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

describe('Persistence projects', () => {
  it('adds a project and makes it active', async () => {
    const persistence = make()
    /*
     * S3: the type is stated here on purpose. Without one, a POSIX path on Windows is inferred as a
     * *remote* project (`projectTypeForPath`), because `/home/me/demo` cannot be a folder on this
     * machine — and this case is specifically about a local project.
     */
    const project = await persistence.addProject('Demo', '/home/me/demo', { type: 'local' })
    expect(project).toEqual({
      id: 'project-1',
      name: 'Demo',
      path: '/home/me/demo',
      createdAt: 1000,
      type: 'local',
      // v2.3.2 C.1 — new projects get metadata defaults.
      updatedAt: 1000,
      environment: 'development',
      auditLogPath: '/home/me/demo/.ai-desktop/audit.log'
    })
    expect(persistence.getActiveProject()?.id).toBe('project-1')
    expect(persistence.listProjects()).toHaveLength(1)
  })

  it('switches the active project', async () => {
    const persistence = make()
    await persistence.addProject('A', '/a')
    await persistence.addProject('B', '/b')
    expect(persistence.getActiveProject()?.name).toBe('B')

    await persistence.setActiveProject('project-1')
    expect(persistence.getActiveProject()?.name).toBe('A')
  })

  it('removes a project and falls back to the next one', async () => {
    const persistence = make()
    await persistence.addProject('A', '/a')
    await persistence.addProject('B', '/b')

    expect(await persistence.removeProject('project-2')).toBe(true)
    expect(persistence.getActiveProject()?.name).toBe('A')
    expect(await persistence.removeProject('missing')).toBe(false)
  })

  it('persists projects across reloads', async () => {
    await make().addProject('Demo', '/home/me/demo')
    const reloaded = make()
    await reloaded.load()
    expect(reloaded.listProjects().map((project) => project.name)).toEqual(['Demo'])
    expect(reloaded.getActiveProject()?.path).toBe('/home/me/demo')
  })

  it('exposes activeProjectId in the redacted view', async () => {
    const persistence = make()
    await persistence.addProject('Demo', '/home/me/demo')
    expect(persistence.redacted().activeProjectId).toBe('project-1')
  })
})
