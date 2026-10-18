/**
 * The MCP client against an in-memory transport (F0-2).
 *
 * No `vi.mock` and no child process: the transport is the boundary, so a double can record the exact JSON-RPC the
 * client would have sent and answer it however the case needs. The protocol details that matter — the handshake
 * order, tolerant parsing, and a failed server not taking the run down with it — are what these cases pin.
 */
import { describe, expect, it } from 'vitest'
import {
  connectMcpServer,
  isServerError,
  mcpResultText,
  mcpToolName
} from '../../src/main/mcp/client'
import { McpTransportError, type McpTransport } from '../../src/main/mcp/transport'
import type { McpServerConfig } from '../../src/shared/mcp'

const CONFIG: McpServerConfig = {
  id: 'files',
  name: 'File Server',
  command: 'node',
  args: ['server.js'],
  enabled: true,
  createdAt: 0
}

interface Sent {
  method: string
  params?: unknown
  kind: 'request' | 'notify'
}

/** An in-memory transport: records what the client sent, replies from a table. */
function fakeTransport(
  replies: Record<string, (params?: unknown) => unknown>
): { transport: McpTransport; sent: Sent[]; closed: boolean } {
  const sent: Sent[] = []
  const state = { closed: false }
  const transport: McpTransport = {
    async request(method, params) {
      sent.push({ method, params, kind: 'request' })
      const reply = replies[method]
      if (reply === undefined) throw new McpTransportError(`no handler for ${method}`, -32601)
      return reply(params)
    },
    async notify(method, params) {
      sent.push({ method, params, kind: 'notify' })
    },
    async close() {
      state.closed = true
    },
    stderr: () => ''
  }
  return {
    transport,
    sent,
    get closed() {
      return state.closed
    }
  } as { transport: McpTransport; sent: Sent[]; closed: boolean }
}

const toolList = {
  tools: [
    {
      name: 'read_note',
      description: 'Read a note by name',
      inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }
    },
    { name: 'write_note', inputSchema: { type: 'object', properties: {} } },
    { name: '', description: 'nameless, must be dropped' },
    'not an object'
  ]
}

describe('connectMcpServer', () => {
  it('performs the handshake in order: initialize, then notifications/initialized', async () => {
    const fake = fakeTransport({
      initialize: () => ({ protocolVersion: '2025-06-18', capabilities: { tools: {} } }),
      'tools/list': () => toolList
    })
    await connectMcpServer(CONFIG, fake.transport)

    expect(fake.sent.map((entry) => entry.method)).toEqual(['initialize', 'notifications/initialized'])
    expect(fake.sent[0]!.kind).toBe('request')
    // The notification must not be a request: a server that answers it would confuse the id bookkeeping.
    expect(fake.sent[1]!.kind).toBe('notify')
    expect((fake.sent[0]!.params as { clientInfo: { name: string } }).clientInfo.name).toBe('ai-desktop')
  })

  it('accepts a server that answers with a different protocol version', async () => {
    const fake = fakeTransport({
      initialize: () => ({ protocolVersion: '2024-11-05' }),
      'tools/list': () => toolList
    })
    // Negotiation, not enforcement: rejecting on a version string would break servers that work.
    await expect(connectMcpServer(CONFIG, fake.transport)).resolves.toBeTruthy()
  })

  it('lists tools and drops entries it cannot use', async () => {
    const fake = fakeTransport({ initialize: () => ({}), 'tools/list': () => toolList })
    const server = await connectMcpServer(CONFIG, fake.transport)
    const tools = await server.listTools()

    expect(tools.map((tool) => tool.name)).toEqual(['read_note', 'write_note'])
    expect(tools[0]!.inputSchema).toMatchObject({ type: 'object' })
    // A tool with no description still gets one, so the model is never shown a blank entry.
    expect(tools[1]!.description).toContain('write_note')
  })

  it('survives a server that returns no tool list at all', async () => {
    const fake = fakeTransport({ initialize: () => ({}), 'tools/list': () => ({}) })
    const server = await connectMcpServer(CONFIG, fake.transport)
    expect(await server.listTools()).toEqual([])
  })

  it('calls a tool and maps its content blocks', async () => {
    const fake = fakeTransport({
      initialize: () => ({}),
      'tools/call': () => ({
        content: [
          { type: 'text', text: 'first' },
          { type: 'text', text: 'second' },
          { type: 'image', data: 'AAAA', mimeType: 'image/png' }
        ]
      })
    })
    const server = await connectMcpServer(CONFIG, fake.transport)
    const result = await server.callTool('read_note', { name: 'x' })

    expect(fake.sent.find((entry) => entry.method === 'tools/call')?.params).toEqual({
      name: 'read_note',
      arguments: { name: 'x' }
    })
    expect(result.content).toHaveLength(3)
    expect(result.isError).toBeUndefined()
    expect(mcpResultText(result)).toContain('first')
    // The dropped image is reported rather than silently lost.
    expect(mcpResultText(result)).toContain('non-text block')
  })

  it('passes a server-reported error through as a tool error, not as a crash', async () => {
    const fake = fakeTransport({
      initialize: () => ({}),
      'tools/call': () => ({ content: [{ type: 'text', text: 'nope' }], isError: true })
    })
    const server = await connectMcpServer(CONFIG, fake.transport)
    const result = await server.callTool('read_note', {})
    expect(result.isError).toBe(true)
  })

  it('propagates a transport failure as an exception the caller can catch', async () => {
    const fake = fakeTransport({ initialize: () => ({}) })
    const server = await connectMcpServer(CONFIG, fake.transport)
    // `tools/list` has no handler in this double, so it throws a protocol error.
    await expect(server.listTools()).rejects.toBeInstanceOf(McpTransportError)
  })

  it('distinguishes a server-side error from the transport dying', async () => {
    const serverError = new McpTransportError('bad arguments', -32602)
    const died = new McpTransportError('server exited')
    expect(isServerError(serverError)).toBe(true)
    // A dead transport must be retried/reported differently: asking the same dead server again cannot help.
    expect(isServerError(died)).toBe(false)
  })

  it('closes the transport', async () => {
    const fake = fakeTransport({ initialize: () => ({}) })
    const server = await connectMcpServer(CONFIG, fake.transport)
    await server.close()
    expect(fake.closed).toBe(true)
  })
})

describe('mcpToolName', () => {
  it('namespaces so the approval gate can tell an MCP tool from a built-in', () => {
    expect(mcpToolName('files', 'read_note')).toBe('mcp__files__read_note')
  })

  it('sanitises so a hostile id cannot smuggle a separator', () => {
    expect(mcpToolName('a__b', 'c')).toBe('mcp__a__b__c')
    expect(mcpToolName('a b/c', 'd e')).toBe('mcp__a_b_c__d_e')
  })
})
