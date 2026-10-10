import { describe, expect, it } from 'vitest'
import { planRemoteRuntime } from '../../src/main/agent-service'
import { DockerMigrateToolExecutor, dockerMigrateTool } from '../../src/core/tools/docker-migrate-tool'
import { fakeV24Host, action } from './v24-host'

const SERVERS = { 'srv-1': { host: 'a.example', port: 22, username: 'root' }, 'srv-2': { host: 'b.example', port: 22, username: 'root' } }

describe('A.2 migrate_docker wiring', () => {
  it('exposes migrate_docker to the agent', () => {
    const runtime = planRemoteRuntime('transfer a docker image on my vps', undefined, fakeV24Host({ servers: SERVERS }))
    expect(runtime.extraTools?.map((tool) => tool.name)).toContain(dockerMigrateTool.name)
  })

  it('hints at both registry and save/load strategies', () => {
    const runtime = planRemoteRuntime('docker on my vps', undefined, fakeV24Host({ servers: SERVERS }))
    expect(runtime.systemHint).toContain('migrate_docker')
    expect(runtime.systemHint).toContain('save/load')
  })

  it('dispatches a save/load transfer', async () => {
    const calls: string[] = []
    const executor = new DockerMigrateToolExecutor({
      exec: async (_serverId, command) => {
        calls.push(command)
        if (command.startsWith('docker images -q')) {
          return { ok: true, stdout: 'sha256:abc\n', stderr: '', exitCode: 0 }
        }
        return { ok: true, stdout: '', stderr: '', exitCode: 0 }
      },
      transfer: async () => ({ ok: true })
    })
    const result = await executor.execute(
      action('migrate_docker', { source_vps_id: 'srv-1', target_vps_id: 'srv-2', image: 'app', tag: 'v1' })
    )
    expect(result.ok).toBe(true)
    expect(calls.some((command) => command.includes('docker save'))).toBe(true)
  })

  it('reports unknown tool names', async () => {
    const executor = new DockerMigrateToolExecutor({
      exec: async () => ({ ok: true, stdout: '', stderr: '', exitCode: 0 }),
      transfer: async () => ({ ok: true })
    })
    const result = await executor.execute(action('migrate_something_else', { image: 'x' }))
    expect(result.code).toBe('unknown_tool')
  })
})
