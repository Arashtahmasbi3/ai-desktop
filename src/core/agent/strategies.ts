/**
 * Alternative strategies for common failures (v2.5.7, Task 4.2).
 *
 * When a tool call fails for a recognisable reason (a command is missing, a
 * path is denied, a path is outside the project), the agent should change
 * approach instead of retrying the same call. This module maps those failures to
 * a concrete, safe alternative. Pure and dependency-free so the loop detector,
 * the planner and the UI can all share it.
 */

export interface StrategyAlternative {
  toolName: string
  args: Record<string, unknown>
  reason: string
}

export interface AlternativeStrategy {
  /** Tool the original call used. */
  originalTool: string
  /** RegExp matched against the named argument (missing ⇒ any). */
  argPatterns: Record<string, RegExp>
  /** Whether the error text triggers this strategy. */
  condition: (error: string) => boolean
  alternatives: StrategyAlternative[]
}

const NOT_FOUND = /not found|command not found|no such file|not recognized|is not recognized/i
const PERMISSION = /permission denied|access denied|operation not permitted|eacces/i
const BLOCKED = /blocked|outside project root|not allowed|refused by policy/i

/** Ordered rules; the first whose tool + args + condition all match wins. */
export const ALTERNATIVE_STRATEGIES: AlternativeStrategy[] = [
  {
    originalTool: 'remote_shell',
    argPatterns: { command: /\bpm2\b/i },
    condition: (error) => NOT_FOUND.test(error),
    alternatives: [
      {
        toolName: 'remote_shell',
        args: { command: 'systemctl --failed --no-pager' },
        reason: 'Try systemd instead of PM2'
      },
      {
        toolName: 'remote_shell',
        args: { command: 'docker ps -a' },
        reason: 'Try Docker instead of PM2'
      }
    ]
  },
  {
    originalTool: 'remote_read_file',
    argPatterns: { path: /\/var\/log/i },
    condition: (error) => PERMISSION.test(error),
    alternatives: [
      {
        toolName: 'remote_shell',
        args: { command: 'journalctl -n 50 --no-pager' },
        reason: 'Use journalctl instead of reading /var/log directly'
      },
      {
        toolName: 'remote_shell',
        args: { command: 'dmesg | tail -50' },
        reason: 'Use dmesg for kernel/service errors'
      }
    ]
  },
  {
    originalTool: 'remote_shell',
    argPatterns: { command: /\/etc\/os-release/i },
    condition: (error) => BLOCKED.test(error),
    alternatives: [
      {
        toolName: 'remote_shell',
        args: { command: 'uname -a' },
        reason: 'Use uname (whitelisted) instead of /etc/os-release'
      },
      {
        toolName: 'remote_shell',
        args: { command: 'cat /proc/version' },
        reason: 'Try /proc/version within Diagnostic Mode'
      }
    ]
  },
  {
    originalTool: 'remote_read_file',
    argPatterns: { path: /\/etc\/os-release/i },
    condition: (error) => BLOCKED.test(error) || PERMISSION.test(error),
    alternatives: [
      {
        toolName: 'remote_shell',
        args: { command: 'uname -a' },
        reason: 'Use uname (whitelisted) instead of /etc/os-release'
      }
    ]
  }
]

function matchesArgs(strategy: AlternativeStrategy, args: Record<string, unknown>): boolean {
  return Object.entries(strategy.argPatterns).every(([key, pattern]) => {
    const value = args[key]
    return typeof value === 'string' && pattern.test(value)
  })
}

/** Every alternative for a failing call, in order, or an empty list. */
export function findAlternativeStrategies(
  toolName: string,
  args: Record<string, unknown>,
  error: unknown
): StrategyAlternative[] {
  const message = typeof error === 'string' ? error : error instanceof Error ? error.message : String(error ?? '')
  for (const strategy of ALTERNATIVE_STRATEGIES) {
    if (strategy.originalTool !== toolName) continue
    if (!matchesArgs(strategy, args)) continue
    if (!strategy.condition(message)) continue
    return strategy.alternatives
  }
  return []
}

/** The single best alternative for a failing call, or `null`. */
export function findAlternatives(
  toolName: string,
  args: Record<string, unknown>,
  error: unknown
): StrategyAlternative | null {
  return findAlternativeStrategies(toolName, args, error)[0] ?? null
}
