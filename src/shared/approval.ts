/**
 * Approval / Plan-Mode vocabulary shared by main, renderer and core.
 * Dependency-free so the renderer can import it directly.
 */

/**
 * How much the agent may do before it has to ask the user (v2.3, Codex-like):
 * - `ask`        — ask before every tool call (reads included).
 * - `auto-write` — reads and searches run freely; writes and shell commands ask.
 * - `full`       — everything runs without asking (deny-listed commands still ask).
 */
export type ApprovalMode = 'ask' | 'auto-write' | 'full'

export const APPROVAL_MODES: readonly ApprovalMode[] = ['ask', 'auto-write', 'full']

export const DEFAULT_APPROVAL_MODE: ApprovalMode = 'ask'

/** Legacy v2.2 mode names mapped onto the v2.3 vocabulary. */
const LEGACY_APPROVAL_MODES: Record<string, ApprovalMode> = {
  auto: 'full',
  writes: 'auto-write',
  dangerous: 'ask'
}

export function isApprovalMode(value: unknown): value is ApprovalMode {
  return value === 'ask' || value === 'auto-write' || value === 'full'
}

/** Accept both current and legacy mode names so older configs keep working. */
export function coerceApprovalMode(value: unknown): ApprovalMode | undefined {
  if (isApprovalMode(value)) return value
  if (typeof value === 'string' && value in LEGACY_APPROVAL_MODES) {
    return LEGACY_APPROVAL_MODES[value]
  }
  return undefined
}

/** True when the agent runs without asking (full access). */
export function isFullAccess(mode: ApprovalMode): boolean {
  return mode === 'full'
}

/** Cycle ask -> auto-write -> full -> ask, used by the composer/status toggles. */
export function nextApprovalMode(mode: ApprovalMode): ApprovalMode {
  const index = APPROVAL_MODES.indexOf(mode)
  return APPROVAL_MODES[(index + 1) % APPROVAL_MODES.length]
}

/** What may be remembered from an approval, widest last. */
export type ApprovalRememberScope = 'action' | 'tool' | 'session'

/**
 * Why an action still needed explicit approval (v2.5.5). Shown in the dialog so
 * the user understands the gate instead of guessing.
 */
export type ApprovalReason =
  | 'whitelisted_command'
  | 'read_only_shell'
  | 'read_only_tool'
  | 'not_whitelisted'
  | 'write'
  | 'dangerous'
  | 'outside_plan'
  /**
   * v4.1: the command reaches another host (a port probe or a scan). It is asked about in those words, even
   * when the command is otherwise read-only, because "read-only" describes the local filesystem and says
   * nothing about pointing six ports at somebody else's machine.
   */
  | 'network_action'

/** The user's answer to an approval prompt. */
export interface ApprovalOutcome {
  approved: boolean
  remember?: ApprovalRememberScope
  /** Deny & Explain: ask the agent why it wanted to run the action. */
  explain?: boolean
  /**
   * v2.8.1: "approve every command on THIS server in THIS project for 30 minutes".
   *
   * Deliberately a separate field from `remember`: `ApprovalRememberScope` is
   * contractually read-only (see `remember-policy.ts`), and widening it would put shell
   * and write tools back into the permanently-remembered set that v2.5 P0-3 removed. This
   * grant is scoped to one server + one project, expires, and never becomes permanent.
   */
  grant?: 'server'
}

export type ApprovedCommandKind = 'action' | 'tool' | 'session' | 'scoped' |
  /** v2.8.1: "all commands on this server in this project for 30 minutes". */
  'server'

/** A learned approval shown in Settings → Advanced → Approved Commands. */
export interface ApprovedCommandView {
  id: string
  kind: ApprovedCommandKind
  tool: string
  label: string
  sessionId?: string
}

/** A past approval shown in the dialog's History list. */
export interface ApprovalHistoryEntry {
  id: string
  runId: string
  tool: string
  summary: string
  approved: boolean
  at: number
}

/** Instruction appended to the system prompt in Plan Mode. */
export const PLAN_MODE_HINT =
  '# Plan Mode (active)\n' +
  'You are planning only. Do NOT call any tools and do NOT claim to have changed ' +
  'anything. Produce a concrete, ordered plan: the files to touch, the commands ' +
  'you would run, the risks, and how the result will be verified. End your reply ' +
  'with a short prompt asking the user to switch to Code mode to execute it.'
