import { describe, expect, it } from 'vitest'
import type { VpsExecResult } from '@shared/vps'
import {
  buildDumpCommand,
  buildRestoreCommand,
  buildVerifyCommand,
  detectDbType,
  migrateDatabase,
  planDbMigration,
  requiredTools,
  type DbMigrateDeps,
  type DbMigrateParams
} from '@core/tools/db-migrate-tool'

const ok = (stdout = 'ok'): VpsExecResult => ({ ok: true, stdout, stderr: '', exitCode: 0 })
const bad = (stderr = 'boom'): VpsExecResult => ({ ok: false, stdout: '', stderr, exitCode: 1 })

interface Harness extends DbMigrateDeps {
  calls: Array<{ serverId: string; command: string }>
  transfers: Array<{ from: string; to: string }>
  audits: Array<{ ok: boolean; detail: string }>
}

function harness(overrides: { failRestore?: boolean } = {}): Harness {
  const calls: Harness['calls'] = []
  const transfers: Harness['transfers'] = []
  const audits: Harness['audits'] = []
  let restores = 0
  return {
    calls,
    transfers,
    audits,
    exec: async (serverId, command) => {
      calls.push({ serverId, command })
      if (overrides.failRestore && command.startsWith('pg_restore --clean')) {
        restores++
        // Fail only the first restore so we can observe the rollback.
        if (restores === 1) return bad('restore failed')
      }
      return ok()
    },
    transfer: async (from, _fromPath, to, _toPath) => {
      transfers.push({ from, to })
      return { ok: true }
    },
    audit: async (entry) => {
      audits.push(entry)
    }
  }
}

const PG: DbMigrateParams = {
  sourceVpsId: 'src-1',
  sourceDb: { type: 'postgres', name: 'mydb', user: 'app', host: 'localhost', port: 5432 },
  targetVpsId: 'tgt-1',
  targetDb: { type: 'postgres', name: 'mydb', user: 'app', host: 'localhost', port: 5432 }
}

describe('db-migrate helpers', () => {
  it('detects database types', () => {
    expect(detectDbType('postgresql://x')).toBe('postgres')
    expect(detectDbType('mysql')).toBe('mysql')
    expect(detectDbType('mongodb://x')).toBe('mongodb')
    expect(detectDbType('/data/app.sqlite')).toBe('sqlite')
    expect(detectDbType('oracle')).toBeUndefined()
  })

  it('never puts a password on the command line', () => {
    const endpoint = { type: 'postgres' as const, name: 'db', user: 'u', host: 'h', port: 5432 }
    const dump = buildDumpCommand('postgres', endpoint, '/tmp/x.dump')
    const restore = buildRestoreCommand('postgres', endpoint, '/tmp/x.dump')
    expect(dump).not.toMatch(/password/i)
    expect(restore).not.toMatch(/password/i)
    expect(requiredTools('postgres')).toEqual(['pg_dump', 'pg_restore'])
  })

  it('builds a verify command per type', () => {
    expect(buildVerifyCommand('mysql', { type: 'mysql', name: 'db' })).toContain('information_schema')
    expect(buildVerifyCommand('sqlite', { type: 'sqlite', name: 'db', path: '/data/db' })).toContain('test -f')
  })

  it('plans a backup by default and can skip it', () => {
    const plan = planDbMigration(PG)
    expect(plan.willOverwrite).toBe(true)
    expect(plan.backupPath).toBeDefined()
    expect(planDbMigration({ ...PG, backupTarget: false }).backupPath).toBeUndefined()
  })
})

describe('migrateDatabase', () => {
  it('migrates a PostgreSQL database (scenario 1)', async () => {
    const deps = harness()
    const result = await migrateDatabase(deps, PG)

    expect(result.ok).toBe(true)
    expect(deps.calls.some((c) => c.command.includes('pg_dump'))).toBe(true)
    expect(deps.calls.some((c) => c.command.includes('pg_restore'))).toBe(true)
    expect(deps.transfers).toHaveLength(1)
    expect(deps.audits[0]?.ok).toBe(true)
  })

  it('migrates a MySQL database (scenario 2)', async () => {
    const deps = harness()
    const params: DbMigrateParams = {
      ...PG,
      sourceDb: { type: 'mysql', name: 'shop', user: 'app', host: 'localhost' },
      targetDb: { type: 'mysql', name: 'shop', user: 'app', host: 'localhost' }
    }
    const result = await migrateDatabase(deps, params)

    expect(result.ok).toBe(true)
    expect(deps.calls.some((c) => c.command.includes('mysqldump'))).toBe(true)
    expect(deps.calls.some((c) => c.command.includes('mysql '))).toBe(true)
  })

  it('dry-run only plans, running nothing (scenario 3)', async () => {
    const deps = harness()
    const result = await migrateDatabase(deps, { ...PG, dryRun: true })

    expect(result.ok).toBe(true)
    expect(deps.calls).toHaveLength(0)
    expect(result.plan?.steps.length).toBeGreaterThan(0)
    expect(result.logs.join('\n')).toContain('overwrite')
  })

  it('backs the target up before restoring (scenario 4)', async () => {
    const deps = harness()
    const result = await migrateDatabase(deps, PG)

    expect(result.ok).toBe(true)
    const backupAt = deps.calls.findIndex(
      (c) => c.serverId === 'tgt-1' && c.command.startsWith('pg_dump ')
    )
    const restoreAt = deps.calls.findIndex((c) => c.command.startsWith('pg_restore --clean'))
    expect(backupAt).toBeGreaterThan(-1)
    expect(backupAt).toBeLessThan(restoreAt)
  })

  it('rolls back from the backup when the restore fails (scenario 5)', async () => {
    const deps = harness({ failRestore: true })
    const result = await migrateDatabase(deps, PG)

    expect(result.ok).toBe(false)
    // First restore fails, second restore is the rollback from the backup.
    const restores = deps.calls.filter((c) => c.command.startsWith('pg_restore --clean'))
    expect(restores).toHaveLength(2)
    expect(deps.audits.some((a) => a.ok === false)).toBe(true)
  })

  it('fails early when a required tool is missing', async () => {
    const deps = harness()
    deps.exec = async (serverId, command) => {
      deps.calls.push({ serverId, command })
      if (command.includes('command -v pg_restore')) return bad('not found')
      return ok()
    }
    const result = await migrateDatabase(deps, PG)
    expect(result.ok).toBe(false)
    expect(result.logs.join('\n')).toContain('pg_restore')
  })
})
