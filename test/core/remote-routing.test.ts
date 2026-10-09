import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  LOCAL_TO_REMOTE_TOOL,
  routeToolCall,
  resolveRemotePath,
  remoteWorkspaceHint,
  isRoutableLocalTool,
  type RoutingContext
} from '../../src/core/agent/remote-routing'
import { AgentOrchestrator } from '@core/agent-orchestrator'
import type { ProviderEntry } from '@core/agent-orchestrator'
import { REMOTE_FS_TOOLS, type RemoteFsDeps } from '@core/tools/remote-fs-tools'
import { RemoteFsToolExecutor } from '@core/tools/remote-fs-executor'
import { ScriptedAdapter, toolCall } from '../helpers/fake-adapter'
import { createLocalManager } from '../helpers/local-sandbox-manager'
import type { RemoteFileEntry } from '@shared/vps'

const REMOTE: RoutingContext = {
  workspaceType: 'remote',
  serverId: 'srv-1',
  remotePath: '/srv/app',
  connected: true
}

let base: string

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'remote-routing-'))
})

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true })
})

describe('resolveRemotePath', () => {
  it('rebases relative paths onto the remote root', () => {
    expect(resolveRemotePath('/srv/app', 'src/index.ts')).toBe('/srv/app/src/index.ts')
    expect(resolveRemotePath('/srv/app', './src/index.ts')).toBe('/srv/app/src/index.ts')
  })

  it('treats "." / empty as the root and keeps absolute paths', () => {
    expect(resolveRemotePath('/srv/app/', '.')).toBe('/srv/app')
    expect(resolveRemotePath('/srv/app/', '')).toBe('/srv/app')
    expect(resolveRemotePath('/srv/app', '/etc/hosts')).toBe('/etc/hosts')
  })
})

describe('routeToolCall', () => {
  it('passes local projects through untouched', () => {
    expect(routeToolCall('read_file', { path: 'a.txt' }, { connected: false })).toEqual({
      kind: 'passthrough'
    })
    expect(
      routeToolCall('read_file', { path: 'a.txt' }, { workspaceType: 'local', connected: false })
    ).toEqual({ kind: 'passthrough' })
  })

  it('passes unknown / already-remote tools through', () => {
    expect(routeToolCall('remote_read_file', { path: '/a' }, REMOTE)).toEqual({
      kind: 'passthrough'
    })
    expect(routeToolCall('some_other_tool', {}, REMOTE)).toEqual({ kind: 'passthrough' })
  })

  it('redirects read_file to remote_read_file with a rebased path', () => {
    expect(routeToolCall('read_file', { path: 'src/app.ts' }, REMOTE)).toEqual({
      kind: 'redirect',
      tool: 'remote_read_file',
      args: { server_id: 'srv-1', path: '/srv/app/src/app.ts' }
    })
  })

  it('redirects write_file and preserves content', () => {
    expect(routeToolCall('write_file', { path: 'a.txt', content: 'hi' }, REMOTE)).toEqual({
      kind: 'redirect',
      tool: 'remote_write_file',
      args: { server_id: 'srv-1', path: '/srv/app/a.txt', content: 'hi' }
    })
  })

  it('redirects list_dir "." to the remote root', () => {
    expect(routeToolCall('list_dir', { path: '.' }, REMOTE)).toEqual({
      kind: 'redirect',
      tool: 'remote_list_dir',
      args: { server_id: 'srv-1', path: '/srv/app' }
    })
  })

  it('redirects run_command to remote_shell', () => {
    expect(routeToolCall('run_command', { command: 'ls -la' }, REMOTE)).toEqual({
      kind: 'redirect',
      tool: 'remote_shell',
      args: { server_id: 'srv-1', command: 'ls -la' }
    })
  })

  it('errors when no VPS is selected, and when the VPS is disconnected', () => {
    expect(
      routeToolCall('read_file', { path: 'a' }, { workspaceType: 'remote', connected: false })
    ).toMatchObject({ kind: 'error' })
    const disconnected = routeToolCall(
      'read_file',
      { path: 'a' },
      { ...REMOTE, connected: false }
    )
    expect(disconnected).toMatchObject({ kind: 'error' })
    if (disconnected.kind === 'error') expect(disconnected.message).toContain('not connected')
  })

  it('covers every routable local tool in the mapping table', () => {
    expect(Object.keys(LOCAL_TO_REMOTE_TOOL).sort()).toEqual(
      ['exists', 'grep', 'list_dir', 'read_file', 'run_command', 'write_file'].sort()
    )
    expect(isRoutableLocalTool('list_dir')).toBe(true)
    expect(isRoutableLocalTool('remote_list_dir')).toBe(false)
  })

  it('builds a remote workspace hint naming the host and root', () => {
    const hint = remoteWorkspaceHint('srv-1', '/srv/app')
    expect(hint).toContain('/srv/app')
    expect(hint).toContain('srv-1')
    expect(hint).toContain('remote_shell')
  })
})

function fakeFs(): { deps: RemoteFsDeps; listCalls: string[]; files: Map<string, string> } {
  const files = new Map<string, string>([['/srv/app/a.txt', 'hello remote']])
  const listCalls: string[] = []
  const deps: RemoteFsDeps = {
    connectedServers: () => ['srv-1'],
    readFile: async (_s, path) => files.get(path) ?? Promise.reject(new Error('ENOENT')),
    writeFile: async (_s, path, content) => {
      files.set(path, content)
    },
    listFiles: async (_s, path): Promise<RemoteFileEntry[]> => {
      listCalls.push(path)
      return [{ name: 'a.txt', path: `${path}/a.txt`, type: 'file', size: 12 }]
    },
    exec: async () => ({ ok: true, stdout: 'ok', stderr: '', exitCode: 0 })
  }
  return { deps, listCalls, files }
}

function entry(adapter: ScriptedAdapter): ProviderEntry {
  return { provider: adapter.provider, adapter, config: { apiKey: 'k', model: 'm' } }
}

describe('AgentOrchestrator remote routing (A.1)', () => {
  it('reroutes a local tool call to the remote executor when the project is remote', async () => {
    const manager = createLocalManager(base)
    const { deps, listCalls } = fakeFs()
    const remoteTools = REMOTE_FS_TOOLS.map((tool) => ({ ...tool }))
    const adapter = new ScriptedAdapter('deepseek', [
      { toolCalls: [toolCall('list_dir', { path: '.' })] },
      { content: 'Listed the remote root.' }
    ])
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      extraTools: remoteTools,
      extraExecutor: new RemoteFsToolExecutor(deps, 'srv-1'),
      toolRouting: (tool, args) => routeToolCall(tool, args, REMOTE)
    })

    const result = await orchestrator.run('list my remote project')

    expect(result.status).toBe('completed')
    expect(result.steps[0].actions[0].name).toBe('remote_list_dir')
    expect(result.steps[0].observations[0].ok).toBe(true)
    expect(listCalls).toEqual(['/srv/app'])
    await manager.dispose()
  })

  it('blocks a local tool call with a clear message when the VPS is offline', async () => {
    const manager = createLocalManager(base)
    const { deps, listCalls } = fakeFs()
    const adapter = new ScriptedAdapter('deepseek', [
      { toolCalls: [toolCall('read_file', { path: 'a.txt' })] },
      { content: 'ok' }
    ])
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      extraTools: REMOTE_FS_TOOLS.map((tool) => ({ ...tool })),
      extraExecutor: new RemoteFsToolExecutor(deps, 'srv-1'),
      toolRouting: (tool, args) => routeToolCall(tool, args, { ...REMOTE, connected: false })
    })

    const result = await orchestrator.run('read a file')

    expect(result.steps[0].observations[0]).toMatchObject({ ok: false, code: 'blocked' })
    const observation = adapter.calls[1].messages.find((m) => m.role === 'tool')
    expect(observation?.content).toContain('not connected')
    expect(listCalls).toEqual([])
    await manager.dispose()
  })
})
