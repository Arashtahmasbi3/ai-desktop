/**
 * Success-claim verification (v2.4, A.3).
 *
 * The model must not say "done / completed / fixed" on a hunch: a success claim is
 * only allowed when a verification-shaped tool call (test / health / verify / build)
 * succeeded within the last {@link VERIFICATION_WINDOW_MS}. `verifySuccess` is pure,
 * so the orchestrator can call it before surfacing a final message and the UI can
 * offer "Run tests / Run health check / Accept anyway".
 */

export const VERIFICATION_WINDOW_MS = 30_000

/** Words that assert the task is finished. English + Persian, per the source doc. */
export const SUCCESS_MARKERS: readonly string[] = [
  'completed',
  'done',
  'successfully',
  'fixed',
  'resolved',
  'deployed',
  'تمام شد',
  'انجام شد',
  'حل شد',
  'موفق'
]

export interface ToolCallRecord {
  toolName: string
  /** The shell command, when the tool ran one (used to spot test/build runs). */
  command?: string
  exitCode?: number
  timestamp: number
}

export interface SuccessVerification {
  allowed: boolean
  reason?: string
}

/** True when a tool name (or the command it ran) looks like a verification step. */
export function isVerificationTool(toolName: string, command?: string): boolean {
  return /test|health|verify|build/i.test(`${toolName} ${command ?? ''}`)
}

/** True when the response text asserts success. */
export function claimsSuccess(aiResponse: string): boolean {
  const lower = aiResponse.toLowerCase()
  return SUCCESS_MARKERS.some((marker) => lower.includes(marker.toLowerCase()))
}

export function verifySuccess(
  aiResponse: string,
  recentToolCalls: readonly ToolCallRecord[],
  now: number = Date.now(),
  windowMs: number = VERIFICATION_WINDOW_MS
): SuccessVerification {
  if (!claimsSuccess(aiResponse)) return { allowed: true }

  const recent = recentToolCalls.filter((call) => now - call.timestamp < windowMs)
  const verified = recent.some(
    (call) => call.exitCode === 0 && isVerificationTool(call.toolName, call.command)
  )

  if (!verified) {
    return {
      allowed: false,
      reason:
        'No recent verification (test/health/build). Run a verification command before claiming success.'
    }
  }
  return { allowed: true }
}
