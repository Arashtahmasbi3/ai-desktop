/**
 * Per-step accounting: token usage, the provider context budget, and the
 * productivity/reflection summary (F0-4 extraction).
 *
 * All pure functions over data the run already has.
 */
import type { Usage } from '@shared/types'
import type { AgentAction, AgentToolResult, ProviderEntry } from '@shared/agent'

/** Add one call's usage to the run total (v2.5: per-run accounting). */
export function addUsage(total: Usage | undefined, next: Usage | undefined): Usage | undefined {
  if (!next) return total
  if (!total) return { ...next }
  return {
    promptTokens: total.promptTokens + next.promptTokens,
    completionTokens: total.completionTokens + next.completionTokens,
    totalTokens: total.totalTokens + next.totalTokens
  }
}

/** The provider's context budget, less the space its own answer needs. */
export function defaultContextTokens(entry: ProviderEntry): number {
  const caps = entry.adapter.getCapabilities(entry.config.model)
  const reserve = caps.maxOutputTokens ?? 4096
  return Math.max(2048, (caps.contextWindow ?? 32_000) - reserve)
}

/** A step is productive when a newly-attempted action succeeds. */
export function isProductive(
  actions: AgentAction[],
  observations: AgentToolResult[],
  observedSignatures: Set<string>
): boolean {
  const attemptedBefore = new Set(observedSignatures)
  for (const action of actions) observedSignatures.add(action.signature)
  return observations.some(
    (result, index) => result.ok && !attemptedBefore.has(actions[index]?.signature ?? '')
  )
}

export function reflect(
  actions: AgentAction[],
  observations: AgentToolResult[],
  productive: boolean
): string {
  const failed = observations.filter((result) => !result.ok)
  const succeeded = observations.filter((result) => result.ok)
  let summary: string
  if (failed.length === 0 && succeeded.length > 0) {
    summary = `Executed ${succeeded.length} action(s): ${succeeded.map((r) => r.name).join(', ')}.`
  } else if (succeeded.length > 0 && failed.length > 0) {
    summary = `${succeeded.length} action(s) succeeded, ${failed.length} failed (${failed
      .map((r) => r.name)
      .join(', ')}).`
  } else if (failed.length > 0) {
    summary = `All ${failed.length} action(s) failed: ${failed.map((r) => `${r.name}(${r.code})`).join(', ')}.`
  } else {
    summary = `${actions.length} action(s) requested; no observations recorded.`
  }
  return productive ? summary : `No new progress. ${summary}`
}
