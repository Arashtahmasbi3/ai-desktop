/**
 * Approval / Plan-Mode vocabulary shared by main, renderer and core.
 * Dependency-free so the renderer can import it directly.
 */

/**
 * How much the agent may do before it has to ask the user:
 * - `auto`      — never ask (the user trusts the run).
 * - `dangerous` — ask before shell/exec tools and anything that trips the deny list.
 * - `writes`    — ask before every write and every shell command.
 */
export type ApprovalMode = 'auto' | 'dangerous' | 'writes'

export const APPROVAL_MODES: readonly ApprovalMode[] = ['auto', 'dangerous', 'writes']

export const DEFAULT_APPROVAL_MODE: ApprovalMode = 'dangerous'

export function isApprovalMode(value: unknown): value is ApprovalMode {
  return value === 'auto' || value === 'dangerous' || value === 'writes'
}

/** Instruction appended to the system prompt in Plan Mode. */
export const PLAN_MODE_HINT =
  '# Plan Mode (active)\n' +
  'You are planning only. Do NOT call any tools and do NOT claim to have changed ' +
  'anything. Produce a concrete, ordered plan: the files to touch, the commands ' +
  'you would run, the risks, and how the result will be verified. End your reply ' +
  'with a short prompt asking the user to switch to Code mode to execute it.'
