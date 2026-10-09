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

/** The user's answer to an approval prompt. */
export interface ApprovalOutcome {
  approved: boolean
  remember?: ApprovalRememberScope
  /** Deny & Explain: ask the agent why it wanted to run the action. */
  explain?: boolean
}

export type ApprovedCommandKind = 'action' | 'tool' | 'session'

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
