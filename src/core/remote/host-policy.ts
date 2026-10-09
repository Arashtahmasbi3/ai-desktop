/**
 * Per-host command policy shared by the SSH manager, the agent and Settings.
 *
 * A policy is intentionally text-based and fail-closed: an unknown command is
 * treated as a mutation, so a read-only host refuses anything it cannot prove
 * is safe. The engine is dependency-free so it can run in the main process,
 * the renderer and tests.
 */
import type { HostApprovalRequirement, HostPolicy, HostPolicyMode } from '@shared/vps'

export type CommandIntent = 'read' | 'write' | 'destructive'

const DESTRUCTIVE = [
  /\brm\b/i,
  /\bdd\b/i,
  /\bmkfs(\.\w+)?\b/i,
  /\bwipefs\b/i,
  /\bshred\b/i,
  /\btruncate\b/i,
  /\bmv\s+\/\*/i,
  />\s*\/dev\/(sd|nvme|hd)/i,
  /\bsystemctl\s+(stop|disable|mask)\b/i,
  /\bdocker\s+(rm|rmi|system\s+prune)\b/i,
  /\bkubectl\s+delete\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\b(drop|truncate)\s+(table|database)\b/i,
  /\buserdel\b/i,
  /\bkill\s+-9\b/i,
  /:\s*\(\s*\)\s*\{/i
]

const WRITE = [
  /\bsudo\b/i,
  /\b(mkdir|rmdir|touch|ln)\b/i,
  /\b(cp|install)\b/i,
  /\bsed\s+-i\b/i,
  /\btee\b/i,
  /(^|[^<])>(?!>)/,
  />>/,
  /\b(curl|wget)\b[^\n]*\s-[A-Za-z]*o\b/i,
  /\b(git\s+(push|commit|merge|pull|checkout|tag))\b/i,
  /\b(npm|pnpm|yarn|pip|poetry|cargo|go|gem)\s+(install|add|publish|remove|update)\b/i,
  /\b(apt|apt-get|dnf|yum|apk|pacman)\b/i,
  /\b(docker|podman)\s+(run|build|up|exec|create|start|restart|stop)\b/i,
  /\bkubectl\s+(apply|create|replace|patch|scale|rollout)\b/i,
  /\bsystemctl\s+(start|restart|enable|reload)\b/i,
  /\b(deploy|release|publish|provision|migrate)\b/i,
  /\bmake\b/i,
  /\bchmod\b/i,
  /\bchown\b/i
]

const READ = [
  /^\s*(ls|cat|grep|egrep|rg|find|head|tail|wc|pwd|whoami|id|hostname|date|uptime|env|printenv)\b/i,
  /^\s*(ps|top|df|du|free|uname|file|stat|which|type|echo|printf|less|more|nl|awk|sed\s+-n)\b/i,
  /\bgit\s+(status|log|diff|show|branch|remote|describe|rev-parse)\b/i,
  /^\s*(docker|podman)\s+(ps|images|logs|inspect|version|info)\b/i,
  /\bkubectl\s+(get|describe|logs|version)\b/i
]

/** Classify what a shell command is likely to do. Unknown ⇒ `write` (fail-closed). */
export function commandIntent(command: string): CommandIntent {
  const normalized = command.trim()
  if (!normalized) return 'read'
  if (DESTRUCTIVE.some((pattern) => pattern.test(normalized))) return 'destructive'
  if (WRITE.some((pattern) => pattern.test(normalized))) return 'write'
  if (READ.some((pattern) => pattern.test(normalized))) return 'read'
  return 'write'
}

/** Absolute-path tokens referenced by a command. */
export function referencedPaths(command: string): string[] {
  const matches = command.match(/(?:^|\s)(\/[^\s;&|<>"']*)/g) ?? []
  return matches.map((match) => match.trim()).filter((path) => path.length > 1)
}

function matchesList(list: string[] | undefined, command: string): boolean {
  if (!list || list.length === 0) return false
  const lower = command.toLowerCase()
  return list.some((entry) => entry && lower.includes(entry.toLowerCase()))
}

export interface PolicyDecision {
  allowed: boolean
  requiresApproval: boolean
  intent: CommandIntent
  reason?: string
}

/**
 * Evaluate a command against a host policy. Precedence:
 *   denyCommands → read-only mode → allowedPaths → explicit allowlist → approval.
 */
export function evaluateHostPolicy(policy: HostPolicy, command: string): PolicyDecision {
  const intent = commandIntent(command)
  const base = { requiresApproval: false, intent }

  if (matchesList(policy.denyCommands, command)) {
    return { ...base, allowed: false, reason: 'Blocked by this host policy (deny rule).' }
  }

  const readOnly = policy.mode === 'read-only' || policy.mode === 'production'
  if (readOnly && intent !== 'read') {
    return {
      ...base,
      allowed: false,
      reason: `${policy.mode} hosts are read-only: ${intent} commands are blocked.`
    }
  }

  if (policy.allowedPaths && policy.allowedPaths.length > 0) {
    for (const path of referencedPaths(command)) {
      if (!policy.allowedPaths.some((allowed) => path === allowed || path.startsWith(`${allowed}/`))) {
        return { ...base, allowed: false, reason: `Path ${path} is outside the allowed paths.` }
      }
    }
  }

  const explicitlyAllowed = matchesList(policy.allowCommands, command)
  if (explicitlyAllowed) return { ...base, allowed: true, requiresApproval: false }

  if (policy.requireApproval === 'always') {
    return { ...base, allowed: true, requiresApproval: true, reason: 'This host requires approval for every command.' }
  }
  if (policy.requireApproval === 'destructive' && intent !== 'read') {
    return {
      ...base,
      allowed: true,
      requiresApproval: true,
      reason: 'This host requires approval for writes and destructive commands.'
    }
  }

  return { ...base, allowed: true }
}

/** Sensible starting policy per host mode (aligned with the sprint defaults). */
export function defaultHostPolicy(vpsId: string, mode: HostPolicyMode): HostPolicy {
  switch (mode) {
    case 'production':
      return {
        vpsId,
        mode,
        requireApproval: 'never',
        allowCommands: [],
        denyCommands: [],
        allowedPaths: []
      }
    case 'staging':
      return {
        vpsId,
        mode,
        requireApproval: 'destructive',
        allowCommands: ['deploy'],
        denyCommands: ['rm -rf', 'mkfs', 'dd if=', 'shutdown', 'reboot'],
        allowedPaths: []
      }
    case 'read-only':
    default:
      return {
        vpsId,
        mode,
        requireApproval: 'never',
        allowCommands: [],
        denyCommands: [],
        allowedPaths: []
      }
  }
}

const MODES: HostPolicyMode[] = ['read-only', 'staging', 'production']
const APPROVALS: HostApprovalRequirement[] = ['never', 'always', 'destructive']

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/** Parse an untrusted persisted policy, returning undefined when malformed. */
export function coerceHostPolicy(value: unknown, vpsId: string): HostPolicy | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const mode = MODES.includes(raw.mode as HostPolicyMode) ? (raw.mode as HostPolicyMode) : undefined
  if (!mode) return undefined
  const requireApproval = APPROVALS.includes(raw.requireApproval as HostApprovalRequirement)
    ? (raw.requireApproval as HostApprovalRequirement)
    : 'destructive'
  return {
    vpsId,
    mode,
    requireApproval,
    allowCommands: stringList(raw.allowCommands),
    denyCommands: stringList(raw.denyCommands),
    allowedPaths: stringList(raw.allowedPaths)
  }
}
