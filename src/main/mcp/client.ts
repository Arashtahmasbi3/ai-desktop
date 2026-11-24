import type {
  McpCallResult,
  McpContentBlock,
  McpResourceInfo,
  McpServerConfig,
  McpToolInfo
} from '@shared/mcp'
import { McpTransportError, type McpTransport } from './transport'

/**
 * A minimal, correct MCP client: `initialize`, `tools/list`, `tools/call` (F0-2).
 *
 * Scope is deliberate. MCP also defines resources, prompts, sampling and notifications; the protocol's own
 * reference clients (and DeepSeek Harness, per its documentation) support **tools** first, because tools are what
 * an agent loop can actually use. Everything else would be an interface with nothing behind it — the exact failure
 * this project already made once with a Plugins page that gated nothing.
 *
 * The client never validates the server's `protocolVersion` strictly: a server that answers with a different
 * revision is accepted and the tools are used if they parse. Rejecting on a version string would break servers
 * that work, and the specification expects negotiation rather than enforcement.
 */
const PROTOCOL_VERSION = '2025-06-18'
const CLIENT_INFO = { name: 'ai-desktop', version: '1' }

export interface McpServerHandle {
  readonly serverId: string
  readonly serverName: string
  listTools(): Promise<McpToolInfo[]>
  callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult>
  /**
   * T18: MCP resources, when the server publishes any. Optional so an older or simpler handle keeps working — a server
   * without resources is not a broken server.
   */
  listResources?(): Promise<McpResourceInfo[]>
  readResource?(uri: string): Promise<string>
  close(): Promise<void>
  stderr(): string
}

/** Turn whatever a server returned into content blocks, ignoring shapes we do not understand. */
function toBlocks(value: unknown): McpContentBlock[] {
  if (!Array.isArray(value)) return []
  const blocks: McpContentBlock[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    const type = typeof record.type === 'string' ? record.type : 'unknown'
    blocks.push({
      type,
      ...(typeof record.text === 'string' ? { text: record.text } : {}),
      ...(typeof record.data === 'string' ? { data: record.data } : {}),
      ...(typeof record.mimeType === 'string' ? { mimeType: record.mimeType } : {})
    })
  }
  return blocks
}

/** `mcp__<server>__<tool>` — a namespace the approval gate can see is not a built-in tool. */
export function mcpToolName(serverId: string, toolName: string): string {
  const safeServer = serverId.replace(/[^A-Za-z0-9_]/g, '_')
  const safeTool = toolName.replace(/[^A-Za-z0-9_]/g, '_')
  return `mcp__${safeServer}__${safeTool}`
}

export async function connectMcpServer(
  config: McpServerConfig,
  transport: McpTransport
): Promise<McpServerHandle> {
  await transport.request('initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: { tools: {}, resources: {} },
    clientInfo: CLIENT_INFO
  })
  await transport.notify('notifications/initialized')

  return {
    serverId: config.id,
    serverName: config.name,
    async listTools(): Promise<McpToolInfo[]> {
      const result = (await transport.request('tools/list')) as { tools?: unknown }
      const raw = Array.isArray(result?.tools) ? result.tools : []
      const tools: McpToolInfo[] = []
      for (const entry of raw) {
        if (typeof entry !== 'object' || entry === null) continue
        const record = entry as Record<string, unknown>
        if (typeof record.name !== 'string' || record.name === '') continue
        tools.push({
          serverId: config.id,
          name: record.name,
          description:
            typeof record.description === 'string' && record.description !== ''
              ? record.description
              : `${record.name} (from ${config.name})`,
          inputSchema:
            typeof record.inputSchema === 'object' && record.inputSchema !== null
              ? (record.inputSchema as Record<string, unknown>)
              : { type: 'object', properties: {} }
        })
      }
      return tools
    },
    async callTool(name, args): Promise<McpCallResult> {
      const result = (await transport.request('tools/call', { name, arguments: args })) as {
        content?: unknown
        isError?: unknown
      }
      return {
        content: toBlocks(result?.content),
        ...(result?.isError === true ? { isError: true } : {})
      }
    },
    async listResources(): Promise<McpResourceInfo[]> {
      const result = (await transport.request('resources/list')) as { resources?: unknown }
      const raw = Array.isArray(result?.resources) ? result.resources : []
      const resources: McpResourceInfo[] = []
      for (const entry of raw) {
        if (typeof entry !== 'object' || entry === null) continue
        const record = entry as Record<string, unknown>
        if (typeof record.uri !== 'string' || record.uri === '') continue
        resources.push({
          serverId: config.id,
          uri: record.uri,
          name: typeof record.name === 'string' && record.name !== '' ? record.name : record.uri,
          ...(typeof record.description === 'string' ? { description: record.description } : {}),
          ...(typeof record.mimeType === 'string' ? { mimeType: record.mimeType } : {})
        })
      }
      return resources
    },
    async readResource(uri: string): Promise<string> {
      const result = (await transport.request('resources/read', { uri })) as { contents?: unknown }
      const raw = Array.isArray(result?.contents) ? result.contents : []
      const texts: string[] = []
      for (const entry of raw) {
        if (typeof entry !== 'object' || entry === null) continue
        const text = (entry as Record<string, unknown>).text
        if (typeof text === 'string') texts.push(text)
      }
      return texts.join('\\n')
    },
    close: () => transport.close(),
    stderr: () => transport.stderr()
  }
}

/** The text a result contributes to the model's observation. */
export function mcpResultText(result: McpCallResult): string {
  const parts = result.content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
  const other = result.content.filter((block) => block.type !== 'text')
  if (other.length > 0) {
    // Say what was dropped rather than silently losing it: an image a server returned is information the model
    // did not get, and the user should be able to see that.
    parts.push(`[${other.length} non-text block(s) not shown: ${other.map((block) => block.type).join(', ')}]`)
  }
  return parts.join('\n').trim()
}

/** True when an error came from the server rather than from the transport dying. */
export function isServerError(error: unknown): boolean {
  return error instanceof McpTransportError && error.code !== undefined
}
