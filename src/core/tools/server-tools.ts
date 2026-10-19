import type { ToolDefinition } from '@shared/types'
import type { AgentAction, AgentToolResult } from '@shared/agent'
import type { PortFact, ReachabilityReport } from '@shared/vps'
import type { ToolExecutor, ToolExecOptions } from '@core/agent/tools'
import { describePortFact } from '@core/remote/reachability'

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
 * X1 (v4.3): the line used to end in `[offline]` whenever the app held no SSH session, and a
 * server that was up — ping 0% loss, sshd listening, the user logged into its console — was read
 * as "the machine is down". Three different facts shared one word, so the line now carries all
 * three separately and never prints `offline`:
 *
 *   - `hasSession`  — do we hold an SSH connection from the app?
 *   - `portFrom*`   — an *observed* reachability fact, with the path it came from and its time;
 *                     `open: null` means nobody looked, which is not "down".
 *   - `configured`  — it exists in Settings.
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
  /**
   * Does this app hold an open SSH connection to this server *right now*?
   *
   * Named for the session, not the host, because the old field (`connected` → "offline") is what
   * told the user a healthy machine was down. A server with no session is simply not connected
   * *from here*.
   */
  hasSession: boolean
  /**
   * Does this server exist in Settings? Always true for a roster entry; named so that the three
   * facts ("saved", "session", "port reachable") can never be confused again.
   */
  configured: boolean
  /** Observed: could a *source server* open a TCP connection to this port? */
  portFromSource?: PortFact
  /** Observed: could *this computer* open a TCP connection to this port? */
  portFromLocal?: PortFact
  /** The full three-path preflight for this server, when one has run (X4). */
  reachability?: ReachabilityReport
  /** True for the server the active project is bound to, when there is one. */
  active?: boolean
  policyMode?: string
}

export interface ServerListDeps {
  listServers(): Promise<ServerSummary[]>
  /**
   * Observe one server's port from every path this app can use (X4). Injected, so a test never
   * opens a socket, and optional, so a roster read still works with no prober at all. A failure
   * here must degrade to `unknown` facts — never to a failed roster.
   */
  observe?: (server: ServerSummary) => Promise<ReachabilityReport | undefined>
}

export const LIST_SERVERS_TOOL: ToolDefinition = {
  name: 'list_servers',
  description:
    'List the servers saved in Settings, with the id, display name, user@host:port, whether this ' +
    'app currently holds an SSH session to each one, and what the port probe observed from each ' +
    'path (from a source server, and from this computer) with the time it was observed. Read-only. ' +
    'Call this BEFORE any tool that needs a server id (remote_shell, migrate_project, ' +
    'migrate_database, migrate_docker, diagnose_crash, get_service_logs, get_disk_usage, ' +
    'get_system_health, get_process_list, scaffold_project, worktree_*, project_user_*) — and ' +
    'never ask the user for an id, and never guess one. A server with no session is NOT down: ' +
    'report what the port facts say, and never call a server offline because a session is missing. ' +
    'Those tools also accept a server NAME or HOST, which is usually easier to name than an id.',
  parameters: {
    type: 'object',
    properties: {},
    additionalProperties: false
  }
}

/**
 * One line per server, plus the sentences that tell the model what to do with it. Kept
 * pure and separately testable.
 *
 * The line is facts, not a status: `[session open] [22 from source: closed, 06:12] [22 from local:
 * open, 06:13]`. A path nobody probed reads `unknown`; the word `offline` is never printed.
 */
export function formatServerList(servers: readonly ServerSummary[]): string {
  if (servers.length === 0) {
    return (
      'No servers are saved yet. Tell the user to add one in Settings -> Connections, ' +
      'then connect it, and stop — do not invent a server id.'
    )
  }
  const lines = servers.map((server) => {
    const facts = [
      server.hasSession ? 'session open' : 'no session',
      describePortFact(server.portFromSource, server.port, 'source'),
      describePortFact(server.portFromLocal, server.port, 'local')
    ]
    if (server.active) facts.push('active project server')
    if (server.policyMode) facts.push(`policy: ${server.policyMode}`)
    return `- ${server.name} (id: ${server.id}) ${server.username}@${server.host}:${server.port} [${facts.join(
      '] ['
    )}]`
  })

  /*
   * X4: when the paths disagree, the disagreement is the diagnosis, so it travels with the roster
   * — one sentence and the consequences that are actually available. Only reports with next steps
   * qualify, so a healthy or unprobed server adds no noise.
   */
  const disagreements = servers
    .map((server) => server.reachability)
    .filter(
      (report): report is ReachabilityReport =>
        report !== undefined && report.nextSteps.length > 0
    )

  return [
    `Saved servers (${servers.length}) — every one is configured in Settings:`,
    ...lines,
    ...(disagreements.length === 0
      ? []
      : [
          '',
          'Reachability (times are UTC):',
          ...disagreements.flatMap((report) => [
            report.summary,
            ...report.nextSteps.map((step) => `- ${step}`)
          ])
        ]),
    '',
    'Pass the id, the name, or the host — all three are accepted wherever a server is ' +
      'expected. Only a server with an open session can be used as a migration SOURCE. A server ' +
      'with no session is not necessarily down — the port facts say whether its port is open, from ' +
      'which path, and when it was observed; "unknown" means nobody looked. A target that is not ' +
      "saved at all can be reached with migrate_project's target_host."
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
      const observed = await this.observe(servers)
      return {
        ...base,
        ok: true,
        output: formatServerList(observed),
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

  /**
   * Attach each server's observed facts. Per server, an observation that throws or returns nothing
   * leaves the entry as it was, so one unreachable host cannot take the whole roster down.
   */
  private async observe(servers: ServerSummary[]): Promise<ServerSummary[]> {
    const observe = this.deps.observe
    if (observe === undefined) return servers
    return Promise.all(
      servers.map(async (server) => {
        try {
          const report = await observe(server)
          if (report === undefined) return server
          return {
            ...server,
            portFromSource: report.source,
            portFromLocal: report.local,
            reachability: report
          }
        } catch {
          return server
        }
      })
    )
  }
}
