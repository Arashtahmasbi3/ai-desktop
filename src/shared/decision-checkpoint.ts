/**
 * Decision checkpoints (v3.1).
 *
 * `trace-decision.ts` already derives what the agent did and why, per step. This adds the two
 * things a decision *log* cannot: a judgement about **how much a decision matters**, and a mode
 * that can pause **before** the action rather than explaining it afterwards.
 *
 * Classification is deterministic and rule-based — no model call — because a checkpoint that is
 * itself a black box would defeat the point, and because a pause must not cost a round trip before
 * the user is even asked.
 *
 * The three levels are deliberately about **reversibility**, not about how scary a command sounds:
 *
 *  - `routine` — reading, listing, searching. Nothing changes.
 *  - `consequential` — something changes, but it can be changed back: writing a file inside the
 *    project, installing a package, restarting a service, deploying to staging.
 *  - `irreversible` — the old state cannot be recovered from the machine we are on: a recursive
 *    delete, a format, a force-push, a database drop, writing **outside** the project, touching
 *    credentials, or acting on a host marked production.
 */

export type DecisionImpact = 'routine' | 'consequential' | 'irreversible'

/**
 * `off` — do nothing. `record` — keep a durable, reviewable record. `confirm` — record, and stop
 * before an action that is not routine.
 */
export type CheckpointMode = 'off' | 'record' | 'confirm'

export interface DecisionCheckpoint {
  id: string
  runId: string
  projectId?: string
  /** The agent's own stated intent, short. */
  intent: string
  /** The action it is about to take, as a one-line summary. */
  action: string
  impact: DecisionImpact
  /** Why it was classified that way — shown to the user, so the rule is auditable. */
  reason: string
  /** Evidence digests only. Never raw tool output, which can hold a secret. */
  evidence?: string[]
  at: number
  /** Present once a `confirm` checkpoint has been answered. */
  resolved?: {
    decision: 'approved' | 'rejected' | 'timeout'
    at: number
    note?: string
  }
}

export interface ClassifyInput {
  tool: string
  args?: Record<string, unknown>
  /** True when the host is marked production; supplied by the caller, which knows the policy. */
  productionHost?: boolean
  /** The project root, so a write outside it can be spotted. */
  projectRoot?: string
}

export interface ImpactVerdict {
  impact: DecisionImpact
  reason: string
}

/** Tools that only read. Kept here rather than imported so the judgement is self-contained. */
const READ_TOOLS: ReadonlySet<string> = new Set([
  'read_file',
  'list_dir',
  'remote_read_file',
  'remote_list_dir',
  'remote_exists',
  'remote_grep',
  'remote_git_status',
  'list_servers',
  'get_system_health',
  'search_code',
  'grep',
  'glob'
])

/** Commands whose effect cannot be undone from this machine. */
const IRREVERSIBLE_COMMAND = [
  /\brm\s+(-[a-z]*[rf][a-z]*\s+)+/i,
  /\bmkfs(\.|\s)/i,
  /\bdd\s+if=/i,
  /\b(shred|wipefs)\b/i,
  /\bgit\s+push\b[^\n]*--force(?!-with-lease)/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[a-z]*[fd]/i,
  /\bdrop\s+(table|database|schema)\b/i,
  /\btruncate\s+table\b/i,
  /\bmongo(sh)?\b[^\n]*dropDatabase/i,
  /\bpm2\s+delete\b/i,
  /\bsystemctl\s+(stop|disable)\b/i,
  /\bkill(all)?\s+-9\b/i,
  /\bchmod\s+-R\s+777\b/i
]

/** Commands that change state, but changeably. */
const CONSEQUENTIAL_COMMAND = [
  /\b(apt|apt-get|yum|dnf|apk|brew)\s+(install|remove|purge|upgrade)\b/i,
  /\bnpm\s+(install|i|ci|uninstall|update)\b/i,
  /\b(pnpm|yarn)\s+(add|install|remove|upgrade)\b/i,
  /\bpip3?\s+install\b/i,
  /\b(systemctl|service)\s+(start|restart|reload|enable)\b/i,
  /\bpm2\s+(restart|reload|start|stop)\b/i,
  /\bdocker\s+(run|rm|rmi|stop|restart|compose\s+(up|down))\b/i,
  /\b(rsync|scp|sftp)\b/i,
  /\bgit\s+(push|commit|merge|rebase|checkout|branch\s+-D)\b/i,
  /\bmv\s|\bcp\s|\b>\s*\S|\btee\b/i,
  /\b(migrate|deploy|provision)\b/i
]

/** Things that are secrets or that grant access. Always treated as irreversible. */
const CREDENTIAL_PATTERNS = [
  /\.env(\.|$|\s|")/i,
  /(^|[\/\\])\.ssh([\/\\]|$)/i,
  /id_(rsa|ed25519|ecdsa)/i,
  /(\.pem|\.key|known_hosts|authorized_keys|credentials|\.netrc|\.npmrc|\.pypirc)\b/i,
  /(secret|password|passwd|api[_-]?key|token)/i
]

function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

/** The one-line action summary a checkpoint shows. */
export function describeAction(tool: string, args: Record<string, unknown> = {}): string {
  const command = asText(args.command ?? args.cmd ?? args.script)
  if (command) return command.replace(/\s+/g, ' ').trim().slice(0, 200)
  const path = asText(args.path ?? args.file ?? args.target ?? args.destination)
  if (path) return `${tool} ${path}`.slice(0, 200)
  return tool
}

/**
 * Judge how much an action matters.
 *
 * Order is deliberate: **credentials and production hosts outrank everything**, then the
 * irreversible patterns, then "writes outside the project", then ordinary writes. A rule that
 * cannot prove an action is harmless never calls it routine.
 */
export function classifyImpact(input: ClassifyInput): ImpactVerdict {
  const tool = String(input.tool ?? '').trim()
  const args = input.args ?? {}
  const haystack = `${tool} ${asText(args)}`

  for (const pattern of CREDENTIAL_PATTERNS) {
    if (pattern.test(haystack)) {
      return {
        impact: 'irreversible',
        reason: 'it touches a credential or a secret file, where a mistake cannot be undone'
      }
    }
  }

  if (input.productionHost) {
    const changes = CONSEQUENTIAL_COMMAND.some((pattern) => pattern.test(haystack))
    const destroys = IRREVERSIBLE_COMMAND.some((pattern) => pattern.test(haystack))
    if (destroys) {
      return { impact: 'irreversible', reason: 'it runs a destructive command on a production host' }
    }
    if (changes) {
      return { impact: 'consequential', reason: 'it changes state on a production host' }
    }
  }

  for (const pattern of IRREVERSIBLE_COMMAND) {
    if (pattern.test(haystack)) {
      return { impact: 'irreversible', reason: 'the command destroys state that cannot be recovered' }
    }
  }

  // A write that leaves the project is a different proposition from one that stays in it.
  const writesOutsideProject =
    input.projectRoot !== undefined &&
    /(^|[\/\\])\.\.([\/\\]|$)/.test(asText(args.path ?? args.file ?? args.destination))
  if (writesOutsideProject) {
    return { impact: 'irreversible', reason: 'it writes outside the project' }
  }

  if (READ_TOOLS.has(tool)) {
    return { impact: 'routine', reason: 'it only reads' }
  }

  for (const pattern of CONSEQUENTIAL_COMMAND) {
    if (pattern.test(haystack)) {
      return { impact: 'consequential', reason: 'it changes state, but the change can be reverted' }
    }
  }

  if (/^(write_file|remote_write_file|apply_change|edit)/.test(tool)) {
    return { impact: 'consequential', reason: 'it writes a file inside the project' }
  }

  /**
   * Unknown is not "harmless". A tool nobody classified could be anything, so it is treated as a
   * change and therefore worth recording (and, in `confirm` mode, worth asking about).
   */
  return { impact: 'consequential', reason: 'the effect of this action is not obvious' }
}

/** Whether a mode should pause before an action of this impact. */
export function needsCheckpoint(mode: CheckpointMode, impact: DecisionImpact): boolean {
  if (mode === 'off' || mode === 'record') return false
  return impact !== 'routine'
}

/** Whether a mode keeps a record at all. */
export function recordsCheckpoints(mode: CheckpointMode): boolean {
  return mode !== 'off'
}

export function normalizeCheckpointMode(raw: unknown): CheckpointMode {
  /*
   * The fallback is the feature's **default**, not its most useful setting: a value we cannot read
   * must never enable recording behind the user's back, and it must not start blocking work either.
   * "Off" is the only answer that is safe in both directions.
   */
  return raw === 'off' || raw === 'confirm' || raw === 'record' ? raw : 'off'
}

/** The sentence a confirm dialog leads with. Names the judgement, so the rule stays auditable. */
export function describeImpact(verdict: ImpactVerdict): string {
  return verdict.impact === 'irreversible'
    ? `This cannot be undone: ${verdict.reason}.`
    : `This changes state: ${verdict.reason}.`
}
