import type { ToolDefinition } from '@shared/types'
import type { ToolExecutor } from '@core/agent/tools'
import type { ToolRoute } from './composite-executor'

/**
 * One place where a run's tools are assembled (F0-1).
 *
 * Before this existed, `agent-service` grew a run's tool list by pushing into two parallel arrays — one of
 * `ToolDefinition`s for the model and one of `ToolRoute`s for the executor — five and six times, interleaved with
 * `hint +=` statements. A definition without a route is a tool the model can call that nothing can run; a route
 * without a definition is a tool nothing can call. The builder keeps them together, answers "what does this run
 * expose?", and is the seam an MCP server will register into: a server's tools arrive as one group with its own
 * executor, and neither the orchestrator nor the service needs to know where they came from.
 *
 * It deliberately does NOT build the final executor. The caller has two rules the builder must not swallow:
 * routes are first wrapped so that `server_id` / `source_vps_id` / `target_vps_id` canonicalise from id, name or
 * host, and a single-route run uses that executor directly instead of wrapping it in a dispatcher. Both live in
 * `agent-service` and both are pinned by tests; moving them here would have been a silent behaviour change.
 */
export interface ToolGroup {
  definitions: ToolDefinition[]
  /**
   * The executor that answers these names. Absent means the sandbox executor handles them — the built-in
   * file/shell tools, which never needed a route.
   */
  executor?: ToolExecutor
  /** One sentence for the model, appended to the run's system hint. */
  hint?: string
}

/** What a run actually needs, and what `AgentRunOptions` already accepts. */
export interface RunTooling {
  extraTools?: ToolDefinition[]
  extraExecutor?: ToolExecutor
  systemHint?: string
}

export class ToolsetBuilder {
  private readonly collected: ToolDefinition[] = []
  private readonly collectedRoutes: ToolRoute[] = []
  private readonly collectedHints: string[] = []
  private readonly registered = new Set<string>()

  /** Register a group. A name may only be registered once: two owners would make dispatch order decide behaviour. */
  add(group: ToolGroup): this {
    if (group.definitions.length === 0 && group.hint === undefined) return this
    for (const definition of group.definitions) {
      if (this.registered.has(definition.name)) {
        throw new Error(`tool "${definition.name}" is registered twice`)
      }
      this.registered.add(definition.name)
      this.collected.push(definition)
    }
    if (group.executor !== undefined) {
      this.collectedRoutes.push({
        names: new Set(group.definitions.map((definition) => definition.name)),
        executor: group.executor
      })
    }
    if (group.hint !== undefined && group.hint !== '') this.collectedHints.push(group.hint)
    return this
  }

  addAll(groups: readonly ToolGroup[]): this {
    for (const group of groups) this.add(group)
    return this
  }

  /**
   * Register routes a composed planner produced (v2.4's `planV24Tools` returns its own definitions and routes).
   * The names are recorded so `build` can still check that nothing is routed that the model cannot call.
   */
  addRoutes(routes: readonly ToolRoute[]): this {
    this.collectedRoutes.push(...routes)
    return this
  }

  addHint(hint: string | undefined): this {
    if (hint !== undefined && hint !== '') this.collectedHints.push(hint)
    return this
  }

  get toolCount(): number {
    return this.collected.length
  }

  definitions(): ToolDefinition[] {
    return [...this.collected]
  }

  routes(): ToolRoute[] {
    return [...this.collectedRoutes]
  }

  names(): string[] {
    return this.collected.map((definition) => definition.name)
  }

  has(name: string): boolean {
    return this.registered.has(name)
  }

  /**
   * Produce the run options. An empty builder yields `{}` — no tools, no executor, no hint — which is exactly what
   * a run with no extra tools should look like.
   *
   * Throws when a route names a tool the model was never told about: that tool could never be called, and the
   * mistake is silent otherwise.
   */
  build(options: { systemHint?: string; executor?: ToolExecutor } = {}): RunTooling {
    if (this.collected.length === 0) {
      const onlyHint = options.systemHint
      return onlyHint === undefined ? {} : { systemHint: onlyHint }
    }

    const unknown = this.collectedRoutes.flatMap((route) =>
      [...route.names].filter((name) => !this.registered.has(name))
    )
    if (unknown.length > 0) {
      throw new Error(`route registered for unknown tool(s): ${unknown.join(', ')}`)
    }

    const hint = [...this.collectedHints, options.systemHint ?? ''].filter((part) => part !== '').join(' ')
    return {
      extraTools: [...this.collected],
      ...(options.executor !== undefined ? { extraExecutor: options.executor } : {}),
      ...(hint === '' ? {} : { systemHint: hint })
    }
  }
}
