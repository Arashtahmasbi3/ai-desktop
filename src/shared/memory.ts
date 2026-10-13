/**
 * Project "memory": notes a repository keeps for the agent (AGENTS.md /
 * AI_CONTEXT.md) and a rough context-window budget. Pure so it is testable and
 * reusable from both the main process and the renderer.
 */

export const PROJECT_MEMORY_FILES = ['AI_CONTEXT.md', 'AGENTS.md'] as const
export const MEMORY_CHAR_BUDGET = 12_000
/** Conservative default context budget (~4 chars per token). */
export const DEFAULT_CONTEXT_TOKEN_BUDGET = 32_000

/**
 * Fraction of the budget at which the composer shows its subtle "getting full"
 * hint (v2.6.2 T5.1). Below this the UI stays quiet; at or above it the user is
 * nudged to compact before the context window actually overflows.
 */
export const CONTEXT_NEAR_LIMIT_RATIO = 0.8

export interface MemorySource {
  file: string
  content: string
}

/**
 * Render project memory into a system-prompt block, truncating to `budget`
 * characters so a huge AGENTS.md can never crowd out the actual task. Returns
 * `undefined` when there is nothing to add.
 */
export function renderProjectMemory(
  sources: MemorySource[],
  budget = MEMORY_CHAR_BUDGET
): string | undefined {
  const usable = sources.filter((source) => source.content.trim().length > 0)
  if (usable.length === 0) return undefined

  const parts: string[] = []
  let used = 0
  let truncated = false

  for (const source of usable) {
    const header = `## ${source.file}`
    const body = source.content.trim()
    const room = budget - used - header.length - 1
    if (room <= 0) {
      truncated = true
      break
    }
    if (body.length > room) {
      parts.push(`${header}\n${body.slice(0, room)}\n…(truncated)`)
      truncated = true
      break
    }
    parts.push(`${header}\n${body}`)
    used += header.length + body.length + 1
  }

  if (parts.length === 0) return undefined
  const note = truncated ? '\n\n(Project memory was truncated to fit the context budget.)' : ''
  return (
    '# Project memory\n' +
    'These notes live in the project folder; follow them while working here.\n\n' +
    parts.join('\n\n') +
    note
  )
}

/** Rough token estimate (~4 chars/token) shared by the composer and warnings. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.trim().length / 4)
}

/**
 * Total tokens for the conversation plus the pending draft, and a warning when
 * it crosses the budget. `ratio` is the fraction of the budget in use and
 * `nearLimit` is true once it reaches {@link CONTEXT_NEAR_LIMIT_RATIO}, which
 * drives the composer's subtle hint.
 */
export function contextBudget(
  messages: Array<{ content: string }>,
  draft = '',
  budget = DEFAULT_CONTEXT_TOKEN_BUDGET
): { tokens: number; ratio: number; nearLimit: boolean; overBudget: boolean } {
  const tokens =
    messages.reduce((sum, message) => sum + estimateTokens(message.content), 0) +
    (draft ? estimateTokens(draft) : 0)
  const ratio = budget > 0 ? tokens / budget : 0
  return { tokens, ratio, nearLimit: ratio >= CONTEXT_NEAR_LIMIT_RATIO, overBudget: tokens >= budget }
}

/**
 * v2.6.4 Fix E: the composer's "context is filling up" nudge is opt-in. It is
 * only useful for older, small-context models, so it stays hidden by default
 * and appears solely when the user has enabled it *and* the budget is nearly
 * full.
 */
export function contextWarningVisible(enabled: boolean, nearLimit: boolean): boolean {
  return enabled && nearLimit
}
