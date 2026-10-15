import { describe, it, expect } from 'vitest'
import { migrateProjectRecord } from '@core/agent/persistence'
import {
  activeRemoteProjectHint,
  planRemoteRuntime,
  type RemoteShellHost
} from '../../src/main/agent-service'
import type { ProjectRecord } from '@shared/ui'

const NOW = 1_700_000_000_000

function project(partial: Partial<ProjectRecord>): ProjectRecord {
  return { id: 'p1', name: 'Motor', path: '/opt/demo-project', createdAt: NOW, ...partial }
}

function host(connected: string[]): RemoteShellHost {
  return {
    connectedServers: () => connected,
    exec: async () => ({ ok: true, stdout: '', stderr: '', exitCode: 0 })
  }
}

describe('migrateProjectRecord (Task A.2)', () => {
  it('1. promotes a Linux path stored on Windows to a remote project (no VPS yet)', () => {
    const migrated = migrateProjectRecord(
      { id: 'p1', name: 'Motor', path: '/opt/demo-project', createdAt: NOW },
      'win32',
      NOW
    )
    expect(migrated).toMatchObject({
      id: 'p1',
      name: 'Motor',
      path: '/opt/demo-project',
      type: 'remote'
    })
    expect(migrated.vpsId).toBeUndefined()
  })

  it('2. keeps a Windows drive path local on Windows', () => {
    const migrated = migrateProjectRecord(
      { id: 'p2', name: 'App', path: 'C:\\Users\\Sepid_Com\\projects\\ai-desktop', createdAt: NOW },
      'win32',
      NOW
    )
    expect(migrated.type).toBeUndefined()
    expect(migrated.vpsId).toBeUndefined()
  })

  it('3. leaves a POSIX path local when already running on this OS', () => {
    const migrated = migrateProjectRecord({ path: '/home/me/app' }, 'linux', NOW)
    expect(migrated.type).toBeUndefined()
  })

  it('4. preserves an explicitly remote project and its VPS id', () => {
    const migrated = migrateProjectRecord(
      { id: 'p3', name: 'Motor', path: '/opt/demo-project', type: 'remote', vpsId: 'vps-1' },
      'win32',
      NOW
    )
    expect(migrated).toMatchObject({ type: 'remote', vpsId: 'vps-1' })
  })

  it('5. migrates a v0 bare string entry into a local record', () => {
    const migrated = migrateProjectRecord({ path: 'C:\\projects\\app' }, 'win32', NOW)
    expect(migrated.name).toBe('C:\\projects\\app')
    expect(migrated.path).toBe('C:\\projects\\app')
    expect(migrated.type).toBeUndefined()
  })
})

describe('activeRemoteProjectHint (Task A.2)', () => {
  it('asks the user to select a VPS for a remote project without one', () => {
    const hint = activeRemoteProjectHint(project({ type: 'remote' }), [])
    expect(hint).toContain('Settings -> Projects')
  })

  it('reports a disconnected VPS with the Farsi reconnect message', () => {
    const hint = activeRemoteProjectHint(project({ type: 'remote', vpsId: 'vps-1' }), ['vps-2'])
    expect(hint).toContain('VPS متصل نیست')
    expect(hint).toContain('Settings -> Connections')
  })

  it('returns no hint when the remote project VPS is connected', () => {
    expect(activeRemoteProjectHint(project({ type: 'remote', vpsId: 'vps-1' }), ['vps-1'])).toBeUndefined()
  })

  it('returns no hint for a local project', () => {
    expect(activeRemoteProjectHint(project({ path: 'C:\\app' }), [])).toBeUndefined()
  })
})

describe('remote project file routing (Task A.2)', () => {
  it('4. a remote project on a connected VPS gets the remote shell tool', () => {
    const runtime = planRemoteRuntime('list the files', 'vps-1', host(['vps-1']))
    expect(runtime.extraTools?.some((tool) => tool.name === 'remote_shell')).toBe(true)
  })

  it('5. a remote project on a disconnected VPS yields a clear hint, no remote tools', () => {
    const active = project({ type: 'remote', vpsId: 'vps-1' })
    const hint = activeRemoteProjectHint(active, [])
    expect(hint).toBeTruthy()
    expect(hint).toContain('not connected')
    // The caller short-circuits on the hint instead of falling back to local fs.
    const runtime: { systemHint?: string } = hint ? { systemHint: hint } : {}
    expect(runtime.systemHint).toContain('Settings -> Connections')
  })
})
