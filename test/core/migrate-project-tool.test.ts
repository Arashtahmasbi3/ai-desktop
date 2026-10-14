import { describe, it, expect } from 'vitest'
import type { AgentAction } from '@shared/agent'
import type { VpsExecResult } from '@shared/vps'
import {
  MIGRATE_PROJECT_TOOL,
  buildRsyncCommand,
  compareTreeHashes,
  executeMigrateProject,
  parseRsyncStats,
  parseTreeHash,
  type MigrateProjectDeps,
  type ServerConnection
} from '../../src/core/tools/migrate-project-tool'
import { MigrateProjectToolExecutor } from '../../src/core/tools/migrate-project-executor'
import { planRemoteRuntime, type RemoteHost } from '../../src/main/agent-service'
import type { AuditEntry } from '../../src/core/agent/audit-log'

const TARGET: ServerConnection = { host: '10.0.0.9', port: 2222, username: 'deploy' }
const FAKE_HASH = 'a'.repeat(64)

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
      if (command.includes('sha256sum')) {
        return { ok: true, stdout: `${FAKE_HASH}  -\n`, stderr: '', exitCode: 0 }
      }
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
  it('requires the paths, and a target supplied either by id or by host', () => {
    // v2.8.0: `target_vps_id` is no longer *required* — a raw `target_host` is an
    // accepted alternative, because the transfer runs on the source server and the
    // destination never had to be saved here. Requiring it dead-ended the user.
    expect(MIGRATE_PROJECT_TOOL.name).toBe('migrate_project')
    expect(MIGRATE_PROJECT_TOOL.parameters.required).toEqual([
      'source_vps_id',
      'source_path',
      'target_path'
    ])
    const properties = MIGRATE_PROJECT_TOOL.parameters.properties as Record<string, unknown>
    expect(properties.target_vps_id).toBeDefined()
    expect(properties.target_host).toBeDefined()
    expect(properties.target_user).toBeDefined()
    expect(properties.target_port).toBeDefined()
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

  it('never adds --delete, with or without dry-run', () => {
    expect(buildRsyncCommand('/src', TARGET, '/dst')).not.toContain('--delete')
    expect(buildRsyncCommand('/src', TARGET, '/dst', { dryRun: true })).not.toContain('--delete')
  })

  it('adds --dry-run only when asked', () => {
    expect(buildRsyncCommand('/src', TARGET, '/dst')).not.toContain('--dry-run')
    expect(buildRsyncCommand('/src', TARGET, '/dst', { dryRun: true })).toContain('--dry-run')
  })
})

describe('parseRsyncStats', () => {
  it('reads transfer counts, size and deletions from rsync stats', () => {
    const stdout = [
      'Number of files: 1,234 (reg: 1,200)',
      'Number of deleted files: 0',
      'Number of regular files transferred: 245',
      'Total transferred file size: 13,000,000 bytes',
      'sent 13,000,000 bytes  received 1,200 bytes'
    ].join('\n')
    expect(parseRsyncStats(stdout)).toMatchObject({
      files: 245,
      bytes: 13000000,
      deletes: 0
    })
  })

  it('defaults to zero when stats are absent', () => {
    expect(parseRsyncStats('sent 1.2K bytes')).toEqual({
      files: 0,
      bytes: 0,
      deletes: 0,
      list: []
    })
  })
})

describe('executeMigrateProject', () => {
  it('dry-runs first, then runs the real rsync on the source server', async () => {
    const deps = fakeSsh()
    const result = await executeMigrateProject(deps, ARGS)

    expect(result.ok).toBe(true)
    expect(deps.execCalls).toHaveLength(4)
    expect(deps.execCalls[0]!.serverId).toBe('srv-1')
    expect(deps.execCalls[0]!.command).toContain('--dry-run')
    expect(deps.execCalls[0]!.command).not.toContain('--delete')
    const real = deps.execCalls[1]!
    expect(real.command).toContain('rsync -az --info=stats2')
    expect(real.command).toContain("'deploy@10.0.0.9:/srv/app/'")
    expect(real.command).not.toContain('--delete')
    expect(deps.execCalls[2]!.command).toContain('sha256sum')
    expect(deps.execCalls[3]!.command).toContain('ssh -p 2222')
    expect(result.content).toContain('sent 1.2K bytes')
  })

  it('reports the dry-run plan and copies nothing when dry_run is set', async () => {
    const deps = fakeSsh({
      result: {
        stdout: [
          'Number of regular files transferred: 245',
          'Total transferred file size: 13000000 bytes'
        ].join('\n')
      }
    })
    const result = await executeMigrateProject(deps, { ...ARGS, dry_run: true })

    expect(result.ok).toBe(true)
    expect(deps.execCalls).toHaveLength(1)
    expect(deps.execCalls[0]!.command).toContain('--dry-run')
    expect(result.plan).toMatchObject({ files: 245, bytes: 13000000, deletes: 0 })
    expect(result.content).toContain('Files to transfer: 245')
    expect(result.content).toContain('Files to delete: 0 (--delete off)')
  })

  it('includes the dry-run summary in the real migration output', async () => {
    const deps = fakeSsh({
      result: { stdout: 'Number of regular files transferred: 7\nsent 1.2K bytes' }
    })
    const result = await executeMigrateProject(deps, ARGS)
    expect(result.ok).toBe(true)
    expect(result.content).toContain('Files to transfer: 7')
    expect(result.content).toContain('sent 1.2K bytes')
    expect(deps.audits[0]?.detail).toBe('exit 0; 7 file(s), 0 delete(s)')
  })

  it('aborts before the real transfer when the dry-run fails', async () => {
    const deps = fakeSsh({
      result: { ok: false, stdout: '', stderr: 'rsync: connection refused', exitCode: 255 }
    })
    const result = await executeMigrateProject(deps, ARGS)
    expect(result.ok).toBe(false)
    expect(result.content).toContain('Dry-run failed')
    expect(deps.execCalls).toHaveLength(1)
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

  /**
   * v2.8.0: the reported dead end — "migrate this project to 212.16.86.23" answered
   * with "that is just an IP; add it as a saved server first". The transfer runs on the
   * source server with `BatchMode=yes`, so the destination only has to be reachable
   * *from there*; it never had to be saved on this machine.
   */
  describe('a target that is not a saved server (v2.8.0)', () => {
    it('accepts a raw host and runs the transfer from the source', async () => {
      const deps = fakeSsh({ servers: { 'srv-1': { host: 'src.example.com', port: 22, username: 'root' } } })
      const result = await executeMigrateProject(deps, {
        source_vps_id: 'srv-1',
        source_path: '/var/www/app',
        target_host: '212.16.86.23',
        target_path: '/srv/app'
      })

      expect(result.ok).toBe(true)
      const command = deps.execCalls.map((call) => call.command).join('\n')
      expect(command).toContain('root@212.16.86.23:/srv/app')
      // Still a dry-run first, and still no --delete.
      expect(command).toContain('--dry-run')
      expect(command).not.toContain('--delete')
    })

    it('honours target_user and target_port', async () => {
      const deps = fakeSsh({
        servers: { 'srv-1': { host: 'src.example.com', port: 22, username: 'deploy' } }
      })
      await executeMigrateProject(deps, {
        source_vps_id: 'srv-1',
        source_path: '/var/www/app',
        target_host: '212.16.86.23',
        target_user: 'ubuntu',
        target_port: 2222,
        target_path: '/srv/app'
      })

      const command = deps.execCalls.map((call) => call.command).join('\n')
      expect(command).toContain('ubuntu@212.16.86.23')
      expect(command).toContain('-p 2222')
    })

    it('defaults the user to the source server user', async () => {
      const deps = fakeSsh({
        servers: { 'srv-1': { host: 'src.example.com', port: 22, username: 'deploy' } }
      })
      await executeMigrateProject(deps, {
        source_vps_id: 'srv-1',
        source_path: '/var/www/app',
        target_host: 'target.example.com',
        target_path: '/srv/app'
      })
      expect(deps.execCalls.map((c) => c.command).join('\n')).toContain('deploy@target.example.com')
    })

    it('refuses a host that could be read as a flag or carries shell characters', async () => {
      for (const target_host of ['-oProxyCommand=x', 'evil; rm -rf /', 'bad host', 'a$(whoami)b']) {
        const deps = fakeSsh({
          servers: { 'srv-1': { host: 'src.example.com', port: 22, username: 'root' } }
        })
        const result = await executeMigrateProject(deps, {
          source_vps_id: 'srv-1',
          source_path: '/var/www/app',
          target_host,
          target_path: '/srv/app'
        })
        expect(result.ok, target_host).toBe(false)
        expect(deps.execCalls, target_host).toHaveLength(0)
      }
    })

    it('refuses an unsafe target_user and an out-of-range port', async () => {
      const unsafeUser = await executeMigrateProject(
        fakeSsh({ servers: { 'srv-1': { host: 's', port: 22, username: 'root' } } }),
        {
          source_vps_id: 'srv-1',
          source_path: '/var/www/app',
          target_host: 'h.example.com',
          target_user: 'root; rm -rf /',
          target_path: '/srv/app'
        }
      )
      expect(unsafeUser.ok).toBe(false)

      const badPort = await executeMigrateProject(
        fakeSsh({ servers: { 'srv-1': { host: 's', port: 22, username: 'root' } } }),
        {
          source_vps_id: 'srv-1',
          source_path: '/var/www/app',
          target_host: 'h.example.com',
          target_port: 70000,
          target_path: '/srv/app'
        }
      )
      expect(badPort.ok).toBe(false)
    })

    it('still prefers a saved target id when one is given', async () => {
      const deps = fakeSsh()
      const result = await executeMigrateProject(deps, {
        ...ARGS,
        target_host: 'ignored.example.com'
      })
      expect(result.ok).toBe(true)
      // TARGET is the saved srv-2 in the fake; the host is not used when an id is given.
      const command = deps.execCalls.map((c) => c.command).join('\n')
      expect(command).toContain('deploy@10.0.0.9')
      expect(command).not.toContain('ignored.example.com')
    })

    it('asks for a target when neither id nor host is given', async () => {
      const result = await executeMigrateProject(fakeSsh(), {
        source_vps_id: 'srv-1',
        source_path: '/var/www/app',
        target_path: '/srv/app'
      })
      expect(result.ok).toBe(false)
      expect(result.content).toMatch(/target_vps_id|target_host/)
    })
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

describe('checksum verification (v2.4 B.3)', () => {
  it('parses and compares tree hashes', () => {
    const hash = 'b'.repeat(64)
    expect(parseTreeHash(`random\n${hash}  -\n`)).toBe(hash)
    expect(parseTreeHash('no digest here')).toBeUndefined()
    expect(compareTreeHashes(hash, hash).ok).toBe(true)
    expect(compareTreeHashes(hash, 'c'.repeat(64)).ok).toBe(false)
    expect(compareTreeHashes(undefined, hash).ok).toBe(false)
    expect(compareTreeHashes(hash, undefined).ok).toBe(false)
  })

  it('fails the migration when the target hash differs', async () => {
    const deps = fakeSsh()
    let hashCalls = 0
    deps.exec = async (serverId, command) => {
      deps.execCalls.push({ serverId, command })
      if (command.includes('sha256sum')) {
        hashCalls++
        const stdout = hashCalls === 1 ? `${'a'.repeat(64)}  -\n` : `${'d'.repeat(64)}  -\n`
        return { ok: true, stdout, stderr: '', exitCode: 0 }
      }
      return { ok: true, stdout: 'sent 1.2K bytes', stderr: '', exitCode: 0 }
    }

    const result = await executeMigrateProject(deps, ARGS)

    expect(result.ok).toBe(false)
    expect(result.content).toContain('Checksum mismatch')
  })

  it('skips the checksum when verify_checksum is false', async () => {
    const deps = fakeSsh()
    const result = await executeMigrateProject(deps, { ...ARGS, verify_checksum: false })

    expect(result.ok).toBe(true)
    expect(deps.execCalls).toHaveLength(2)
    expect(deps.execCalls.some((call) => call.command.includes('sha256sum'))).toBe(false)
  })
})

