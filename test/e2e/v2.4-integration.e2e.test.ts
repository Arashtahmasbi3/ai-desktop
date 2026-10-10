import { describe, expect, it } from 'vitest'
import type { VpsExecResult } from '@shared/vps'
import { executeMigrateProject, type MigrateProjectDeps } from '@core/tools/migrate-project-tool'
import { migrateDatabase, type DbMigrateDeps } from '@core/tools/db-migrate-tool'
import { migrateDockerImage, type DockerMigrateDeps } from '@core/tools/docker-migrate-tool'
import { projectUsername } from '@core/agent/project-user-manager'
import { keyReferenceFor, redactKeyMaterial } from '@core/agent/project-key'

const HASH_A = 'a'.repeat(64)
const ok = (stdout = ''): VpsExecResult => ({ ok: true, stdout, stderr: '', exitCode: 0 })

/**
 * v2.4 Phase E: exercises the migration/isolation features together against a single
 * scripted SSH double, to catch cross-feature regressions the unit tests miss.
 */
describe('v2.4 integration (Phase E)', () => {
  it('migrate_project transfers, verifies the checksum and audits', async () => {
    const calls: string[] = []
    const audits: string[] = []
    const deps: MigrateProjectDeps = {
      connectedServers: () => ['src-1'],
      resolveServer: async () => ({ host: 't.example', port: 22, username: 'deploy' }),
      exec: async (_serverId, command) => {
        calls.push(command)
        if (command.includes('sha256sum')) return ok(`${HASH_A}  -`)
        return ok('sent 2K bytes')
      },
      audit: async (entry) => {
        audits.push(entry.command ?? '')
      }
    }

    const result = await executeMigrateProject(deps, {
      source_vps_id: 'src-1',
      source_path: '/var/www/app',
      target_vps_id: 'tgt-1',
      target_path: '/srv/app'
    })

    expect(result.ok).toBe(true)
    expect(result.content).toContain('Checksum verified')
    expect(audits.some((c) => c.startsWith('migrate '))).toBe(true)
  })

  it('db + docker migration both succeed through the same SSH double', async () => {
    const exec = async (_serverId: string, command: string): Promise<VpsExecResult> => {
      if (command.startsWith('docker images -q')) return ok('sha256:deadbeef\n')
      if (command.includes('information_schema')) return ok('7')
      return ok('ok')
    }
    const dbDeps: DbMigrateDeps = {
      exec,
      transfer: async () => ({ ok: true })
    }
    const dbResult = await migrateDatabase(dbDeps, {
      sourceVpsId: 'src-1',
      targetVpsId: 'tgt-1',
      sourceDb: { type: 'postgres', name: 'db', user: 'app' },
      targetDb: { type: 'postgres', name: 'db', user: 'app' }
    })
    expect(dbResult.ok).toBe(true)

    const dockerDeps: DockerMigrateDeps = { exec, transfer: async () => ({ ok: true }) }
    const dockerResult = await migrateDockerImage(dockerDeps, {
      sourceVpsId: 'src-1',
      targetVpsId: 'tgt-1',
      image: 'myapp',
      tag: 'v1'
    })
    expect(dockerResult.ok).toBe(true)
    expect(dockerResult.imageId).toBe('sha256:deadbeef')
  })

  it('gives each project isolated users and keys, and never leaks key material', () => {
    const userA = projectUsername('project-alpha-0001')
    const userB = projectUsername('project-beta-0002')
    expect(userA).not.toBe(userB)
    expect(keyReferenceFor('project-alpha-0001')).not.toBe(keyReferenceFor('project-beta-0002'))

    const privateKey = '-----BEGIN OPENSSH PRIVATE KEY-----\nsecret\n-----END OPENSSH PRIVATE KEY-----'
    expect(redactKeyMaterial(`log: ${privateKey}`)).not.toContain('secret')
  })
})
