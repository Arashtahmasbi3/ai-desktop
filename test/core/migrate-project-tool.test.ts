import { describe, it, expect } from 'vitest'
import type { AgentAction } from '@shared/agent'
import type { VpsExecResult } from '@shared/vps'
import {
  MIGRATE_PROJECT_TOOL,
  buildRsyncCommand,
  executeMigrateProject,
  type MigrateProjectDeps,
  type ServerConnection
} from '../../src/core/tools/migrate-project-tool'
import { MigrateProjectToolExecutor } from '../../src/core/tools/migrate-project-executor'
import { planRemoteRuntime, type RemoteHost } from '../../src/main/agent-service'
import type { AuditEntry } from '../../src/core/agent/audit-log'

const TARGET: ServerConnection = { host: '10.0.0.9', port: 2222, username: 'deploy' }

interface FakeSsh extends MigrateProjectDeps {
  connections: Record<string, ServerConnection>
  execCalls: Array<{ serverId: string; command: string }>
  audits: Array<Omit<AuditEntry, 'at'>>
}

function fakeSsh(
  options: {
    connected?: string[]
    servers?: Record<string, ServerConnection>
    result?: Partial<VpsExecResult>
  } = {}
): FakeSsh {
  const connected = options.connected ?? ['srv-1']
  const connections = options.servers ?? { 'srv-2': TARGET }
  const execCalls: Array<{ serverId: string; command: string }> = []
  const audits: Array<Omit<AuditEntry, 'at'>> = []
  return {
    connections,
    execCalls,
    audits,
    connectedServers: () => connected,
    resolveServer: async (id) => connections[id],
    exec: async (serverId, command): Promise<VpsExecResult> => {
      execCalls.push({ serverId, command })
      return { ok: true, stdout: 'sent 1.2K bytes', stderr: '', exitCode: 0, ...options.result }
    },
    audit: async (entry) => {
      audits.push(entry)
    }
  }
}

function action(name: string, args: Record<string, unknown>, valid = true): AgentAction {
  return {
    id: 'a1',
    name,
    arguments: args,
    rawArguments: JSON.stringify(args),
    valid,
    signature: `${name}:test`
  }
}

const ARGS = {
  source_vps_id: 'srv-1',
  source_path: '/var/www/app',
  target_vps_id: 'srv-2',
  target_path: '/srv/app'
}

describe('MIGRATE_PROJECT_TOOL', () => {
  it('declares the four required server/path parameters', () => {
    expect(MIGRATE_PROJECT_TOOL.name).toBe('migrate_project')
    expect(MIGRATE_PROJECT_TOOL.parameters.required).toEqual([
      'source_vps_id',
      'source_path',
      'target_vps_id',
      'target_path'
    ])
  })
})

describe('buildRsyncCommand', () => {
  it('targets the resolved host and rejects unsafe characters via quoting', () => {
    const command = buildRsyncCommand('/var/www/my app', TARGET, '/srv/app')
    expect(command).toContain('rsync -az')
    expect(command).toContain("-e 'ssh -p 2222 -o BatchMode=yes -o StrictHostKeyChecking=accept-new'")
    expect(command).toContain("'/var/www/my app/'")
    expect(command).toContain("'deploy@10.0.0.9:/srv/app/'")
  })

  it('strips trailing slashes so contents land in the target directory', () => {
    const command = buildRsyncCommand('/src/project/', TARGET, '/dst/project//')
    expect(command).toContain("'/src/project/'")
    expect(command).toContain("'deploy@10.0.0.9:/dst/project/'")
  })
})

describe('executeMigrateProject', () => {
  it('runs rsync on the source server for the resolved target', async () => {
    const deps = fakeSsh()
    const result = await executeMigrateProject(deps, ARGS)

    expect(result.ok).toBe(true)
    expect(deps.execCalls).toHaveLength(1)
    const call = deps.execCalls[0]!
    expect(call.serverId).toBe('srv-1')
    expect(call.command).toContain('rsync -az')
    expect(call.command).toContain("'deploy@10.0.0.9:/srv/app/'")
    expect(result.content).toContain('sent 1.2K bytes')
  })

  it('audits the migration', async () => {
    const deps = fakeSsh()
    await executeMigrateProject(deps, ARGS)
    expect(deps.audits[0]?.command).toBe('migrate /var/www/app -> srv-2:/srv/app')
    expect(deps.audits[0]?.ok).toBe(true)
  })

  it('refuses to run when the source server is not connected', async () => {
    const deps = fakeSsh({ connected: ['srv-9'] })
    const result = await executeMigrateProject(deps, ARGS)
    expect(result.ok).toBe(false)
    expect(result.content).toMatch(/not connected/i)
    expect(deps.execCalls).toHaveLength(0)
  })

  it('refuses an unknown target server', async () => {
    const deps = fakeSsh({ servers: {} })
    const result = await executeMigrateProject(deps, ARGS)
    expect(result.ok).toBe(false)
    expect(result.content).toMatch(/Unknown target server/)
    expect(deps.execCalls).toHaveLength(0)
  })

  it('rejects paths with control characters without touching the shell', async () => {
    const deps = fakeSsh()
    const result = await executeMigrateProject(deps, { ...ARGS, target_path: 'bad\npath' })
    expect(result.ok).toBe(false)
    expect(deps.execCalls).toHaveLength(0)
  })

  it('surfaces an rsync failure with its stderr', async () => {
    const deps = fakeSsh({
      result: { ok: false, stdout: '', stderr: 'rsync: command not found', exitCode: 127 }
    })
    const result = await executeMigrateProject(deps, ARGS)
    expect(result.ok).toBe(false)
    expect(result.content).toContain('command not found')
  })

  it('propagates a policy block from the SSH layer', async () => {
    const deps = fakeSsh({ result: { ok: false, blocked: true, reason: 'nope', exitCode: 0 } })
    const result = await executeMigrateProject(deps, ARGS)
    expect(result.ok).toBe(false)
    expect(result.blocked).toBe(true)
  })
})

describe('MigrateProjectToolExecutor', () => {
  it('reports an unknown tool without a crash', async () => {
    const executor = new MigrateProjectToolExecutor(fakeSsh())
    const result = await executor.execute(action('remote_shell', {}))
    expect(result.ok).toBe(false)
    expect(result.code).toBe('unknown_tool')
  })

  it('flags malformed JSON arguments', async () => {
    const executor = new MigrateProjectToolExecutor(fakeSsh())
    const result = await executor.execute(action('migrate_project', ARGS, false))
    expect(result.ok).toBe(false)
    expect(result.code).toBe('invalid_arguments')
  })

  it('executes a valid migration through the composite runtime', async () => {
    const deps = fakeSsh()
    const executor = new MigrateProjectToolExecutor(deps)
    const result = await executor.execute(action('migrate_project', ARGS))
    expect(result.ok).toBe(true)
    expect(result.name).toBe('migrate_project')
    expect(deps.execCalls[0]?.serverId).toBe('srv-1')
  })
})

describe('planRemoteRuntime migration injection', () => {
  it('offers migrate_project when the host can resolve saved servers', () => {
    const host: RemoteHost = {
      connectedServers: () => ['srv-1'],
      exec: async () => ({ ok: true, stdout: '', stderr: '', exitCode: 0 }),
      resolveServer: async () => TARGET
    }
    const runtime = planRemoteRuntime('migrate my vps project to another server', 'srv-1', host)
    const names = runtime.extraTools?.map((tool) => tool.name) ?? []
    expect(names).toContain('migrate_project')
    expect(runtime.systemHint).toContain('migrate_project')
  })

  it('omits migrate_project when the host cannot resolve servers', () => {
    const host: RemoteHost = {
      connectedServers: () => ['srv-1'],
      exec: async () => ({ ok: true, stdout: '', stderr: '', exitCode: 0 })
    }
    const runtime = planRemoteRuntime('migrate my vps project to another server', 'srv-1', host)
    const names = runtime.extraTools?.map((tool) => tool.name) ?? []
    expect(names).not.toContain('migrate_project')
  })
})
