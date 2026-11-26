import { describe, expect, it } from 'vitest'
import { ToolsetBuilder } from '../../src/core/tools/toolset'
import { registerMcpTools } from '../../src/main/mcp/bridge'
import type { McpServerHandle } from '../../src/main/mcp/client'
import type { McpServerConfig } from '../../src/shared/mcp'
import type { AgentAction } from '../../src/shared/agent'

/**
 * T18 — MCP resources.
 *
 * A server that publishes resources gets **one** tool (`mcp__<server>__read_resource`) whose description lists the URIs,
 * not one tool per file: a server can advertise hundreds of files and the model's tool list has to stay usable. The
 * executor refuses a URI the server never advertised, so a resource tool cannot become a file-system reader.
 */
const config = (id: string): McpServerConfig => ({ id, name: `server-${id}`, enabled: true }) as McpServerConfig

function handle(
  id: string,
  resources: Array<{ uri: string; name: string }>,
  read?: (uri: string) => Promise<string>
): McpServerHandle {
  return {
    serverId: id,
    serverName: `server-${id}`,
    listTools: async () => [
      {
        serverId: id,
        name: 'echo',
        description: 'echo',
        inputSchema: { type: 'object', properties: {} }
      }
    ],
    callTool: async () => ({ content: [] }),
    ...(resources.length > 0
      ? {
          listResources: async () => resources.map((entry) => ({ serverId: id, ...entry })),
          readResource: read ?? (async (uri: string) => `content of ${uri}`)
        }
      : {}),
    close: async () => undefined,
    stderr: () => ''
  }
}

function action(name: string, args: Record<string, unknown> = {}): AgentAction {
  return {
    id: 'a1',
    name,
    arguments: args,
    rawArguments: JSON.stringify(args),
    signature: name,
    valid: true
  }
}

describe('MCP resources (T18)', () => {
  it('adds one read tool per server that publishes resources, listing the URIs', async () => {
    const builder = new ToolsetBuilder()
    const result = await registerMcpTools({
      builder,
      servers: [config('docs')],
      connect: async () => handle('docs', [{ uri: 'docs://readme', name: 'readme' }])
    })

    const names = result.group!.definitions.map((definition) => definition.name)
    expect(names).toContain('mcp__docs__echo')
    expect(names).toContain('mcp__docs__read_resource')

    const resourceTool = result.group!.definitions.find((definition) => definition.name.endsWith('read_resource'))!
    expect(resourceTool.description).toContain('docs://readme')
    // T18: the status carries the count, so Settings can show the server is reachable for more than tools.
    expect(result.statuses[0]).toMatchObject({ state: 'connected', toolCount: 1, resourceCount: 1 })
  })

  it('reads a resource through the executor', async () => {
    const builder = new ToolsetBuilder()
    const result = await registerMcpTools({
      builder,
      servers: [config('docs')],
      connect: async () => handle('docs', [{ uri: 'docs://readme', name: 'readme' }])
    })

    const output = await result.group!.executor!.execute(action('mcp__docs__read_resource', { uri: 'docs://readme' }))

    expect(output.ok).toBe(true)
    expect(output.output).toContain('docs://readme')
  })

  it('refuses a URI the server did not advertise', async () => {
    const builder = new ToolsetBuilder()
    const result = await registerMcpTools({
      builder,
      servers: [config('docs')],
      connect: async () => handle('docs', [{ uri: 'docs://readme', name: 'readme' }])
    })

    const output = await result.group!.executor!.execute(action('mcp__docs__read_resource', { uri: 'file:///etc/passwd' }))

    expect(output.ok).toBe(false)
    expect(output.error).toContain('not a resource')
  })

  it('turns a failing read into a tool failure naming the server', async () => {
    const builder = new ToolsetBuilder()
    const result = await registerMcpTools({
      builder,
      servers: [config('docs')],
      connect: async () =>
        handle('docs', [{ uri: 'docs://x', name: 'x' }], async () => {
          throw new Error('transport died')
        })
    })

    const output = await result.group!.executor!.execute(action('mcp__docs__read_resource', { uri: 'docs://x' }))

    expect(output.ok).toBe(false)
    expect(output.error).toContain('transport died')
  })

  it('adds nothing for a server without resources, and nothing for a failed resource listing', async () => {
    const builder = new ToolsetBuilder()
    const result = await registerMcpTools({
      builder,
      servers: [config('plain')],
      connect: async () => ({
        ...handle('plain', []),
        listResources: async () => {
          throw new Error('not supported')
        }
      })
    })

    expect(result.group!.definitions.map((definition) => definition.name)).toEqual(['mcp__plain__echo'])
  })
})
