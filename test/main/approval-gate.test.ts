import { describe, it, expect, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ApprovalOutcome, ApprovalRememberScope } from '@shared/approval'
import type { AgentAction } from '@shared/agent'
import { ApprovedCommands } from '@core/agent/approved-commands'
import { createApprovalGate } from '@main/approval-gate'

const temps: string[] = []
afterEach(async () => {
  for (const dir of temps) await fs.rm(dir, { recursive: true, force: true })
  temps.length = 0
})

async function newStore(): Promise<ApprovedCommands> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'gate-'))
  temps.push(dir)
  return new ApprovedCommands({ file: join(dir, 'approved-commands.json') })
}

function action(name: string, args: Record<string, unknown> = {}): AgentAction {
  return {
    id: 'a1',
    name,
    arguments: args,
    rawArguments: JSON.stringify(args),
    valid: true,
    signature: name
  }
}

describe('createApprovalGate', () => {
  it('runs freely in full mode without prompting', async () => {
    const prompts: AgentAction[] = []
    const gate = createApprovalGate({
      mode: 'full',
      requestApproval: async (a) => {
        prompts.push(a)
        return { approved: true }
      }
    })
    expect(await gate(action('read_file', { path: 'a' }))).toBe(true)
    expect(await gate(action('write_file', { path: 'a' }))).toBe(true)
    expect(await gate(action('run_command', { command: 'ls' }))).toBe(true)
    expect(prompts).toHaveLength(0)
  })

  it('prompts for everything in ask mode and honours denial', async () => {
    let asked = 0
    const gate = createApprovalGate({
      mode: 'ask',
      requestApproval: async () => {
        asked += 1
        return { approved: false }
      }
    })
    expect(await gate(action('read_file', { path: 'a' }))).toBe(false)
    expect(asked).toBe(1)
  })

  it('auto-approves writes but not reads in auto-write mode', async () => {
    const asked: string[] = []
    const gate = createApprovalGate({
      mode: 'auto-write',
      requestApproval: async (a) => {
        asked.push(a.name)
        return { approved: true }
      }
    })
    await gate(action('read_file', { path: 'a' }))
    await gate(action('write_file', { path: 'a' }))
    expect(asked).toEqual(['write_file'])
  })

  it('suppresses prompts for a learned tool', async () => {
    const commands = await newStore()
    await commands.rememberTool('read_file')
    let asked = 0
    const gate = createApprovalGate({
      mode: 'ask',
      approvedCommands: commands,
      requestApproval: async () => {
        asked += 1
        return { approved: true }
      }
    })
    expect(await gate(action('read_file', { path: 'whatever' }))).toBe(true)
    expect(asked).toBe(0)
  })

  it('persists a remember scope chosen for one action', async () => {
    const commands = await newStore()
    const gate = createApprovalGate({
      mode: 'ask',
      approvedCommands: commands,
      requestApproval: async (): Promise<ApprovalOutcome> => ({
        approved: true,
        remember: 'action' as ApprovalRememberScope
      })
    })
    await gate(action('read_file', { path: 'a.txt' }))
    expect(commands.isApproved('read_file', { path: 'a.txt' })).toBe(true)
    expect(commands.isApproved('read_file', { path: 'b.txt' })).toBe(false)
  })

  it('never auto-approves or remembers a deny-listed command', async () => {
    const commands = await newStore()
    const destructive = action('run_command', { command: 'rm -rf / --no-preserve-root' })
    let asked = 0
    const gate = createApprovalGate({
      mode: 'full',
      approvedCommands: commands,
      requestApproval: async (): Promise<ApprovalOutcome> => {
        asked += 1
        return { approved: true, remember: 'tool' }
      }
    })
    expect(await gate(destructive)).toBe(true)
    expect(asked).toBe(1)
    expect(commands.isApproved('run_command', { command: 'rm -rf / --no-preserve-root' })).toBe(
      false
    )
    // A second identical call still prompts.
    await gate(destructive)
    expect(asked).toBe(2)
  })

  it('suggests remembering a tool on the third approval', async () => {
    const suggestions: Array<[string, number]> = []
    const gate = createApprovalGate({
      mode: 'ask',
      requestApproval: async () => ({ approved: true }),
      onSuggestion: (tool, count) => suggestions.push([tool, count])
    })
    await gate(action('read_file', { path: 'a' }))
    await gate(action('read_file', { path: 'b' }))
    expect(suggestions).toHaveLength(0)
    await gate(action('read_file', { path: 'c' }))
    expect(suggestions).toEqual([['read_file', 3]])
  })
})
