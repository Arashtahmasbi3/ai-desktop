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

/** Whether a shell command is a read that should never need approval. */
export function isReadOnlyCommand(command: string): boolean {
  return commandIntent(command) === 'read'
}

/** Commands that are safe to run without approval on every host mode (A.3). */
export const DEFAULT_READ_ONLY_COMMANDS: string[] = [
  'ls',
  'cat',
  'head',
  'tail',
  'grep',
  'find',
  'pwd',
  'git status',
  'git log',
  'git diff',
  'git branch',
  'docker ps',
  'docker images',
  'docker logs',
  'systemctl status',
  'systemctl is-active',
  'ps',
  'top',
  'htop',
  'free',
  'df',
  'du',
  'whoami',
  'id',
  'uname',
  'date',
  'node --version',
  'npm --version',
  'python --version',
  'echo',
  'which',
  'file',
  'wc'
]

/** Commands that mutate the host and therefore need approval on staging. */
export const DEFAULT_WRITE_COMMANDS: string[] = [
  'git pull',
  'git fetch',
  'git checkout',
  'git merge',
  'npm install',
  'npm run build',
  'npm test',
  'docker compose up',
  'docker compose down',
  'docker compose restart',
  'pm2 restart',
  'pm2 reload',
  'systemctl restart',
  'systemctl reload'
]

/** Commands that are always refused, regardless of mode. */
export const DEFAULT_DENY_COMMANDS: string[] = [
  'rm -rf /',
  'mkfs',
  'dd if=',
  'shutdown',
  'reboot',
  'halt',
  'sudo',
  'su',
  'chmod -R 777',
  'chown -R',
  'git push --force',
  'git reset --hard',
  'docker rm -f',
  'docker system prune -a',
  'kill -9',
  '> /dev/sda',
  '> /dev/sdb'
]

/** Extra commands refused on production hosts (service-affecting mutations). */
const PRODUCTION_EXTRA_DENY: string[] = [
  'git push',
  'docker run',
  'docker compose up',
  'docker compose down',
  'docker compose restart',
  'pm2 restart',
  'pm2 reload',
  'systemctl restart',
  'systemctl reload'
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
  /** Which rule produced this decision (v2.3.2, A.3). */
  category?: 'deny' | 'path' | 'read-only' | 'write' | 'unknown' | 'allow' | 'mode'
}

/** `entry` matches `command` at a word boundary (avoids `ls` matching `lsblk`). */
function matchesPrefixList(list: string[] | undefined, command: string): boolean {
  if (!list || list.length === 0) return false
  const normalized = command.trim().toLowerCase()
  return list.some((entry) => {
    if (!entry) return false
    const needle = entry.toLowerCase()
    return normalized === needle || normalized.startsWith(`${needle} `)
  })
}

/** Whether the policy carries the v2.3.2 A.3 read/write command lists. */
function hasContextLists(policy: HostPolicy): boolean {
  return (policy.readOnlyCommands?.length ?? 0) > 0 || (policy.writeCommands?.length ?? 0) > 0
}

/**
 * Evaluate a command against a host policy. Precedence:
 *   denyCommands → allowedPaths → read-only allow → read-only/production mode
 *   gate → explicit allowlist → write/unknown.
 *
 * A policy carrying `readOnlyCommands` / `writeCommands` (A.3) is
 * context-aware: read-only commands never need approval, writes need approval
 * on staging and are refused on production, and anything unrecognised
 * fail-closes. A legacy policy (no such lists) keeps the pre-A.3 behaviour.
 */
export function evaluateHostPolicy(policy: HostPolicy, command: string): PolicyDecision {
  const intent = commandIntent(command)
  const base = { requiresApproval: false, intent }

  if (matchesList(policy.denyCommands, command)) {
    return {
      ...base,
      allowed: false,
      category: 'deny',
      reason: 'Blocked by this host policy (deny rule).'
    }
  }

  if (policy.allowedPaths && policy.allowedPaths.length > 0) {
    for (const path of referencedPaths(command)) {
      if (!policy.allowedPaths.some((allowed) => path === allowed || path.startsWith(`${allowed}/`))) {
        return {
          ...base,
          allowed: false,
          category: 'path',
          reason: `Path ${path} is outside the allowed paths.`
        }
      }
    }
  }

  const contextAware = hasContextLists(policy)
  const readAllowed =
    matchesPrefixList(policy.readOnlyCommands, command) ||
    (!contextAware && intent === 'read')

  if (readAllowed) {
    const needsApproval = policy.requireApproval === 'always'
    return {
      ...base,
      allowed: true,
      category: 'read-only',
      requiresApproval: needsApproval,
      ...(needsApproval
        ? { reason: 'This host requires approval for every command.' }
        : {})
    }
  }

  if (policy.mode === 'read-only') {
    return {
      ...base,
      allowed: false,
      category: 'mode',
      reason: 'read-only hosts are read-only: mutations are blocked.'
    }
  }

  // Legacy explicit allowlist bypasses approval (but never a deny/path block).
  if (matchesList(policy.allowCommands, command)) {
    return { ...base, allowed: true, category: 'allow', requiresApproval: false }
  }

  const isWrite = matchesPrefixList(policy.writeCommands, command)
  const category: PolicyDecision['category'] = isWrite ? 'write' : 'unknown'

  if (policy.mode === 'production') {
    if (isWrite) {
      return {
        ...base,
        allowed: true,
        category,
        requiresApproval: true,
        reason: 'Production hosts require approval for write commands.'
      }
    }
    return {
      ...base,
      allowed: false,
      category,
      reason: 'production hosts are read-only: mutations are blocked.'
    }
  }

  const requiresApproval = policy.requireApproval !== 'never'
  return {
    ...base,
    allowed: true,
    category,
    requiresApproval,
    ...(requiresApproval
      ? {
          reason: isWrite
            ? 'This host requires approval for write commands.'
            : 'Unrecognised command; approval required.'
        }
      : {})
  }
}

/** Sensible starting policy per host mode (aligned with the v2.3.2 defaults). */
export function defaultHostPolicy(vpsId: string, mode: HostPolicyMode): HostPolicy {
  const base = {
    vpsId,
    allowCommands: [] as string[],
    allowedPaths: [] as string[],
    readOnlyCommands: [...DEFAULT_READ_ONLY_COMMANDS],
    writeCommands: [...DEFAULT_WRITE_COMMANDS]
  }
  switch (mode) {
    case 'production':
      return {
        ...base,
        mode,
        requireApproval: 'never',
        denyCommands: [...DEFAULT_DENY_COMMANDS, ...PRODUCTION_EXTRA_DENY]
      }
    case 'staging':
      return {
        ...base,
        mode,
        requireApproval: 'destructive',
        allowCommands: ['deploy'],
        denyCommands: [...DEFAULT_DENY_COMMANDS]
      }
    case 'read-only':
    default:
      return {
        ...base,
        mode,
        requireApproval: 'never',
        denyCommands: [...DEFAULT_DENY_COMMANDS]
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
    allowedPaths: stringList(raw.allowedPaths),
    readOnlyCommands: stringList(raw.readOnlyCommands),
    writeCommands: stringList(raw.writeCommands)
  }
}
