import { describe, it, expect, vi } from 'vitest'
import { createApprovalGate, shouldRequireApproval } from '@main/approval-gate'
import type { AgentAction } from '@shared/agent'
import type { ApprovalOutcome } from '@shared/approval'

/**
 * v2.5.8 — the approval gate must actually trust `isReadOnlyShellCommand`.
 *
 * The gate consults the classifier for `remote_shell` (v2.5.5) and only asks
 * the user when it returns false. This suite pins that wiring: a read-only
 * command that reaches the gate (e.g. the v2.5.8 assignment chain) never opens a
 * prompt, while a write still does.
 */
const READ_ONLY_COMMAND =
  'B=/opt/demo-project/releases/RELEASE-2026-10-05/web; echo "=== BUILD_ID ? ==="; ' +
  'find "$B" -maxdepth 2 -name BUILD_ID 2>&1; cat "$B"/.next/package.json 2>&1'

function action(name: string, args: Record<string, unknown>): AgentAction {
  return {
    id: 'a1',
    name,
    arguments: args,
    rawArguments: JSON.stringify(args),
    valid: true,
    signature: `${name}:${JSON.stringify(args)}`
  }
}

describe('v2.5.8 - read-only integration with the approval gate', () => {
  it('1. shouldRequireApproval trusts the read-only classifier', () => {
    expect(shouldRequireApproval(action('remote_shell', { command: READ_ONLY_COMMAND }))).toEqual({
      required: false,
      reason: 'read_only_shell'
    })
  })

  it('2. a read-only remote_shell never prompts', async () => {
    const asked = vi.fn<(a: AgentAction) => Promise<ApprovalOutcome>>()
    const gate = createApprovalGate({ mode: 'ask', requestApproval: asked })

    const allowed = await gate(action('remote_shell', { command: READ_ONLY_COMMAND }))

    expect(allowed).toBe(true)
    expect(asked).not.toHaveBeenCalled()
  })

  it('3. a write remote_shell still prompts and can be denied', async () => {
    const asked = vi
      .fn<(a: AgentAction) => Promise<ApprovalOutcome>>()
      .mockResolvedValue({ approved: false })
    const gate = createApprovalGate({ mode: 'ask', requestApproval: asked })

    const allowed = await gate(action('remote_shell', { command: 'B=/tmp/x; rm -rf "$B"' }))

    expect(allowed).toBe(false)
    expect(asked).toHaveBeenCalledTimes(1)
  })

  it('4. a write tool requires approval', () => {
    const verdict = shouldRequireApproval(
      action('remote_write_file', { path: '/opt/app/x', content: 'y' })
    )
    expect(verdict.required).toBe(true)
  })
})
