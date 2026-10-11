import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { VpsExecResult } from '@shared/vps'
import { executeRemoteShell, type RemoteShellDeps } from '@core/tools/remote-shell-tool'
import { RemoteFsToolExecutor } from '@core/tools/remote-fs-executor'
import type { RemoteFsDeps } from '@core/tools/remote-fs-tools'
import { SandboxToolExecutor, actionFromToolCall } from '@core/agent/tools'
import { toolCall } from '../helpers/fake-adapter'
import { createLocalManager } from '../helpers/local-sandbox-manager'
import type { SandboxManagerImpl } from '@core/sandbox/manager'

const ok = (stdout: string, stderr = '', exitCode = 0): VpsExecResult => ({
  ok: exitCode === 0,
  stdout,
  stderr,
  exitCode
})

function shellDeps(exec: RemoteShellDeps['exec']): RemoteShellDeps {
  return { exec, connectedServers: () => ['srv-1'] }
}

function fsDeps(overrides: Partial<RemoteFsDeps> = {}): RemoteFsDeps {
  return {
    connectedServers: () => ['srv-1'],
    readFile: async () => 'remote contents',
    writeFile: async () => undefined,
    listFiles: async () => [],
    exec: async () => ok(''),
    ...overrides
  }
}

describe('P1 executeRemoteShell carries structured detail (v2.5.2)', () => {
  it('1. success keeps stdout/stderr/exit code separate while content stays combined', async () => {
    const exec = async (): Promise<VpsExecResult> => ok('hello\n', 'warned\n')
    const result = await executeRemoteShell(shellDeps(exec), {
      server_id: 'srv-1',
      command: 'echo hello'
    })
    expect(result.ok).toBe(true)
    expect(result.content).toBe('hello\nwarned')
    expect(result.command).toBe('echo hello')
    expect(result.serverId).toBe('srv-1')
    expect(result.stdout).toBe('hello\n')
    expect(result.stderr).toBe('warned\n')
    expect(result.exitCode).toBe(0)
  })

  it('2. a non-zero exit keeps the exit code and both streams', async () => {
    const exec = async (): Promise<VpsExecResult> => ok('partial', 'boom', 2)
    const result = await executeRemoteShell(shellDeps(exec), {
      server_id: 'srv-1',
      command: 'npm test'
    })
    expect(result.ok).toBe(false)
    expect(result.exitCode).toBe(2)
    expect(result.stdout).toBe('partial')
    expect(result.stderr).toBe('boom')
  })

  it('3. a timed-out command still names the command and host', async () => {
    const exec = async (): Promise<VpsExecResult> => ({
      ...ok('', '', 0),
      timedOut: true
    })
    const result = await executeRemoteShell(shellDeps(exec), {
      server_id: 'srv-1',
      command: 'sleep 120'
    })
    expect(result.timedOut).toBe(true)
    expect(result.command).toBe('sleep 120')
    expect(result.serverId).toBe('srv-1')
  })

  it('4. a policy-blocked command still carries the command and host', async () => {
    const exec = async (): Promise<VpsExecResult> => ok('')
    const result = await executeRemoteShell(shellDeps(exec), {
      server_id: 'srv-1',
      command: 'rm -rf /'
    })
    expect(result.blocked).toBe(true)
    expect(result.command).toBe('rm -rf /')
    expect(result.serverId).toBe('srv-1')
  })
})

describe('P1 SandboxToolExecutor carries structured detail (v2.5.2)', () => {
  let base: string
  let manager: SandboxManagerImpl
  let sandboxId: string
  let executor: SandboxToolExecutor

  beforeEach(async () => {
    base = await fs.mkdtemp(join(tmpdir(), 'tool-details-'))
    manager = createLocalManager(base)
    sandboxId = (await manager.createSandbox({ provider: 'local' })).id
    executor = new SandboxToolExecutor(manager, sandboxId)
  })

  afterEach(async () => {
    await manager.dispose()
    await fs.rm(base, { recursive: true, force: true })
  })

  it('5. run_command carries command, separated streams and the exit code', async () => {
    const script = `node -e "console.log('out'); console.error('err'); process.exit(5)"`
    const result = await executor.execute(actionFromToolCall(toolCall('run_command', { command: script })))
    expect(result.ok).toBe(false)
    expect(result.command).toBe(script)
    expect(result.stdout).toContain('out')
    expect(result.stderr).toContain('err')
    expect(result.exitCode).toBe(5)
    expect(result.code).toBe('exit_nonzero')
  })

  it('6. read_file carries the path it touched', async () => {
    await manager.writeFile(sandboxId, 'note.txt', 'hello')
    const result = await executor.execute(actionFromToolCall(toolCall('read_file', { path: 'note.txt' })))
    expect(result.ok).toBe(true)
    expect(result.path).toBe('note.txt')
  })
})

describe('P1 remote fs executor carries target + path (v2.5.2)', () => {
  it('7. pins the server and reports the path for a remote read', async () => {
    const executor = new RemoteFsToolExecutor(fsDeps(), 'srv-1')
    const result = await executor.execute(
      actionFromToolCall(toolCall('remote_read_file', { path: '/srv/app/src/index.ts' }))
    )
    expect(result.ok).toBe(true)
    expect(result.serverId).toBe('srv-1')
    expect(result.path).toBe('/srv/app/src/index.ts')
  })
})
