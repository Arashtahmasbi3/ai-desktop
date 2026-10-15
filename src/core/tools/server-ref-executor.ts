import type { AgentAction, AgentToolResult } from '@shared/agent'
import type { ToolExecutor, ToolExecOptions } from '@core/agent/tools'
import type { ToolRoute } from './composite-executor'
import {
  SERVER_REF_ARGS,
  formatServerRefFailure,
  resolveServerRef,
  type ServerRefTarget
} from './server-ref'

/**
 * Accept a server NAME or HOST anywhere an id is expected (v2.8.1).
 *
 * Wrapping the routes instead of editing fifteen tool modules keeps the rule in one
 * place: before a tool runs, any `server_id` / `source_vps_id` / `target_vps_id` argument
 * is canonicalised to a saved server's id. The model and the user both work in names;
 * only the SSH layer needs ids.
 *
 * An unresolvable reference is answered with the roster rather than a dead end, so the
 * model corrects itself instead of asking the user to copy a UUID out of a panel that
 * never showed one.
 */
export interface ServerRefResolver {
  listServers(): Promise<ServerRefTarget[]>
  connectedServers(): readonly string[]
}

/** Tools that can only act on a server that is already connected. */
const REQUIRES_CONNECTION_ARGS: ReadonlySet<string> = new Set(['server_id', 'source_vps_id'])

export class ServerRefResolvingExecutor implements ToolExecutor {
  constructor(
    private readonly inner: ToolExecutor,
    private readonly resolver: ServerRefResolver
  ) {}

  async execute(action: AgentAction, options?: ToolExecOptions): Promise<AgentToolResult> {
    const failure = await this.rewrite(action)
    if (failure) return failure
    return this.inner.execute(action, options)
  }

  /**
   * Rewrite in place. Returns a failure result when a reference cannot be resolved,
   * or undefined when the action is ready (or had nothing to resolve).
   */
  private async rewrite(action: AgentAction): Promise<AgentToolResult | undefined> {
    const args = action.arguments
    if (!args || typeof args !== 'object') return undefined

    const present = SERVER_REF_ARGS.filter((name) => {
      const value = args[name]
      return typeof value === 'string' && value.trim() !== ''
    })
    if (present.length === 0) return undefined

    // A roster lookup that fails must not block the tool: fall through and let the tool's
    // own validation report something. This also keeps the wrapper free of a hard
    // dependency on a configured VPS store.
    let servers: ServerRefTarget[]
    try {
      servers = await this.resolver.listServers()
    } catch {
      return undefined
    }
    if (servers.length === 0) return undefined

    const connected = this.resolver.connectedServers()
    for (const name of present) {
      const raw = String(args[name]).trim()
      // An exact id needs no work and must never be second-guessed.
      if (servers.some((server) => server.id === raw)) continue

      const match = resolveServerRef(raw, servers, {
        requireConnected: REQUIRES_CONNECTION_ARGS.has(name) && connected.length > 0,
        connected
      })
      if (!match.ok) {
        return {
          actionId: action.id,
          name: action.name,
          ok: false,
          output: '',
          error: `${name}: ${formatServerRefFailure(match)}`,
          code: 'invalid_arguments',
          attempts: 1,
          durationMs: 0
        }
      }
      args[name] = match.server.id
    }
    return undefined
  }
}

/** Wrap every route so its arguments are canonicalised before dispatch. */
export function wrapServerRefRoutes(
  routes: readonly ToolRoute[],
  resolver: ServerRefResolver
): ToolRoute[] {
  return routes.map((route) => ({
    names: route.names,
    executor: new ServerRefResolvingExecutor(route.executor, resolver)
  }))
}
