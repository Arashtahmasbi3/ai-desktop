import type { ToolDefinition } from '@shared/types'
import type { AgentAction, AgentToolResult } from '@shared/agent'
import type { ToolExecutor, ToolExecOptions } from '@core/agent/tools'

/**
 * `list_servers` — the roster the model was missing (v2.8.1).
 *
 * Reported by the user, with the agent's own words pasted in: asked to migrate a project
 * to a second saved server, the agent demanded a "server UUID" it said it could not
 * discover, then recited the *active project's* id from its prompt and told the user to
 * copy the destination's id out of a panel.
 *
 * The root cause was structural: no tool and no prompt line ever enumerated saved
 * servers, the only id the model could see was the active project's own, and every
 * id-taking tool resolved by exact id (`ssh-manager.ts` `find(entry => entry.id === id)`).
 * The UI never renders an id either, so the human could not supply one. Migration to a
 * second saved server was impossible from the chat.
 *
 * This tool returns data only. It must never select, pin or override the server a run
 * targets — that stays with `resolveVpsForRun`, which fails closed on purpose.
 */
export interface ServerSummary {
  id: string
  name: string
  host: string
  port: number
  username: string
  /** Whether the SSH connection is currently open. */
  connected: boolean
  /** True for the server the active project is bound to, when there is one. */
  active?: boolean
  policyMode?: string
}

export interface ServerListDeps {
  listServers(): Promise<ServerSummary[]>
}

export const LIST_SERVERS_TOOL: ToolDefinition = {
  name: 'list_servers',
  description:
    'List the servers saved in Settings, with the id, display name, user@host:port and ' +
    'whether each is connected. Read-only. Call this BEFORE any tool that needs a server ' +
    'id (remote_shell, migrate_project, migrate_database, migrate_docker, diagnose_crash, ' +
    'get_service_logs, get_disk_usage, get_system_health, get_process_list, ' +
    'scaffold_project, worktree_*, project_user_*) — and never ask the user for an id, ' +
    'and never guess one. Those tools also accept a server NAME or HOST, which is usually ' +
    'easier to name than an id.',
  parameters: {
    type: 'object',
    properties: {},
    additionalProperties: false
  }
}

/**
 * One line per server, plus the sentence that tells the model what to do with it. Kept
 * pure and separately testable.
 */
export function formatServerList(servers: readonly ServerSummary[]): string {
  if (servers.length === 0) {
    return (
      'No servers are saved yet. Tell the user to add one in Settings -> Connections, ' +
      'then connect it, and stop — do not invent a server id.'
    )
  }
  const lines = servers.map((server) => {
    const flags = [server.connected ? 'connected' : 'offline']
    if (server.active) flags.push('active project server')
    if (server.policyMode) flags.push(`policy: ${server.policyMode}`)
    return `- ${server.name} (id: ${server.id}) ${server.username}@${server.host}:${server.port} [${flags.join(', ')}]`
  })
  return [
    `Saved servers (${servers.length}):`,
    ...lines,
    '',
    'Pass the id, the name, or the host — all three are accepted wherever a server is ' +
      'expected. Only a connected server can be used as a migration SOURCE. A target that ' +
      'is not saved at all can be reached with migrate_project\'s target_host.'
  ].join('\n')
}

/** True when `ref` matches a server by id, name or host (case-insensitive for name/host). */
export function matchesServerRef(server: ServerSummary, ref: string): boolean {
  const wanted = ref.trim()
  if (wanted === '') return false
  if (server.id === wanted) return true
  const lower = wanted.toLowerCase()
  if (server.name.toLowerCase() === lower) return true
  if (server.host.toLowerCase() === lower) return true
  return `${server.host}:${server.port}`.toLowerCase() === lower
}

export class ListServersToolExecutor implements ToolExecutor {
  constructor(private readonly deps: ServerListDeps) {}

  async execute(action: AgentAction, _options: ToolExecOptions = {}): Promise<AgentToolResult> {
    const startedAt = Date.now()
    const base = {
      actionId: action.id,
      name: action.name,
      attempts: 1,
      durationMs: 0
    }

    if (action.name !== LIST_SERVERS_TOOL.name) {
      return {
        ...base,
        ok: false,
        output: '',
        error: `Unknown tool "${action.name}"`,
        code: 'unknown_tool'
      }
    }

    try {
      const servers = await this.deps.listServers()
      return {
        ...base,
        ok: true,
        output: formatServerList(servers),
        durationMs: Date.now() - startedAt
      }
    } catch (error) {
      // A roster lookup that fails must not look like "no servers" — that would send the
      // model off to ask the user for an id.
      return {
        ...base,
        ok: false,
        output: '',
        error: `Could not read the saved servers: ${
          error instanceof Error ? error.message : String(error)
        }`,
        code: 'remote_error',
        durationMs: Date.now() - startedAt
      }
    }
  }
}
