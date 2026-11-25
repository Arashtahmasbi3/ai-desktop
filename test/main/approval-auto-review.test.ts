import { describe, expect, it } from 'vitest'
import type { AgentAction } from '@shared/agent'
import { createApprovalGate } from '@main/approval-gate'

/**
 * T22 — auto-review at the gate.
 *
 * The property that matters: an `irreversible` action asks even in `full` mode, and a `routine` one still runs without a
 * prompt. The review can only add prompts, so the second test is as important as the first.
 */
function action(name: string, args: Record<string, unknown> = {}): AgentAction {
  return { id: 'a1', name, arguments: args, rawArguments: JSON.stringify(args), valid: true, signature: name }
}

const ask = async (): Promise<never> => {
  throw new Error('the gate asked the user')
}

describe('auto-review (T22)', () => {
  it('keeps the prompt for an irreversible action in full mode', async () => {
    const prompts: AgentAction[] = []
    const gate = createApprovalGate({
      mode: 'full',
      impactOf: () => 'irreversible',
      autoReview: async () => ({ approve: false, reason: 'irreversible' }),
      requestApproval: async (a) => {
        prompts.push(a)
        return { approved: true }
      }
    })

    expect(await gate(action('run_command', { command: 'git push --force' }))).toBe(true)
    expect(prompts).toHaveLength(1)
  })

  it('does not prompt for a routine action in full mode', async () => {
    let asked = 0
    const gate = createApprovalGate({
      mode: 'full',
      impactOf: () => 'routine',
      autoReview: async () => ({ approve: false, reason: 'irreversible' }),
      requestApproval: async () => {
        asked += 1
        return { approved: true }
      }
    })

    expect(await gate(action('read_file', { path: 'a' }))).toBe(true)
    expect(asked).toBe(0)
  })

  it('never turns a refusal into an allow: an approving reviewer cannot bypass ask mode', async () => {
    const gate = createApprovalGate({
      mode: 'ask',
      impactOf: () => 'irreversible',
      autoReview: async () => ({ approve: true, reason: 'looks fine' }),
      requestApproval: async () => ({ approved: false })
    })

    expect(await gate(action('write_file', { path: 'a' }))).toBe(false)
  })

  it('escalates when the reviewer throws', async () => {
    let asked = 0
    const gate = createApprovalGate({
      mode: 'full',
      impactOf: () => 'irreversible',
      autoReview: async () => ask(),
      requestApproval: async () => {
        asked += 1
        return { approved: true }
      }
    })

    expect(await gate(action('write_file', { path: 'a' }))).toBe(true)
    expect(asked).toBe(1)
  })
})
