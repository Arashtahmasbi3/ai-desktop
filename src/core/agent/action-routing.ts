/**
 * Remote-first routing of one action (F0-4 extraction, v2.3.2 A.1).
 *
 * Pure: given the caller's routing decision, it returns either the (possibly rewritten)
 * action or a synthetic failed observation that answers the model with the routing error.
 * Never let a local tool run against a remote project.
 */
import type { AgentAction, AgentToolResult } from '@shared/agent'
import type { RoutingDecision } from './remote-routing'
import { failedToolResult } from './tool-results'
import { stableStringify } from './tools'

export type ActionRouting = (
  toolName: string,
  args: Record<string, unknown>
) => RoutingDecision

export function routeAction(
  routing: ActionRouting | undefined,
  action: AgentAction
): { action: AgentAction } | { error: AgentToolResult } {
  if (!routing || !action.valid) return { action }
  const decision = routing(action.name, action.arguments)
  if (decision.kind === 'passthrough') return { action }
  if (decision.kind === 'error') {
    return { error: failedToolResult(action, decision.message, 'blocked') }
  }
  const name = decision.tool
  const args = decision.args
  return {
    action: { ...action, name, arguments: args, signature: name + ':' + stableStringify(args) }
  }
}
