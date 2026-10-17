import type {
  ApprovalMode,
  ApprovalOutcome,
  ApprovalReason,
  ApprovalRememberScope
} from '@shared/approval'
import type { AgentAction } from '@shared/agent'
import { classifyAction, isDenyListedAction, requiresApproval } from '@core/agent/approval'
import { type CheckpointMode, type ImpactVerdict } from '@shared/decision-checkpoint'
import type { ApprovedCommands } from '@core/agent/approved-commands'
import { canRememberTool, createRememberedApproval } from '@core/agent/remember-policy'
import { isCommandAlwaysAllowed, isReadOnlyShellCommand } from '@core/remote/command-whitelist'
import { detectNetworkAction } from '@core/remote/network-action'
import { classifyShellCommand } from '@core/agent/approval'
import { READ_ONLY_TOOL_NAMES } from '@shared/profile'

export interface ApprovalGateOptions {
  mode: ApprovalMode
  /** Learned approvals that suppress future prompts. */
  approvedCommands?: ApprovedCommands
  /** Session id used for session-scoped learned approvals. */
  sessionId?: string
  /**
   * Scope remembered approvals to this VPS + project (v2.5, P0-3). When both are
   * set, a remember choice stores a scoped approval with a 30-minute TTL instead
   * of a permanent global one; a match on VPS *and* project is then required.
   */
  vpsId?: string
  projectId?: string
  /** Ask the user to approve a tool call. */
  requestApproval: (action: AgentAction, reason?: ApprovalReason) => Promise<ApprovalOutcome>
  /**
   * Reason shown in the dialog. Defaults to {@link shouldRequireApproval}'s
   * classification; callers may override it (e.g. `outside_plan`).
   */
  reasonFor?: (action: AgentAction) => ApprovalReason
  /** Persist a remember choice. Defaults to writing to `approvedCommands`. */
  recordRemember?: (action: AgentAction, scope: ApprovalRememberScope) => Promise<void>
  /** How many approvals of the same tool before suggesting a permanent one. */
  suggestionAt?: number
  /** Notified when the same tool crosses the suggestion threshold. */
  onSuggestion?: (tool: string, count: number) => void
  /** v3.1: judge and record consequential actions, and optionally pause for them. */
  checkpoint?: ApprovalCheckpoint
}

const DEFAULT_SUGGESTION_AT = 3

/** Remote read-only tools that never need an explicit approval (v2.5.5). */
/**
 * v2.8.1: derived from the canonical read-only set (minus the local sandbox reads, which
 * never reach this gate as remote). Re-declaring the list here is how the four named
 * diagnostics ended up prompting in `auto-write` mode despite being read-only.
 */
const READ_ONLY_REMOTE_TOOLS = new Set(
  [...READ_ONLY_TOOL_NAMES].filter((name) => name !== 'read_file' && name !== 'list_dir')
)

/**
 * v3.1: decision checkpoints.
 *
 * \`classify\` judges how much an action matters and \`record\` appends it to the durable log. In
 * \`confirm\` mode an **irreversible** action is put to the user even when it would otherwise have
 * been auto-approved or remembered: "you told me this tool is fine" is not the same statement as
 * "go ahead and delete it", and that gap is the entire point of a checkpoint.
 */
export interface ApprovalCheckpoint {
  mode: CheckpointMode
  classify: (action: { name: string; arguments: Record<string, unknown> }) => ImpactVerdict
  /** Build and persist a record. Returns the id so the resolution can be attached to it. */
  record: (input: {
    action: { name: string; arguments: Record<string, unknown> }
    verdict: ImpactVerdict
    intent?: string
  }) => Promise<string | undefined>
  /** Called after the user answered, so the log says how it ended rather than only what was asked. */
  resolve?: (id: string, decision: 'approved' | 'rejected' | 'timeout') => Promise<void>
}

export interface ApprovalRequirement {
  required: boolean
  reason: ApprovalReason
}

/**
 * Whether an action still needs explicit approval after the read-only
 * whitelist is consulted (v2.5.5). This only relaxes the *prompt*: the remote
 * executors still apply P0-2 path containment and the deny list, so a
 * whitelisted or read-only command that reaches outside the project is blocked
 * there, never silently run.
 *
 * - `remote_shell` with an always-allowed / read-only command → no approval
 * - the remote read-only tools (`remote_read_file`, ...) → no approval
 * - write tools, dangerous commands and everything else → approval
 */
export function shouldRequireApproval(action: {
  name: string
  arguments: Record<string, unknown>
}): ApprovalRequirement {
  if (isDenyListedAction(action)) return { required: true, reason: 'dangerous' }

  if (action.name === 'remote_shell') {
    const command = action.arguments.command
    if (typeof command === 'string') {
      /*
       * v4.1: a network action is asked about in its own words, before any read-only shortcut. A port scan is
       * not "read-only" in the sense the user cares about: it touches machines that are not this project.
       */
      if (detectNetworkAction(command) !== undefined) return { required: true, reason: 'network_action' }
      if (isCommandAlwaysAllowed(command)) return { required: false, reason: 'whitelisted_command' }
      if (isReadOnlyShellCommand(command)) return { required: false, reason: 'read_only_shell' }
      /*
       * v4.1: say "this changes files" when that is what it does. `remote_shell` classifies as `shell`, so the
       * fallback below could only ever say "not whitelisted" — a sentence that tells the user nothing about a
       * destructive command.
       */
      if (classifyShellCommand(command) === 'write') return { required: true, reason: 'write' }
    }
  }

  if (READ_ONLY_REMOTE_TOOLS.has(action.name)) return { required: false, reason: 'read_only_tool' }

  if (classifyAction(action) === 'write') return { required: true, reason: 'write' }
  return { required: true, reason: 'not_whitelisted' }
}

/** The reason label used by the dialog for an action that must be approved. */
export function describeApprovalReason(action: AgentAction): ApprovalReason {
  return shouldRequireApproval(action).reason
}

/**
 * Builds the per-run approval gate: returns true when an action may run, asking
 * the user only when the mode (or a deny-listed command) requires it. Learned
 * approvals short-circuit the prompt, except for deny-listed commands which are
 * always re-confirmed and never persisted. Only read-only tools may be
 * remembered, and (when a scope is supplied) only for the same VPS + project
 * within the TTL (v2.5, P0-3).
 */
export function createApprovalGate(
  options: ApprovalGateOptions
): (action: AgentAction) => Promise<boolean> {
  const approvedCommands = options.approvedCommands
  const sessionId = options.sessionId
  const suggestionAt = options.suggestionAt ?? DEFAULT_SUGGESTION_AT
  const counts = new Map<string, number>()
  const scope =
    options.vpsId !== undefined && options.projectId !== undefined
      ? { vpsId: options.vpsId, projectId: options.projectId }
      : undefined

  const remember = async (
    action: AgentAction,
    rememberScope: ApprovalRememberScope
  ): Promise<void> => {
    // Sensitive tools (shell, writes, migrations, ...) can never be remembered.
    if (!canRememberTool(action.name)) return
    if (options.recordRemember) {
      await options.recordRemember(action, rememberScope)
      return
    }
    if (scope) {
      await approvedCommands?.rememberScoped(
        createRememberedApproval(action.name, scope.vpsId, scope.projectId)
      )
      return
    }
    if (rememberScope === 'action') await approvedCommands?.rememberAction(action.name, action.arguments)
    else if (rememberScope === 'tool') await approvedCommands?.rememberTool(action.name)
    else if (rememberScope === 'session' && sessionId) {
      await approvedCommands?.rememberSession(sessionId, action.name)
    }
  }

  return async (action: AgentAction): Promise<boolean> => {
    const denyListed = isDenyListedAction(action)

    /*
     * v3.1: judge the action once, up front, and write it down before anything else can decide to
     * skip it. A record that only exists when the user was asked would miss exactly the decisions
     * the app took on its own — which are the ones a review is for.
     */
    const verdict = options.checkpoint
      ? options.checkpoint.classify({ name: action.name, arguments: action.arguments ?? {} })
      : undefined
    const consequential = verdict !== undefined && verdict.impact !== 'routine'
    const recordId =
      options.checkpoint && verdict && (options.checkpoint.mode !== 'off')
        ? await options.checkpoint
            .record({ action: { name: action.name, arguments: action.arguments ?? {} }, verdict })
            .catch(() => undefined)
        : undefined

    if (!denyListed) {
      if (approvedCommands?.isApproved(action.name, action.arguments, sessionId, scope)) {
        /*
         * A remembered approval covers an ordinary change, but not something that cannot be undone.
         * If it did, the checkpoint would be decorative: the noisiest, most dangerous actions are
         * exactly the ones a user is tempted to "always allow".
         */
        if (!(options.checkpoint?.mode === 'confirm' && verdict?.impact === 'irreversible')) {
          return true
        }
      }
      /*
       * v2.8.1: a scoped, expiring server grant suppresses the *user approval* only. It sits
       * inside `if (!denyListed)`, so a deny-listed command still prompts and can never be
       * auto-approved; the host policy, remote path containment, the secret-path guard, the
       * rate limiter and the audit log all run downstream and are unaffected.
       */
      if (scope && approvedCommands?.isServerGranted(scope)) {
        // Same rule as a remembered approval: a time-boxed grant is not consent to the irreversible.
        if (!(options.checkpoint?.mode === 'confirm' && verdict?.impact === 'irreversible')) {
          return true
        }
      }
      if (!requiresApproval(options.mode, action)) {
        // v3.1: confirm mode asks about a consequential action the mode would have allowed.
        if (!(options.checkpoint?.mode === 'confirm' && consequential)) return true
      }
      // v2.5.5: a whitelisted or read-only command (and the remote read-only
      // tools) never pushes a prompt. Containment is still enforced downstream.
      if (!shouldRequireApproval(action).required) return true
    }

    const reason = options.reasonFor?.(action) ?? shouldRequireApproval(action).reason
    const outcome = await options.requestApproval(action, reason)
    if (recordId && options.checkpoint?.resolve) {
      await options.checkpoint
        .resolve(recordId, outcome.approved ? 'approved' : 'rejected')
        .catch(() => undefined)
    }
    if (!outcome.approved) return false

    if (outcome.remember && !denyListed) await remember(action, outcome.remember)

    /*
     * v2.8.1: mint the scoped server grant the user asked for. It is only reachable for a
     * run that knows its server and project, and it is a bounded, revocable window rather
     * than a permanent allow — the store keeps it apart from `always`/`tools`/`sessions`
     * precisely so a stale file cannot resurrect a permanent shell approval.
     */
    if (outcome.grant === 'server' && scope && approvedCommands) {
      await approvedCommands.rememberServerGrant(scope.vpsId, scope.projectId)
    }

    const count = (counts.get(action.name) ?? 0) + 1
    counts.set(action.name, count)
    if (
      count === suggestionAt &&
      canRememberTool(action.name) &&
      !approvedCommands?.isApproved(action.name, action.arguments, sessionId, scope)
    ) {
      options.onSuggestion?.(action.name, count)
    }
    return true
  }
}
