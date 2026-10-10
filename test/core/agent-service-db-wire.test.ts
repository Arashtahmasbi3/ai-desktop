import { describe, expect, it } from 'vitest'
import { planRemoteRuntime } from '../../src/main/agent-service'
import { planV24Tools } from '../../src/main/v24-tools-wiring'
import { DbMigrateToolExecutor, dbMigrateTool } from '../../src/core/tools/db-migrate-tool'
import { fakeV24Host, action } from './v24-host'

const SERVERS = { 'srv-1': { host: 'a.example', port: 22, username: 'root' }, 'srv-2': { host: 'b.example', port: 22, username: 'root' } }

function deps(): ConstructorParameters<typeof DbMigrateToolExecutor>[0] {
  return { exec: async () => ({ ok: true, stdout: '', stderr: '', exitCode: 0 }), transfer: async () => ({ ok: true }) }
}

describe('A.1 migrate_database wiring', () => {
  it('exposes migrate_database to the agent when a VPS is connected', () => {
    const runtime = planRemoteRuntime('move this on my vps', undefined, fakeV24Host({ servers: SERVERS }))
    expect(runtime.extraTools?.map((tool) => tool.name)).toContain(dbMigrateTool.name)
  })

  it('tells the model to dry-run first', () => {
    const runtime = planRemoteRuntime('migrate a db on my vps', undefined, fakeV24Host({ servers: SERVERS }))
    expect(runtime.systemHint).toContain('migrate_database')
    expect(runtime.systemHint).toContain('dry-run')
  })

  it('dispatches a dry-run call and returns the plan', async () => {
    const executor = new DbMigrateToolExecutor(deps())
    const result = await executor.execute(
      action('migrate_database', {
        source_vps_id: 'srv-1',
        target_vps_id: 'srv-2',
        source_db: { type: 'postgres', name: 'app' },
        target_db: { type: 'postgres', name: 'app' },
        dry_run: true
      })
    )
    expect(result.ok).toBe(true)
    expect(result.output.toLowerCase()).toContain('plan')
  })

  it('rejects malformed arguments without calling the host', async () => {
    const executor = new DbMigrateToolExecutor(deps())
    const result = await executor.execute(action('migrate_database', { source_vps_id: 'srv-1' }))
    expect(result.ok).toBe(false)
    expect(result.code).toBe('invalid_arguments')
  })

  it('is absent when the host cannot resolve saved servers', () => {
    const wiring = planV24Tools({ connectedServers: () => [], exec: async () => ({ ok: true, stdout: '', stderr: '', exitCode: 0 }) })
    expect(wiring.extraTools.map((tool) => tool.name)).not.toContain('migrate_database')
  })
})
