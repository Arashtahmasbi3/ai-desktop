/**
 * Registering MCP tools into a run (F0-2, the wiring).
 *
 * An MCP server is a foreign process: it can be missing, crash on start, answer garbage, or die mid-call. The rule
 * this file exists to enforce is that none of that takes the chat down — a failure becomes a status entry the user
 * can read. The second rule is that a foreign tool is named as foreign, which is what the approval gate keys on.
 */
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ToolsetBuilder } from '../../src/core/tools/toolset'
import { CompositeToolExecutor } from '../../src/core/tools/composite-executor'
import { registerMcpTools } from '../../src/main/mcp/bridge'
import { McpServerStore, toView } from '../../src/main/mcp/store'
import { McpTransportError } from '../../src/main/mcp/transport'
import type { McpServerHandle } from '../../src/main/mcp/client'
import type { McpServerConfig, McpToolInfo } from '../../src/shared/mcp'

const server = (over: Partial<McpServerConfig> = {}): McpServerConfig => ({
  id: 'notes',
  name: 'Notes',
  command: 'node',
  args: ['server.js'],
  enabled: true,
  createdAt: 0,
  ...over
})

/** A handle that answers from a table; no process involved. */
function fakeHandle(
  config: McpServerConfig,
  tools: McpToolInfo[],
  call: (name: string, args: Record<string, unknown>) => unknown = () => ({
    content: [{ type: 'text', text: 'ok' }]
  })
): McpServerHandle & { closed: boolean } {
  const state = { closed: false }
  return {
    serverId: config.id,
    serverName: config.name,
    listTools: async () => tools,
    callTool: async (name, args) => call(name, args) as never,
    close: async () => {
      state.closed = true
    },
    stderr: () => '',
    get closed() {
      return state.closed
    }
  }
}

/**
 * Compose the executor exactly as `agent-service` does after collecting the routes — the builder collects, the
 * caller assembles, which is the contract that keeps server-ref wrapping where it belongs.
 */
const executeWith = (builder: ToolsetBuilder) =>
  builder.build({ executor: new CompositeToolExecutor(builder.routes()) }).extraExecutor!

const tool = (name: string): McpToolInfo => ({
  serverId: 'notes',
  name,
  description: `${name} description`,
  inputSchema: { type: 'object', properties: {} }
})

describe('registerMcpTools', () => {
  it('registers a server tool under a namespaced name', async () => {
    const builder = new ToolsetBuilder()
    const result = await registerMcpTools({
      builder,
      servers: [server()],
      connect: async (config) => fakeHandle(config, [tool('read_note')])
    })

    expect(result.statuses).toEqual([{ serverId: 'notes', state: 'connected', toolCount: 1 }])
    expect(builder.names()).toEqual(['mcp__notes__read_note'])
    // The description carries the server id so a model reading the tool list can tell where it comes from.
    expect(builder.definitions()[0]!.description).toContain('[notes]')
  })

  it('routes a call to the right server and maps its text back', async () => {
    const seen: string[] = []
    const builder = new ToolsetBuilder()
    const result = await registerMcpTools({
      builder,
      servers: [server()],
      connect: async (config) =>
        fakeHandle(config, [tool('echo')], (name, args) => {
          seen.push(`${name}:${JSON.stringify(args)}`)
          return { content: [{ type: 'text', text: 'returned' }] }
        })
    })
    const outcome = await executeWith(builder).execute({
      id: 'a1',
      name: 'mcp__notes__echo',
      arguments: { q: 'x' },
      rawArguments: '{}',
      valid: true,
      signature: 's'
    })

    expect(seen).toEqual(['echo:{"q":"x"}'])
    expect(outcome.ok).toBe(true)
    expect(outcome.output).toBe('returned')
    await result.closeAll()
  })

  it('turns a server-reported error into a failed tool result, not an exception', async () => {
    const builder = new ToolsetBuilder()
    await registerMcpTools({
      builder,
      servers: [server()],
      connect: async (config) =>
        fakeHandle(config, [tool('bad')], () => ({
          content: [{ type: 'text', text: 'cannot do that' }],
          isError: true
        }))
    })
    const outcome = await executeWith(builder).execute({
      id: 'a1',
      name: 'mcp__notes__bad',
      arguments: {},
      rawArguments: '{}',
      valid: true,
      signature: 's'
    })
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toContain('cannot do that')
  })

  it('reports a dead transport as a server problem, not as a bad command', async () => {
    const builder = new ToolsetBuilder()
    await registerMcpTools({
      builder,
      servers: [server()],
      connect: async (config) =>
        fakeHandle(config, [tool('slow')], () => {
          throw new McpTransportError('server exited')
        })
    })
    const outcome = await executeWith(builder).execute({
      id: 'a1',
      name: 'mcp__notes__slow',
      arguments: {},
      rawArguments: '{}',
      valid: true,
      signature: 's'
    })
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toContain('Notes')
    expect(outcome.error).toContain('server exited')
  })

  it('keeps working when one server fails to start', async () => {
    const builder = new ToolsetBuilder()
    const result = await registerMcpTools({
      builder,
      servers: [server({ id: 'dead', name: 'Dead' }), server({ id: 'alive', name: 'Alive' })],
      connect: async (config) => {
        if (config.id === 'dead') throw new Error('spawn ENOENT')
        return fakeHandle(config, [tool('ping')])
      }
    })

    // One error entry, one connected entry, and the run still has a tool.
    expect(result.statuses).toEqual([
      { serverId: 'dead', state: 'error', toolCount: 0, error: 'spawn ENOENT' },
      { serverId: 'alive', state: 'connected', toolCount: 1 }
    ])
    expect(builder.names()).toEqual(['mcp__alive__ping'])
  })

  it('skips a disabled server without connecting to it', async () => {
    let connected = 0
    const builder = new ToolsetBuilder()
    const result = await registerMcpTools({
      builder,
      servers: [server({ enabled: false })],
      connect: async (config) => {
        connected += 1
        return fakeHandle(config, [tool('x')])
      }
    })
    expect(connected).toBe(0)
    expect(result.statuses).toEqual([{ serverId: 'notes', state: 'disconnected', toolCount: 0 }])
  })

  it('reports a duplicate id instead of letting the builder throw', async () => {
    const builder = new ToolsetBuilder()
    const result = await registerMcpTools({
      builder,
      servers: [server(), server()],
      connect: async (config) => fakeHandle(config, [tool('a')])
    })
    expect(result.statuses[1]).toMatchObject({ state: 'error', error: 'duplicate server id' })
    // Only one copy of the tool name reached the builder, so nothing throws.
    expect(builder.names()).toEqual(['mcp__notes__a'])
  })

  it('accepts a server that publishes no tools', async () => {
    const builder = new ToolsetBuilder()
    const result = await registerMcpTools({
      builder,
      servers: [server()],
      connect: async (config) => fakeHandle(config, [])
    })
    expect(result.statuses).toEqual([{ serverId: 'notes', state: 'connected', toolCount: 0 }])
    expect(builder.toolCount).toBe(0)
  })

  it('closes every handle it opened', async () => {
    const builder = new ToolsetBuilder()
    const handles: Array<McpServerHandle & { closed: boolean }> = []
    const result = await registerMcpTools({
      builder,
      servers: [server({ id: 'a' }), server({ id: 'b' })],
      connect: async (config) => {
        const handle = fakeHandle(config, [tool('t')])
        handles.push(handle)
        return handle
      }
    })
    await result.closeAll()
    expect(handles.map((handle) => handle.closed)).toEqual([true, true])
  })
})

describe('McpServerStore', () => {
  const dirs: string[] = []
  const makeDir = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-store-'))
    dirs.push(dir)
    return dir
  }
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('starts empty rather than failing when there is no file', async () => {
    const store = new McpServerStore({ baseDir: makeDir() })
    expect(await store.list()).toEqual([])
  })

  it('saves, reads back and keeps the environment out of the view', async () => {
    const dir = makeDir()
    const store = new McpServerStore({ baseDir: dir, now: () => 1000 })
    const saved = await store.save({
      name: 'Notes',
      command: 'node',
      args: ['server.js'],
      env: { TOKEN: 'secret' }
    })

    expect(saved.id).toBeTruthy()
    const [loaded] = await store.list()
    expect(loaded).toMatchObject({ name: 'Notes', command: 'node', enabled: true })
    expect(loaded!.env).toEqual({ TOKEN: 'secret' })

    // What the renderer is allowed to see: a launch line, never the environment.
    const view = toView(loaded!)
    expect(JSON.stringify(view)).not.toContain('secret')
    expect(view.launch).toBe('node server.js')
  })

  it('updates in place instead of appending a duplicate', async () => {
    const store = new McpServerStore({ baseDir: makeDir() })
    const first = await store.save({ name: 'A', command: 'node' })
    await store.save({ id: first.id, name: 'A renamed', command: 'node' })
    const servers = await store.list()
    expect(servers).toHaveLength(1)
    expect(servers[0]!.name).toBe('A renamed')
  })

  it('toggles and removes', async () => {
    const store = new McpServerStore({ baseDir: makeDir() })
    const saved = await store.save({ name: 'A', command: 'node' })
    expect(await store.setEnabled(saved.id, false)).toBe(true)
    expect((await store.list())[0]!.enabled).toBe(false)
    expect(await store.remove(saved.id)).toBe(true)
    expect(await store.list()).toEqual([])
    expect(await store.remove('nope')).toBe(false)
  })

  it('drops a record it cannot use instead of crashing on a hand-edited file', async () => {
    const dir = makeDir()
    writeFileSync(
      join(dir, 'mcp.json'),
      JSON.stringify({
        version: 1,
        servers: [{ id: 'ok', name: 'Ok', command: 'node' }, { name: 'no id' }, 'garbage', null]
      }),
      'utf8'
    )
    const servers = await new McpServerStore({ baseDir: dir }).list()
    expect(servers.map((entry) => entry.id)).toEqual(['ok'])
  })

  it('survives a file that is not JSON at all', async () => {
    const dir = makeDir()
    writeFileSync(join(dir, 'mcp.json'), '{ this is not json', 'utf8')
    expect(await new McpServerStore({ baseDir: dir }).list()).toEqual([])
  })

  it('writes the file, not just its memory', async () => {
    const dir = makeDir()
    await new McpServerStore({ baseDir: dir }).save({ name: 'Persisted', command: 'node' })
    const raw = readFileSync(join(dir, 'mcp.json'), 'utf8')
    expect(raw).toContain('Persisted')
    expect(JSON.parse(raw).version).toBe(1)
  })
})
