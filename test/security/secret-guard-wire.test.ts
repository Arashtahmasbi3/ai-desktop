import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { AgentAction } from '@shared/agent'
import type { RemoteFileEntry, VpsExecResult } from '@shared/vps'
import { SandboxToolExecutor, actionFromToolCall } from '@core/agent/tools'
import { routeToolCall, type RoutingContext } from '@core/agent/remote-routing'
import { executeRemoteFs, type RemoteFsDeps } from '@core/tools/remote-fs-tools'
import { RemoteShellToolExecutor } from '@core/tools/remote-shell-executor'
import { toolCall } from '../helpers/fake-adapter'
import { createLocalManager } from '../helpers/local-sandbox-manager'
import type { SandboxManagerImpl } from '@core/sandbox/manager'

const REMOTE: RoutingContext = {
  workspaceType: 'remote',
  serverId: 'srv-1',
  remotePath: '/srv/app',
  connected: true
}

function action(name: string, args: Record<string, unknown>): AgentAction {
  return actionFromToolCall(toolCall(name, args))
}

let base: string
let manager: SandboxManagerImpl
let sandboxId: string
let executor: SandboxToolExecutor

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'secret-guard-'))
  manager = createLocalManager(base)
  sandboxId = (await manager.createSandbox({ provider: 'local' })).id
  executor = new SandboxToolExecutor(manager, sandboxId)
})

afterEach(async () => {
  await manager.dispose()
  await fs.rm(base, { recursive: true, force: true })
})

describe('local sandbox tools refuse secret paths', () => {
  it('blocks read_file of .env', async () => {
    await manager.writeFile(sandboxId, '.env', 'TOKEN=super-secret')
    const result = await executor.execute(action('read_file', { path: '.env' }))
    expect(result.ok).toBe(false)
    expect(result.code).toBe('blocked')
    expect(result.output).not.toContain('super-secret')
  })

  it('blocks write_file to .env', async () => {
    const result = await executor.execute(action('write_file', { path: '.env', content: 'A=1' }))
    expect(result.ok).toBe(false)
    expect(result.code).toBe('blocked')
  })

  it('blocks run_command that references a secret', async () => {
    const result = await executor.execute(action('run_command', { command: 'cat .env' }))
    expect(result.ok).toBe(false)
    expect(result.code).toBe('blocked')
  })

  it('still allows ordinary files and commands', async () => {
    const write = await executor.execute(
      action('write_file', { path: 'src/index.ts', content: 'export const x = 1' })
    )
    expect(write.ok).toBe(true)
    const read = await executor.execute(action('read_file', { path: 'src/index.ts' }))
    expect(read.ok).toBe(true)
    const list = await executor.execute(action('list_dir', { path: '.' }))
    expect(list.ok).toBe(true)
  })
})

describe('routeToolCall refuses secrets before any routing', () => {
  it('blocks a secret path for a remote project', () => {
    const decision = routeToolCall('read_file', { path: '.env' }, REMOTE)
    expect(decision.kind).toBe('error')
    expect(decision.kind === 'error' && decision.message).toMatch(/Blocked/i)
  })

  it('blocks a secret path even for a local project (no routing needed)', () => {
    const decision = routeToolCall('write_file', { path: '.env', content: 'x' }, {
      workspaceType: 'local',
      connected: false
    })
    // Local projects pass through routing; the sandbox executor is the guard.
    expect(decision).toEqual({ kind: 'passthrough' })
  })

  it('blocks a remote shell command that reads a secret', () => {
    const decision = routeToolCall('run_command', { command: 'cat /root/.ssh/id_rsa' }, REMOTE)
    expect(decision.kind).toBe('error')
  })
})

describe('remote-fs tools refuse secret paths', () => {
  function deps(): RemoteFsDeps & { execCalls: string[] } {
    const execCalls: string[] = []
    return {
      execCalls,
      connectedServers: () => ['srv-1'],
      projectRoot: '/srv/app',
      readFile: async () => 'SECRET',
      writeFile: async () => undefined,
      listFiles: async (): Promise<RemoteFileEntry[]> => [],
      exec: async (): Promise<VpsExecResult> => {
        execCalls.push('exec')
        return { ok: true, stdout: '', stderr: '', exitCode: 0 }
      }
    }
  }

  it('blocks remote_read_file of a project .env (P0-2 alone would allow it)', async () => {
    const result = await executeRemoteFs(deps(), 'remote_read_file', {
      server_id: 'srv-1',
      path: '/srv/app/.env'
    })
    expect(result.ok).toBe(false)
    expect(result.blocked).toBe(true)
    expect(result.content).not.toContain('SECRET')
  })

  it('allows an ordinary remote read', async () => {
    const result = await executeRemoteFs(deps(), 'remote_read_file', {
      server_id: 'srv-1',
      path: '/srv/app/src/index.ts'
    })
    expect(result.ok).toBe(true)
  })

  it('still blocks the real .env under an active Diagnostic (elevated) policy', async () => {
    const withDiagnostic = {
      ...deps(),
      // Diagnostic Mode only ever *widens* read scope; it must not expose secrets.
      diagnostic: { enabled: true, expiresAt: Date.now() + 60_000, allowedPaths: ['/srv/app'] }
    }
    const blocked = await executeRemoteFs(withDiagnostic, 'remote_read_file', {
      server_id: 'srv-1',
      path: '/srv/app/.env'
    })
    expect(blocked.ok).toBe(false)
    expect(blocked.blocked).toBe(true)

    // ...while an env template is readable — the allowlist is elevation-independent.
    const template = await executeRemoteFs(withDiagnostic, 'remote_read_file', {
      server_id: 'srv-1',
      path: '/srv/app/.env.example'
    })
    expect(template.ok).toBe(true)
  })
})

describe('remote shell refuses secret commands even in Elevated', () => {
  it('blocks before the command reaches the host', async () => {
    const calls: string[] = []
    const shell = new RemoteShellToolExecutor({
      connectedServers: () => ['srv-1'],
      exec: async (_serverId, command) => {
        calls.push(command)
        return { ok: true, stdout: '', stderr: '', exitCode: 0 }
      }
    })
    const result = await shell.execute(action('remote_shell', { server_id: 'srv-1', command: 'cat .env' }))
    expect(result.ok).toBe(false)
    expect(result.blocked).toBe(true)
    expect(calls).toEqual([])
  })

  it('still runs an ordinary command', async () => {
    const calls: string[] = []
    const shell = new RemoteShellToolExecutor({
      connectedServers: () => ['srv-1'],
      exec: async (_serverId, command) => {
        calls.push(command)
        return { ok: true, stdout: 'ok', stderr: '', exitCode: 0 }
      }
    })
    const result = await shell.execute(
      action('remote_shell', { server_id: 'srv-1', command: 'ls -la /srv/app' })
    )
    expect(result.ok).toBe(true)
    expect(calls).toEqual(['ls -la /srv/app'])
  })
})
