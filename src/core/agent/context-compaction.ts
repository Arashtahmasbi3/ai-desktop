/**
 * Compaction as a best-effort side effect (F0-4 extraction).
 *
 * A failed compaction is logged and swallowed: it is an optimization, and a run must
 * never die because the summarizer did.
 */
import type { ContextManager, ContextSummarizer } from './context-manager'
import type { OrchestratorLog } from './orchestrator-log'

/** Compact the context when it crosses the token threshold (best-effort). */
export async function maybeCompact(
  log: OrchestratorLog,
  context: ContextManager,
  summarizer: ContextSummarizer,
  runId: string,
  step: number
): Promise<void> {
  if (!context.needsCompaction()) return
  const tokensBefore = context.estimateTokens()
  try {
    const result = await context.compact(summarizer)
    if (!result) return
    log('info', 'context.compacted', runId, {
      step,
      droppedMessages: result.droppedMessages,
      tokensBefore: result.tokensBefore,
      tokensAfter: result.tokensAfter
    })
  } catch (error) {
    // Compaction is an optimization: never fail a run because it failed.
    log('warn', 'context.compaction_failed', runId, {
      step,
      tokensBefore,
      message: error instanceof Error ? error.message : String(error)
    })
  }
}
