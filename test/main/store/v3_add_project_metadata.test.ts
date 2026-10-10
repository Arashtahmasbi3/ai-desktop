import { describe, it, expect, beforeEach } from 'vitest'
import { Persistence, SETTINGS_SCHEMA_VERSION } from '@core/agent/persistence'
import {
  getLocalPath,
  getRemotePath,
  getRemoteVpsId,
  auditLogPathFor
} from '@shared/project-metadata'
import { migrateProjectToV3 } from '@main/store/migrations/v3_add_project_metadata'
import { XorCipher } from '../../helpers/fake-cipher'

const NOW = 1_700_000_000_000

describe('v2 → v3 project metadata migration (v2.3.2, C.1)', () => {
  it('1. backfills a legacy local project with defaults', () => {
    const migrated = migrateProjectToV3(
      { path: 'C:\\projects\\app', createdAt: 42 },
      NOW
    )
    expect(migrated.updatedAt).toBe(42)
    expect(migrated.environment).toBe('development')
    expect(migrated.auditLogPath).toBe(auditLogPathFor('C:\\projects\\app'))
    // Non-destructive: nothing that existed was changed.
    expect(migrated.path).toBe('C:\\projects\\app')
    expect(migrated.createdAt).toBe(42)
  })

  it('2. gives a legacy remote project an environment but no local audit path', () => {
    const migrated = migrateProjectToV3(
      { path: '/opt/server', type: 'remote', vpsId: 'vps-1', linuxUser: 'deploy' },
      NOW
    )
    expect(migrated.environment).toBe('development')
    expect(migrated.auditLogPath).toBeUndefined()
    expect(migrated.linuxUser).toBe('deploy')
    expect(migrated.updatedAt).toBe(NOW)
  })

  it('3. is idempotent — existing metadata is never overwritten', () => {
    const once = migrateProjectToV3({ path: '/srv/app', createdAt: 1 }, NOW)
    const twice = migrateProjectToV3(
      { ...once, updatedAt: 999, environment: 'production', auditLogPath: '/custom/audit.log' },
      NOW + 5000
    )
    expect(twice.updatedAt).toBe(999)
    expect(twice.environment).toBe('production')
    expect(twice.auditLogPath).toBe('/custom/audit.log')
  })
})

describe('project metadata persistence round-trip (v2.3.2, C.1)', () => {
  let file: string

  beforeEach(() => {
    file = `/tmp/ai-desktop-c1-${Math.random().toString(36).slice(2)}.json`
  })

  function make(): Persistence {
    return new Persistence({ file, cipher: new XorCipher(), now: () => NOW })
  }

  it('4. survives a reload and drives the derived path getters', async () => {
    const store = make()
    const local = await store.addProject('Local', 'C:\\projects\\app', {
      metadata: { environment: 'production', repository: { url: 'git@x:y.git', branch: 'main' } }
    })
    const remote = await store.addProject('Remote', '/opt/app', {
      type: 'remote',
      vpsId: 'vps-1',
      metadata: { environment: 'staging', linuxUser: 'deploy' }
    })

    const reloaded = make()
    await reloaded.load()

    expect(reloaded.getSettings().version).toBe(SETTINGS_SCHEMA_VERSION)
    const localBack = reloaded.listProjects().find((project) => project.id === local.id)
    const remoteBack = reloaded.listProjects().find((project) => project.id === remote.id)

    expect(localBack).toMatchObject({
      environment: 'production',
      repository: { url: 'git@x:y.git', branch: 'main' }
    })
    expect(remoteBack).toMatchObject({ environment: 'staging', linuxUser: 'deploy' })

    // Derived getters resolve per project kind.
    expect(getLocalPath(localBack!)).toBe('C:\\projects\\app')
    expect(getRemotePath(localBack!)).toBeUndefined()
    expect(getRemotePath(remoteBack!)).toBe('/opt/app')
    expect(getRemoteVpsId(remoteBack!)).toBe('vps-1')
    expect(getLocalPath(remoteBack!)).toBeUndefined()
  })
})
