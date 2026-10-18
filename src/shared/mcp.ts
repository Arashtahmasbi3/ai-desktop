/**
 * MCP (Model Context Protocol) types shared by main and renderer (F0-2).
 *
 * The point of MCP is that a capability stops being code we write. A server publishes tools; we list them and
 * expose them to the model. Everything in this file is deliberately provider-agnostic and free of transport detail:
 * the protocol layer lives in `main/mcp/`.
 */

/** One configured server, as persisted. */
export interface McpServerConfig {
  id: string
  name: string
  /** Executable to spawn (stdio transport). */
  command: string
  args: string[]
  /** Extra environment for the child process; values may be secrets and are never sent to the renderer. */
  env?: Record<string, string>
  enabled: boolean
  createdAt: number
}

/** A server as the renderer sees it — no environment, no command line. */
export interface McpServerView {
  id: string
  name: string
  enabled: boolean
  /** Short description of how it is launched, for the settings list. */
  launch: string
  createdAt: number
  toolCount?: number
  /** Last connection error, when there is one. */
  error?: string
}

/**
 * What Settings sends to add or edit a server (F0-2d).
 *
 * The environment crosses the bridge in this direction only: it holds tokens, so it is written to
 * main and never read back — `McpServerView` is what comes the other way.
 */
export interface McpServerInput {
  /** Present to edit an existing server; absent to add one. */
  id?: string
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
  enabled?: boolean
}

/** A tool as the server describes it. */
export interface McpToolInfo {
  serverId: string
  name: string
  description: string
  /** JSON schema for the arguments, forwarded to the model unchanged. */
  inputSchema: Record<string, unknown>
}

export type McpConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface McpServerStatus {
  serverId: string
  state: McpConnectionState
  toolCount: number
  error?: string
}

/** One block of a `tools/call` result. MCP servers may return text or images. */
export interface McpContentBlock {
  type: string
  text?: string
  data?: string
  mimeType?: string
}

export interface McpCallResult {
  content: McpContentBlock[]
  isError?: boolean
}
