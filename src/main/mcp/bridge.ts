import type { ToolDefinition } from '@shared/types'
import type { AgentToolResult } from '@shared/agent'
import type { ToolExecutor } from '@core/agent/tools'
import type { ToolsetBuilder, ToolGroup } from '@core/tools/toolset'
import type { McpResourceInfo, McpServerConfig, McpServerStatus, McpToolInfo } from '@shared/mcp'
import { mcpResultText, mcpToolName, type McpServerHandle } from './client'

/**
 * Register MCP servers' tools into a run (F0-2, the wiring).
 *
 * Two rules govern this file:
 *
 *  1. **A broken server must not break the run.** An MCP server is a foreign process. It can be missing, crash on
 *     start, or answer garbage. Each server is connected in isolation; a failure becomes a status entry, never an
 *     exception that takes the chat down.
 *  2. **Foreign tools are named as foreign.** Every tool is registered as `mcp__<server>__<tool>`, which is how the
 *     approval gate can treat it as a session-level action instead of as a built-in it recognises.
 */
export interface McpBridgeOptions {
  builder: ToolsetBuilder
  servers: readonly McpServerConfig[]
  /** Injected so tests never spawn a process. */
  connect: (config: McpServerConfig) => Promise<McpServerHandle>
}

export interface McpBridgeResult {
  statuses: McpServerStatus[]
  handles: McpServerHandle[]
  /**
   * The group these tools form, for a run's toolset. Returned as well as registered so a caller
   * that handed over a throwaway builder (the agent service collects the group, then lets
   * `ToolsetBuilder` own the real registration) does not have to rebuild it from names.
   * `undefined` when no server published a tool.
   */
  group: ToolGroup | undefined
  closeAll(): Promise<void>
}

/** Routes a namespaced tool name to the server that published it, or reads an advertised resource (T18). */
class McpToolExecutor implements ToolExecutor {
  constructor(
    private readonly routes: Map<string, { handle: McpServerHandle; toolName: string }>,
    private readonly resources: Map<string, { handle: McpServerHandle; resources: McpResourceInfo[] }> = new Map()
  ) {}

  async execute(action: { id: string; name: string; arguments: Record<string, unknown> }): Promise<AgentToolResult> {
    const resourceRoute = this.resources.get(action.name)
    if (resourceRoute !== undefined) {
      const uri = typeof action.arguments.uri === 'string' ? action.arguments.uri.trim() : ''
      const known = resourceRoute.resources.find((entry) => entry.uri === uri)
      if (!known) {
        return {
          actionId: action.id,
          name: action.name,
          attempts: 1,
          durationMs: 0,
          ok: false,
          output: '',
          error: `"${uri}" is not a resource this server advertises`
        }
      }
      try {
        const text = await resourceRoute.handle.readResource!(uri)
        return {
          actionId: action.id,
          name: action.name,
          attempts: 1,
          durationMs: 0,
          ok: true,
          output: text === '' ? '(the resource is empty)' : text
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          actionId: action.id,
          name: action.name,
          attempts: 1,
          durationMs: 0,
          ok: false,
          output: '',
          error: `MCP server "${resourceRoute.handle.serverName}": ${message}`
        }
      }
    }

    const route = this.routes.get(action.name)
    const base = { actionId: action.id, name: action.name, attempts: 1, durationMs: 0 }
    if (route === undefined) {
      return { ...base, ok: false, output: '', error: `no MCP server serves "${action.name}"` }
    }
    try {
      const result = await route.handle.callTool(route.toolName, action.arguments)
      const text = mcpResultText(result)
      if (result.isError === true) {
        return { ...base, ok: false, output: text, error: text === '' ? 'the server reported an error' : text }
      }
      return { ...base, ok: true, output: text }
    } catch (error) {
      // The transport died or the call timed out: report it as a tool failure so the model can react, and say the
      // server is the problem rather than pretending the command was wrong.
      const message = error instanceof Error ? error.message : String(error)
      return { ...base, ok: false, output: '', error: `MCP server "${route.handle.serverName}": ${message}` }
    }
  }
}

function definitionOf(info: McpToolInfo, name: string): ToolDefinition {
  return {
    name,
    description: `[${info.serverId}] ${info.description}`,
    parameters: info.inputSchema as ToolDefinition['parameters']
  }
}

/**
 * v4.3.17 (AGT-12): a name already taken gets `-2`, `-3`, … .
 *
 * Two servers can expose tools whose names sanitise to the same string, and a server can list a duplicate. The route
 * map silently kept the last one, and the builder then refused the whole group — which failed every run and leaked
 * the MCP processes because the throw happened before the caller could close them.
 */
function uniqueToolName(routes: Map<string, unknown>, base: string): string {
  if (!routes.has(base)) return base
  let suffix = 2
  while (routes.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}

export async function registerMcpTools(options: McpBridgeOptions): Promise<McpBridgeResult> {
  const statuses: McpServerStatus[] = []
  const handles: McpServerHandle[] = []
  /*
   * One route map and one executor for every MCP tool, regardless of server count: the map is the dispatch table,
   * and a second executor closing over the same map would just be a copy of the first.
   */
  const routes = new Map<string, { handle: McpServerHandle; toolName: string }>()
  const resourceRoutes = new Map<string, { handle: McpServerHandle; resources: McpResourceInfo[] }>()
  const allDefinitions: ToolDefinition[] = []
  const seenIds = new Set<string>()

  for (const config of options.servers) {
    if (!config.enabled) {
      statuses.push({ serverId: config.id, state: 'disconnected', toolCount: 0 })
      continue
    }
    if (seenIds.has(config.id)) {
      // Two records with one id would make the builder refuse the second, which is correct — but the reason should
      // be visible here rather than surfacing as a thrown error from a registration call.
      statuses.push({ serverId: config.id, state: 'error', toolCount: 0, error: 'duplicate server id' })
      continue
    }
    seenIds.add(config.id)

    try {
      const handle = await options.connect(config)
      const tools = await handle.listTools()
      handles.push(handle)

      /*
       * T18: resources, when the server publishes any. One tool per server (`..._read_resource`) rather than one per
       * resource: a server can advertise hundreds of files, and a hundred tools would crowd the model's tool list. The
       * advertised URIs go into the description, and the executor refuses a URI that is not on that list.
       */
      let resources: McpResourceInfo[] = []
      if (typeof handle.listResources === 'function') {
        resources = await handle.listResources().catch(() => [])
      }

      if (tools.length === 0 && resources.length === 0) {
        statuses.push({ serverId: config.id, state: 'connected', toolCount: 0, resourceCount: 0 })
        continue
      }
      for (const info of tools) {
        /*
         * v4.3.17 (AGT-12): two tool names that sanitise to the same string (or a server that lists the same tool
         * twice) collided in the route map and made the builder refuse the whole group — every run failed, and the
         * spawned MCP processes leaked because the throw skipped `closeAll`. Colliding names get a numeric suffix.
         */
        const name = uniqueToolName(routes, mcpToolName(config.id, info.name))
        routes.set(name, { handle, toolName: info.name })
        allDefinitions.push(definitionOf(info, name))
      }

      if (resources.length > 0) {
        const base = mcpToolName(config.id, 'read_resource')
        const name = routes.has(base) || resourceRoutes.has(base) ? `${base}-resource` : base
        const listed = resources
          .slice(0, 10)
          .map((entry) => `${entry.name} (${entry.uri})`)
          .join(', ')
        const more = resources.length > 10 ? `, and ${resources.length - 10} more` : ''
        resourceRoutes.set(name, { handle, resources })
        allDefinitions.push({
          name,
          description: `[${config.id}] Read a resource published by ${config.name}. Available: ${listed}${more}`,
          parameters: {
            type: 'object',
            properties: { uri: { type: 'string', description: 'The resource URI as advertised' } },
            required: ['uri'],
            additionalProperties: false
          }
        })
      }

      statuses.push({ serverId: config.id, state: 'connected', toolCount: tools.length, resourceCount: resources.length })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      statuses.push({ serverId: config.id, state: 'error', toolCount: 0, error: message })
    }
  }

  /*
   * Every server's tools are one group with one executor: the route map is the dispatch table, so
   * a second group would only duplicate it. The group is registered here *and* returned, because
   * `ToolsetBuilder.build()` deliberately does not compose the executor — the caller needs both
   * halves together, or the model would see a tool nothing can run.
   */
  const group: ToolGroup | undefined =
    allDefinitions.length === 0
      ? undefined
      : { definitions: allDefinitions, executor: new McpToolExecutor(routes, resourceRoutes) }
  if (group !== undefined) {
    try {
      options.builder.add(group)
    } catch (error) {
      // v4.3.17 (AGT-12): a refused group must not leave the servers it started running with nobody holding them.
      await Promise.all(handles.map((handle) => handle.close().catch(() => undefined)))
      throw error
    }
  }

  return {
    statuses,
    handles,
    group,
    async closeAll(): Promise<void> {
      await Promise.all(handles.map((handle) => handle.close().catch(() => undefined)))
    }
  }
}
