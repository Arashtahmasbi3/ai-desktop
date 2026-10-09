import { describe, it, expect } from 'vitest'
import type { AgentAction } from '@shared/agent'
import type { VpsExecResult } from '@shared/vps'
import { planRemoteRuntime, type RemoteShellHost } from '../../src/main/agent-service'
import { RemoteShellToolExecutor } from '../../src/core/tools/remote-shell-executor'
import { REMOTE_SHELL_TOOL } from '../../src/core/tools/remote-shell-tool'

function fakeHost(connected: string[], result?: Partial<VpsExecResult>): RemoteShellHost & {
  calls: Array<{ serverId: string; command: string }>
} {
  const calls: Array<{ serverId: string; command: string }> = []
  return {
    calls,
    connectedServers: () => connected,
    exec: async (serverId, command) => {
      calls.push({ serverId, command })
      return { ok: true, stdout: 'done', stderr: '', exitCode: 0, ...result }
    }
  }
}

function action(name: string, args: Record<string, unknown>): AgentAction {
  return {
    id: 'a1',
    name,
    arguments: args,
    rawArguments: JSON.stringify(args),
    valid: true,
    signature: `${name}:test`
  }
}

describe('remote_shell tool injection', () => {
  it('does not offer remote_shell when no VPS host is configured', () => {
    const runtime = planRemoteRuntime('deploy the app', undefined, undefined)
    expect(runtime.extraTools).toBeUndefined()
    expect(runtime.extraExecutor).toBeUndefined()
  })

  it('does not offer remote_shell for a plain coding task with a connected VPS', () => {
    const runtime = planRemoteRuntime('fix the build', undefined, fakeHost(['srv-1']))
    expect(runtime.extraTools).toBeUndefined()
  })

  it('injects remote_shell when the task mentions a VPS and one is connected', () => {
    const runtime = planRemoteRuntime('restart nginx on my vps', undefined, fakeHost(['srv-1']))
    expect(runtime.extraTools?.map((tool) => tool.name)).toEqual([REMOTE_SHELL_TOOL.name])
    expect(runtime.extraExecutor).toBeDefined()
    expect(runtime.systemHint).toContain('srv-1')
  })

  it('injects remote_shell when the user explicitly selects a connected VPS', () => {
    const runtime = planRemoteRuntime('list the files', 'srv-2', fakeHost(['srv-1', 'srv-2']))
    expect(runtime.extraTools).toHaveLength(1)
    expect(runtime.systemHint).toContain('srv-2')
  })

  it('ignores a selected VPS that is not connected', () => {
    const runtime = planRemoteRuntime('do something', 'srv-x', fakeHost(['srv-1']))
    expect(runtime.extraTools).toBeUndefined()
  })

  it('adds a helpful hint (no tool) when a VPS is requested but none is connected', () => {
    const runtime = planRemoteRuntime('check my vps uptime', undefined, fakeHost([]))
    expect(runtime.extraTools).toBeUndefined()
    expect(runtime.systemHint).toMatch(/Settings/i)
  })

  it('adds the remote-fs tools when the host exposes SFTP', () => {
    const host = {
      ...fakeHost(['srv-1']),
      readFile: async () => 'x',
      writeFile: async () => undefined,
      listFiles: async () => []
    }
    const runtime = planRemoteRuntime('edit files on my vps', 'srv-1', host)
    const names = runtime.extraTools?.map((tool) => tool.name) ?? []
    expect(names).toContain('remote_shell')
    expect(names).toContain('remote_read_file')
    expect(names).toContain('remote_write_file')
    expect(names).toContain('remote_list_dir')
    expect(names).toContain('remote_exists')
    expect(names).toContain('remote_grep')
    expect(names).toContain('remote_git_status')
    expect(runtime.systemHint).toContain('remote_read_file')
  })
})

describe('RemoteShellToolExecutor', () => {
  it('forces the pinned server, ignoring the model-provided id', async () => {
    const host = fakeHost(['srv-1', 'srv-2'])
    const executor = new RemoteShellToolExecutor(host, 'srv-1')
    const result = await executor.execute(
      action('remote_shell', { server_id: 'srv-2', command: 'uptime' })
    )
    expect(result.ok).toBe(true)
    expect(host.calls).toEqual([{ serverId: 'srv-1', command: 'uptime' }])
  })

  it('blocks dangerous commands via the deny list', async () => {
    const host = fakeHost(['srv-1'])
    const executor = new RemoteShellToolExecutor(host, 'srv-1')
    const result = await executor.execute(
      action('remote_shell', { server_id: 'srv-1', command: 'rm -rf /' })
    )
    expect(result.ok).toBe(false)
    expect(result.code).toBe('blocked')
    expect(host.calls).toHaveLength(0)
  })

  it('refuses an unknown server', async () => {
    const executor = new RemoteShellToolExecutor(fakeHost(['srv-1']))
    const result = await executor.execute(
      action('remote_shell', { server_id: 'srv-9', command: 'ls' })
    )
    expect(result.ok).toBe(false)
    expect(result.code).toBe('remote_error')
  })
})
