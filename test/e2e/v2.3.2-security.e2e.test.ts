import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentOrchestrator, type ProviderEntry } from '@core/agent-orchestrator'
import { AuditLog } from '@core/agent/audit-log'
import { RateLimiter } from '@core/agent/rate-limiter'
import { routeToolCall } from '@core/agent/remote-routing'
import { CompositeToolExecutor } from '@core/tools/composite-executor'
import { RemoteFsToolExecutor } from '@core/tools/remote-fs-executor'
import {
  REMOTE_FS_TOOLS,
  executeRemoteFs,

  type RemoteFsDeps
} from '@core/tools/remote-fs-tools'
import { shellQuote } from '@shared/shell-quote'
import {
  REMOTE_COMMAND_TIMEOUT_MS,
  REMOTE_SHELL_TOOL,
  executeRemoteShell,
  type RemoteShellDeps
} from '@core/tools/remote-shell-tool'
import { RemoteShellToolExecutor } from '@core/tools/remote-shell-executor'
import { executeMigrateProject, type MigrateProjectDeps } from '@core/tools/migrate-project-tool'
import { defaultHostPolicy } from '@core/remote/host-policy'
import { backupPathFor, parseBackupPath, restoreCommandFor } from '@core/remote/backup'
import type { VpsExecResult } from '@shared/vps'
import type { Plan } from '@shared/plan'
import { SshManager } from '../../src/main/ssh/ssh-manager'
import { VpsServerStore } from '../../src/main/ssh/server-store'
import { FakeBackend, KEY_FINGERPRINT, cipher } from '../helpers/fake-ssh'
import { ScriptedAdapter, toolCall } from '../helpers/fake-adapter'
import { createLocalManager } from '../helpers/local-sandbox-manager'

let base: string
let projectDir: string

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'v232-integration-'))
  projectDir = join(base, 'project')
  await fs.mkdir(projectDir, { recursive: true })
})

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true })
})

function entry(adapter: ScriptedAdapter): ProviderEntry {
  return { provider: adapter.provider, adapter, config: { apiKey: 'test-key', model: 'test-model' } }
}

const ok = (stdout = ''): VpsExecResult => ({ ok: true, stdout, stderr: '', exitCode: 0 })

function makeManager(): { manager: SshManager; store: VpsServerStore; audit: AuditLog } {
  const store = new VpsServerStore({ file: join(base, 'vps.json'), cipher })
  const audit = new AuditLog({ file: join(base, 'audit.json') })
  const manager = new SshManager({
    store,
    backend: new FakeBackend(),
    audit,
    rateLimiter: new RateLimiter(100, 60_000),
    readKeyFile: async () =>
      Buffer.from('-----BEGIN OPENSSH PRIVATE KEY-----\nfake-key-body\n-----END OPENSSH PRIVATE KEY-----')
  })
  return { manager, store, audit }
}

async function connectWithPolicy(
  manager: SshManager,
  store: VpsServerStore,
  policy: ReturnType<typeof defaultHostPolicy>,
  name = 'vps'
): Promise<string> {
  const server = await store.save({
    name,
    host: 'example.com',
    username: 'root',
    authType: 'key',
    privateKeyPath: '/k',
    trustFingerprint: KEY_FINGERPRINT,
    policy
  })
  const state = await manager.connect(server.id)
  expect(state.status).toBe('connected')
  return server.id
}

describe('D.1.1 Remote workspace routes local tools to the remote executor', () => {
  it('rewrites a local read_file onto remote_read_file with a rebased path and server id', async () => {
    const reads: Array<[string, string]> = []
    const fsDeps: RemoteFsDeps = {
      connectedServers: () => ['srv-1'],
      readFile: async (serverId, path) => {
        reads.push([serverId, path])
        return `remote contents of ${path}`
      },
      writeFile: async () => undefined,
      listFiles: async () => [],
      exec: async () => ok()
    }
    const shellExecutor = new RemoteShellToolExecutor(
      { exec: async () => ok('shell-ok'), connectedServers: () => ['srv-1'] },
      'srv-1'
    )
    const executor = new CompositeToolExecutor([
      { names: new Set(REMOTE_FS_TOOLS.map((tool) => tool.name)), executor: new RemoteFsToolExecutor(fsDeps) },
      { names: new Set([REMOTE_SHELL_TOOL.name]), executor: shellExecutor }
    ])
    const adapter = new ScriptedAdapter('deepseek', [
      { toolCalls: [toolCall('read_file', { path: 'src/index.ts' })] },
      { content: 'Read it.' }
    ])

    const orchestrator = new AgentOrchestrator({
      sandbox: createLocalManager(base),
      providers: [entry(adapter)],
      sandboxOptions: { workspaceRoot: projectDir },
      extraTools: [...REMOTE_FS_TOOLS, REMOTE_SHELL_TOOL],
      extraExecutor: executor,
      toolRouting: (toolName, args) =>
        routeToolCall(toolName, args, {
          workspaceType: 'remote',
          serverId: 'srv-1',
          remotePath: '/srv/app',
          connected: true
        })
    })

    const result = await orchestrator.run('read src/index.ts on the vps')

    expect(reads).toEqual([['srv-1', '/srv/app/src/index.ts']])
    const names = result.steps.flatMap((step) => step.actions ?? []).map((action) => action.name)
    expect(names).toContain('remote_read_file')
    expect(names).not.toContain('read_file')
  })
})

describe('D.1.2 Policy check → read-only command is allowed without approval', () => {
  it('runs a read on a staging host and never asks for approval', async () => {
    const { manager, store } = makeManager()
    const id = await connectWithPolicy(manager, store, defaultHostPolicy('', 'staging'))

    const result = await manager.exec(id, 'ls -la /srv/app')

    expect(result.ok).toBe(true)
    expect(result.stdout).toBe('ran:ls -la /srv/app')
    expect(result.requiresApproval).toBeUndefined()
    expect(result.blocked).toBeUndefined()
  })
})

describe('D.1.3 Policy check → write command requires approval', () => {
  it('gates a write on a staging host behind approval', async () => {
    const { manager, store, audit } = makeManager()
    const id = await connectWithPolicy(manager, store, defaultHostPolicy('', 'staging'))

    const result = await manager.exec(id, 'git pull')

    expect(result.requiresApproval).toBe(true)
    expect(result.ok).toBe(false)
    expect(audit.entries().some((e) => e.type === 'blocked' && /approval required/.test(e.detail ?? ''))).toBe(true)
  })
})

describe('D.1.4 Command timeout → the tool kills the command after 60s', () => {
  it('races a hung command against the 60s default budget', async () => {
    vi.useFakeTimers()
    try {
      const exec = vi.fn(
        (_id: string, _cmd: string, _timeoutMs?: number) => new Promise<VpsExecResult>(() => undefined)
      )
      const deps: RemoteShellDeps = { exec, connectedServers: () => ['srv-1'] }
      const pending = executeRemoteShell(deps, { server_id: 'srv-1', command: 'curl http://slow.example' })
      await vi.advanceTimersByTimeAsync(REMOTE_COMMAND_TIMEOUT_MS)
      const result = await pending

      expect(result).toMatchObject({ ok: false, timedOut: true })
      expect(result.content).toMatch(/timed out after 60000ms/)
      expect(exec).toHaveBeenCalledWith('srv-1', 'curl http://slow.example', REMOTE_COMMAND_TIMEOUT_MS)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('D.1.5 Plan Mode → approve → execute', () => {
  it('shows a plan for a mutating batch, then executes it after approval', async () => {
    const plans: Plan[] = []
    const adapter = new ScriptedAdapter('deepseek', [
      { toolCalls: [toolCall('write_file', { path: 'notes.txt', content: 'hello' })] },
      { content: 'Wrote notes.txt.' }
    ])

    const orchestrator = new AgentOrchestrator({
      sandbox: createLocalManager(base),
      providers: [entry(adapter)],
      sandboxOptions: { workspaceRoot: projectDir },
      planApproval: 'auto-write',
      planGate: async (plan) => {
        plans.push(plan)
        return { type: 'approve' }
      }
    })

    const result = await orchestrator.run('create notes.txt')

    expect(plans).toHaveLength(1)
    expect(plans[0].steps.map((step) => step.tool)).toEqual(['write_file'])
    expect(await fs.readFile(join(projectDir, 'notes.txt'), 'utf8')).toBe('hello')
    expect(result.finalAnswer).toContain('notes.txt')
  })

  it('does not run the action when the plan is cancelled', async () => {
    const adapter = new ScriptedAdapter('deepseek', [
      { toolCalls: [toolCall('write_file', { path: 'blocked.txt', content: 'nope' })] },
      { content: 'Stopped.' }
    ])
    const orchestrator = new AgentOrchestrator({
      sandbox: createLocalManager(base),
      providers: [entry(adapter)],
      sandboxOptions: { workspaceRoot: projectDir },
      planApproval: 'auto-write',
      planGate: async () => ({ type: 'cancel' })
    })

    await orchestrator.run('create blocked.txt')

    await expect(fs.readFile(join(projectDir, 'blocked.txt'), 'utf8')).rejects.toThrow()
  })
})

describe('D.1.6 Backup before write → restore from backup', () => {
  it('copies the old file aside before overwriting and restores it', async () => {
    const now = 1_700_000_000_000
    const files = new Map<string, string>([['/srv/app/config.yml', 'version: 1']])
    const execCommands: string[] = []
    const writes: Array<[string, string]> = []
    const auditTypes: string[] = []

    const fsDeps: RemoteFsDeps = {
      connectedServers: () => ['srv-1'],
      readFile: async (_serverId, path) => {
        const value = files.get(path)
        if (value === undefined) throw new Error('ENOENT')
        return value
      },
      writeFile: async (_serverId, path, content) => {
        writes.push([path, content])
        files.set(path, content)
      },
      listFiles: async () => [],
      exec: async (_serverId, command) => {
        execCommands.push(command)
        if (command.startsWith('cp -p -- ')) {
          const [, from, to] = command.match(/^cp -p -- '([^']*)' '([^']*)'$/) ?? []
          if (from && to) files.set(to, files.get(from) ?? '')
        }
        return ok()
      },
      audit: async (entry) => {
        auditTypes.push(entry.type)
      },
      now: () => now
    }

    const result = await executeRemoteFs(fsDeps, 'remote_write_file', {
      server_id: 'srv-1',
      path: '/srv/app/config.yml',
      content: 'version: 2'
    })

    expect(result.ok).toBe(true)
    const backup = backupPathFor('/srv/app/config.yml', now)
    expect(execCommands).toContain(`cp -p -- '/srv/app/config.yml' '${backup}'`)
    expect(auditTypes).toContain('backup_created')
    expect(writes).toEqual([['/srv/app/config.yml', 'version: 2']])

    // The backup still holds the pre-write contents and can be restored.
    expect(files.get(backup)).toBe('version: 1')
    const restore = restoreCommandFor(backup, shellQuote)
    expect(restore).toBe(`cp -p -- '${backup}' '/srv/app/config.yml'`)
    expect(parseBackupPath(backup)).toEqual({ original: '/srv/app/config.yml', at: now })
  })
})

describe('D.1.7 Dry-run rsync → proceed to the real transfer', () => {
  it('previews the transfer, then runs it without --dry-run and audits it', async () => {
    const commands: string[] = []
    const audits: string[] = []
    const deps: MigrateProjectDeps = {
      connectedServers: () => ['src-1'],
      resolveServer: async () => ({ host: 'target.example', port: 22, username: 'deploy' }),
      exec: async (_serverId, command) => {
        commands.push(command)
        if (command.includes('sha256sum')) return ok(`${'a'.repeat(64)}  -`)
        if (command.includes('--dry-run')) {
          return ok(
            [
              'Number of regular files transferred: 3',
              'Total transferred file size: 12,345 bytes',
              'Number of deleted files: 0'
            ].join('\n')
          )
        }
        return ok('sent 12,345 bytes  received 20 bytes')
      },
      audit: async (entry) => {
        audits.push(entry.command ?? '')
      }
    }

    const result = await executeMigrateProject(deps, {
      source_vps_id: 'src-1',
      source_path: '/srv/app',
      target_vps_id: 'tgt-1',
      target_path: '/srv/app'
    })

    expect(result.ok).toBe(true)
    expect(result.plan).toMatchObject({ files: 3, bytes: 12345, deletes: 0 })
    expect(commands).toHaveLength(4)
    expect(commands[0]).toContain('--dry-run')
    expect(commands[1]).not.toContain('--dry-run')
    expect(result.content).toContain('Files to transfer: 3')
    expect(audits.some((command) => command.startsWith('migrate '))).toBe(true)
  })
})
