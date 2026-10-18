/**
 * The stdio transport against a real child process (F0-2).
 *
 * The in-memory double proves the protocol; it cannot prove the framing. A pipe splits writes wherever it likes, so
 * a naive reader sees half a JSON object and dies — and that failure only appears with a real process. This spawns
 * a four-line MCP server with `node -e` and drives the full handshake, list and call through it.
 *
 * No network, no dependency, and the child is always closed. If `node` is missing the group is skipped rather than
 * passing vacuously.
 */
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { StdioTransport } from '../../src/main/mcp/transport'
import { connectMcpServer } from '../../src/main/mcp/client'
import type { McpServerConfig } from '../../src/shared/mcp'

const nodeAvailable = spawnSync('node', ['-e', 'process.exit(0)'], { encoding: 'utf8' }).status === 0

/**
 * A minimal MCP server over stdio. Written with string concatenation rather than template literals so it survives
 * being embedded in this file, and it prints a banner first on purpose: real servers do, and the client must not
 * treat a non-JSON line as a fatal parse error.
 */
const SERVER_SCRIPT = [
  "const readline = require('node:readline')",
  "process.stdout.write('server starting\\n')",
  "const rl = readline.createInterface({ input: process.stdin })",
  'rl.on("line", function (line) {',
  '  var msg',
  '  try { msg = JSON.parse(line) } catch (e) { return }',
  '  function reply(result) {',
  '    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: result }) + "\\n")',
  '  }',
  '  if (msg.method === "initialize") {',
  '    process.stderr.write("handshake\\n")',
  '    return reply({ protocolVersion: "2025-06-18", capabilities: { tools: {} } })',
  '  }',
  '  if (msg.method === "tools/list") {',
  '    return reply({ tools: [{ name: "echo", description: "Echo the arguments", inputSchema: { type: "object", properties: {} } }] })',
  '  }',
  '  if (msg.method === "tools/call") {',
  '    return reply({ content: [{ type: "text", text: "got:" + JSON.stringify(msg.params.arguments) }] })',
  '  }',
  '})'
].join('\n')

const CONFIG: McpServerConfig = {
  id: 'echo',
  name: 'Echo Server',
  command: 'node',
  args: ['-e', SERVER_SCRIPT],
  enabled: true,
  createdAt: 0
}

describe.skipIf(!nodeAvailable)('StdioTransport round-trip', () => {
  it('completes the handshake, lists tools and calls one', async () => {
    const transport = new StdioTransport(CONFIG.command, CONFIG.args, { timeoutMs: 10_000 })
    try {
      const server = await connectMcpServer(CONFIG, transport)

      const tools = await server.listTools()
      expect(tools.map((tool) => tool.name)).toEqual(['echo'])
      expect(tools[0]!.description).toBe('Echo the arguments')

      const result = await server.callTool('echo', { hello: 'world' })
      expect(result.isError).toBeUndefined()
      expect(result.content[0]!.text).toContain('got:')
      expect(result.content[0]!.text).toContain('world')

      // What the server wrote to stderr is available for diagnosis and never thrown at the caller.
      expect(server.stderr()).toContain('handshake')
    } finally {
      await transport.close()
    }
  }, 20_000)

  it('rejects a pending call when the server dies instead of hanging the run', async () => {
    // This server exits immediately, mid-handshake.
    const transport = new StdioTransport('node', ['-e', 'process.exit(3)'], { timeoutMs: 10_000 })
    try {
      await expect(connectMcpServer(CONFIG, transport)).rejects.toThrow(/exited|closed/i)
    } finally {
      await transport.close()
    }
  }, 20_000)

  it('fails a request made after close instead of writing to a dead pipe', async () => {
    const transport = new StdioTransport(CONFIG.command, CONFIG.args, { timeoutMs: 10_000 })
    await transport.close()
    await expect(transport.request('tools/list')).rejects.toThrow(/not running/i)
  }, 20_000)
})
