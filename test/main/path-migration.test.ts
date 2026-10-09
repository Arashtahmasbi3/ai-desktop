import { describe, it, expect, beforeEach } from 'vitest'
import {
  Persistence,
  normalizeProjectPath,
  normalizeRemoteProjectPath
} from '@core/agent/persistence'
import { crossPlatformPathWarning, classifyLocalProject, isPosixAbsolutePath } from '@shared/paths'
import { XorCipher } from '../helpers/fake-cipher'

let file: string
let counter: number

beforeEach(() => {
  file = `/tmp/ai-desktop-paths-${Math.random().toString(36).slice(2)}.json`
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

describe('normalizeProjectPath', () => {
  it('keeps absolute POSIX paths and canonicalizes them', () => {
    expect(normalizeProjectPath('/home/me/project/')).toBe('/home/me/project')
  })

  it('rejects relative paths with a clear error', () => {
    expect(() => normalizeProjectPath('project')).toThrow(/must be absolute/)
    expect(() => normalizeProjectPath('   ')).toThrow(/required/)
  })

  it('preserves a Windows drive path even when running on POSIX', () => {
    expect(normalizeProjectPath('C:\\projects\\ai-desktop')).toBe('C:\\projects\\ai-desktop')
  })
})

describe('normalizeRemoteProjectPath', () => {
  it('accepts a remote POSIX path regardless of the local platform', () => {
    expect(normalizeRemoteProjectPath('/opt/sepehr-motor')).toBe('/opt/sepehr-motor')
  })

  it('rejects a non-absolute remote path', () => {
    expect(() => normalizeRemoteProjectPath('opt/app')).toThrow(/must be absolute/)
  })
})

describe('crossPlatformPathWarning', () => {
  it('warns about a POSIX path on Windows', () => {
    expect(crossPlatformPathWarning('/opt/sepehr-motor', 'win32')).toMatch(/Linux\/macOS/)
  })

  it('warns about a Windows path on POSIX', () => {
    expect(crossPlatformPathWarning('C:\\projects\\app', 'linux')).toMatch(/Windows path/)
  })

  it('stays quiet for native paths', () => {
    expect(crossPlatformPathWarning('C:\\projects\\app', 'win32')).toBeUndefined()
    expect(crossPlatformPathWarning('/home/me/app', 'darwin')).toBeUndefined()
    expect(crossPlatformPathWarning('', 'win32')).toBeUndefined()
  })

  it('does not treat a UNC-ish //server/share as POSIX-absolute', () => {
    expect(isPosixAbsolutePath('//server/share')).toBe(false)
    expect(crossPlatformPathWarning('//server/share', 'win32')).toBeUndefined()
  })
})

describe('classifyLocalProject', () => {
  it('reports an existing folder as ok', () => {
    expect(classifyLocalProject('C:\\projects\\app', 'win32', true)).toBe('ok')
  })

  it('flags a foreign-OS path as os-mismatch, not merely missing', () => {
    expect(classifyLocalProject('/opt/sepehr-motor', 'win32', false)).toBe('os-mismatch')
    expect(classifyLocalProject('C:\\projects\\app', 'linux', false)).toBe('os-mismatch')
  })

  it('reports a native path that is not on disk as missing', () => {
    expect(classifyLocalProject('C:\\projects\\gone', 'win32', false)).toBe('missing')
    expect(classifyLocalProject('/home/me/gone', 'darwin', false)).toBe('missing')
  })
})

describe('missing project migration', () => {
  it('keeps a foreign-OS project path across a reload instead of deleting it', async () => {
    await make().addProject('App', 'C:\\projects\\ai-desktop')
    const reloaded = make()
    await reloaded.load()
    const projects = reloaded.listProjects()
    expect(projects).toHaveLength(1)
    expect(projects[0]?.path).toBe('C:\\projects\\ai-desktop')
    expect(reloaded.getActiveProject()?.name).toBe('App')
  })

  it('stores remote projects with their server and keeps them on reload', async () => {
    const persistence = make()
    await persistence.addProject('Motor', '/opt/sepehr-motor', { type: 'remote', vpsId: 'vps-1' })
    const reloaded = make()
    await reloaded.load()
    const project = reloaded.listProjects()[0]
    expect(project).toMatchObject({ name: 'Motor', path: '/opt/sepehr-motor', type: 'remote', vpsId: 'vps-1' })
  })
})
