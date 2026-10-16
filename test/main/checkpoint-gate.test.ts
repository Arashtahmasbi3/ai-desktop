import { describe, expect, it, vi } from 'vitest'
import { createApprovalGate } from '@main/approval-gate'
import { ApprovedCommands } from '@core/agent/approved-commands'
import { classifyImpact } from '@shared/decision-checkpoint'
import type { AgentAction } from '@shared/agent'
import type { ApprovalOutcome } from '@shared/approval'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * Decision checkpoints in the approval gate (v3.1).
 *
 * The judgement itself is tested in `test/shared/decision-checkpoint.test.ts`. What these cases pin
 * is the *gate semantics*, where a mistake is a safety hole or a nuisance:
 *
 *  - a decision is recorded **before** anything can skip it, so a review sees what the app did on
 *    its own and not only the times it asked;
 *  - in `confirm` mode an **irreversible** action is put to the user **even when it would have been
 *    auto-approved or is covered by a remembered approval** — "you told me this tool is fine" is not
 *    the same statement as "go ahead and delete it";
 *  - an ordinary write is *not* re-prompted, or the prompt becomes noise the user clicks through;
 *  - how it ended is recorded, not only that it was asked.
 */
const action = (name: string, args: Record<string, unknown> = {}): AgentAction =>
  ({ name, arguments: args }) as AgentAction

function approve(over: Partial<ApprovalOutcome> = {}): ApprovalOutcome {
  return { approved: true, ...over } as ApprovalOutcome
}

async function approvedCommands(): Promise<ApprovedCommands> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'cp-gate-'))
  return new ApprovedCommands({ file: join(dir, 'approved.json') })
}

/** A checkpoint harness that records what the gate told it, without touching the disk. */
function checkpoint(mode: 'off' | 'record' | 'confirm') {
  const recorded: Array<{ name: string; impact: string; id: string }> = []
  const resolved: Array<{ id: string; decision: string }> = []
  let counter = 0
  return {
    recorded,
    resolved,
    option: {
      mode,
      classify: (input: { name: string; arguments: Record<string, unknown> }) =>
        classifyImpact({ tool: input.name, args: input.arguments }),
      record: async (input: { action: { name: string } }) => {
        const id = `cp-${(counter += 1)}`
        recorded.push({
          name: input.action.name,
          impact: classifyImpact({ tool: input.action.name, args: {} }).impact,
          id
        })
        return id
      },
      resolve: async (id: string, decision: 'approved' | 'rejected' | 'timeout') => {
        resolved.push({ id, decision })
      }
    }
  }
}

describe('recording happens before anything can skip the decision (v3.1)', () => {
  it('records a decision that full mode auto-approved without a prompt', async () => {
    const requestApproval = vi.fn(async () => approve())
    const cp = checkpoint('record')
    const gate = createApprovalGate({
      mode: 'full',
      requestApproval,
      checkpoint: cp.option
    })

    const allowed = await gate(action('write_file', { path: 'src/a.ts' }))

    expect(allowed).toBe(true)
    // Nothing was asked, but the decision is on the record — that is the point of `record`.
    expect(requestApproval).not.toHaveBeenCalled()
    expect(cp.recorded).toHaveLength(1)
  })

  it('records nothing at all when the mode is off', async () => {
    const cp = checkpoint('off')
    const gate = createApprovalGate({
      mode: 'full',
      requestApproval: async () => approve(),
      checkpoint: cp.option
    })

    await gate(action('write_file', { path: 'src/a.ts' }))

    expect(cp.recorded).toEqual([])
  })
})

describe('confirm mode pauses where it matters and nowhere else (v3.1)', () => {
  it('asks about an irreversible action even in full mode', async () => {
    const requestApproval = vi.fn(async () => approve())
    const cp = checkpoint('confirm')
    const gate = createApprovalGate({ mode: 'full', requestApproval, checkpoint: cp.option })

    const allowed = await gate(action('run_command', { command: 'rm -rf /srv/app' }))

    expect(allowed).toBe(true)
    expect(requestApproval).toHaveBeenCalledTimes(1)
    // And the answer is attached to the record rather than left dangling.
    expect(cp.resolved).toEqual([{ id: 'cp-1', decision: 'approved' }])
  })

  it('does NOT ask about a read, because a checkpoint that fires on everything is noise', async () => {
    const requestApproval = vi.fn(async () => approve())
    const gate = createApprovalGate({
      mode: 'full',
      requestApproval,
      checkpoint: checkpoint('confirm').option
    })

    expect(await gate(action('read_file', { path: 'src/a.ts' }))).toBe(true)
    expect(requestApproval).not.toHaveBeenCalled()
  })

  it('asks about an ordinary write that full mode would have allowed', async () => {
    const requestApproval = vi.fn(async () => approve())
    const gate = createApprovalGate({
      mode: 'full',
      requestApproval,
      checkpoint: checkpoint('confirm').option
    })

    await gate(action('write_file', { path: 'src/a.ts' }))

    expect(requestApproval).toHaveBeenCalledTimes(1)
  })

  it('refuses the irreversible when the user says no, and records the refusal', async () => {
    const requestApproval = vi.fn(async () => ({ approved: false }) as ApprovalOutcome)
    const cp = checkpoint('confirm')
    const gate = createApprovalGate({ mode: 'full', requestApproval, checkpoint: cp.option })

    expect(await gate(action('run_command', { command: 'rm -rf /srv/app' }))).toBe(false)
    expect(cp.resolved).toEqual([{ id: 'cp-1', decision: 'rejected' }])
  })
})

describe('a broad standing permission is not consent to the irreversible (v3.1)', () => {
  /**
   * Only **read-only** tools can ever be remembered (`REMEMBERABLE_TOOLS`), and those are `routine`
   * by classification — so a *remembered approval* can never cover a consequential action. The
   * standing permission that actually can is the scoped **server grant**, which covers shell
   * commands on one server in one project for 30 minutes. That is the case worth pinning, because
   * it is the one where a user has said "stop asking me about this machine".
   */
  const scope = { vpsId: 'vps-1', projectId: 'project-1' }

  it('still asks for an irreversible command inside a granted server window', async () => {
    const store = await approvedCommands()
    const requestApproval = vi.fn(async () => approve())
    const gate = createApprovalGate({
      mode: 'full',
      approvedCommands: store,
      requestApproval,
      checkpoint: checkpoint('confirm').option,
      ...scope
    })
    await store.rememberServerGrant(scope.vpsId, scope.projectId)

    await gate(action('run_command', { command: 'rm -rf /srv/app' }))

    // "Stop asking me about this server" is not "you may destroy it without telling me".
    expect(requestApproval).toHaveBeenCalledTimes(1)
  })

  it('does not re-ask for an ordinary command inside a granted server window', async () => {
    const store = await approvedCommands()
    const requestApproval = vi.fn(async () => approve())
    const gate = createApprovalGate({
      mode: 'full',
      approvedCommands: store,
      requestApproval,
      checkpoint: checkpoint('confirm').option,
      ...scope
    })
    await store.rememberServerGrant(scope.vpsId, scope.projectId)

    await gate(action('run_command', { command: 'npm install left-pad' }))

    // A grant is exactly what a recurring, revertible command is for; re-prompting would make the
    // grant useless and train the user to click through.
    expect(requestApproval).not.toHaveBeenCalled()
  })
})
