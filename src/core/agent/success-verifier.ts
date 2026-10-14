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

/**
 * Commands that genuinely verify something (v2.6.5).
 *
 * The old check was `/test|health|verify|build/i` against `toolName + command`,
 * so `run_command("test -d node_modules")` - a plain existence probe - unlocked a
 * "done" claim. Only a recognised runner or an explicit health/verify probe counts
 * now.
 */
const VERIFICATION_COMMAND =
  /(^|[\s;&|])(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|build|lint|typecheck|check|verify|healthcheck|health-check)\b|(?:npx\s+)?(?:vitest|jest|mocha|ava|pytest|tox|tsc|eslint)\b|go\s+(?:test|build|vet)\b|cargo\s+(?:test|build|check)\b|make\s+(?:test|check|build|verify)\b|(?:gradle|mvn|dotnet)\b[^\n]*(?:test|check|verify|build)\b|systemctl\s+(?:is-active|status)\b|curl\b[^\n]*\/health\b)/i

/** Tools whose *name* is itself a verification step. */
const VERIFICATION_TOOL_NAME = /^(?:run_)?(?:tests?|verify(?:_|$)|health(?:_|$)|build(?:_|$))/i

/** True when a tool call looks like a real verification step. */
export function isVerificationTool(toolName: string, command?: string): boolean {
  if (VERIFICATION_TOOL_NAME.test(toolName)) return true
  if (!command) return false
  return VERIFICATION_COMMAND.test(command)
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
