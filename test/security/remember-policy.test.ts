import { describe, it, expect, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ApprovalOutcome } from '@shared/approval'
import type { AgentAction } from '@shared/agent'
import { ApprovedCommands } from '@core/agent/approved-commands'
import { createApprovalGate } from '@main/approval-gate'
import {
  canRememberTool,
  createRememberedApproval,
  isRememberedApprovalValid,
  REMEMBER_TTL_MS,
  type RememberedApproval
} from '@core/agent/remember-policy'

/**
 * P0-3: remembering an approval must be limited to read-only tools, and must be
 * bound to one VPS + project with a 30-minute TTL. `remote_shell` in particular
 * must never be "always allowed".
 */
const temps: string[] = []
afterEach(async () => {
  for (const dir of temps) await fs.rm(dir, { recursive: true, force: true })
  temps.length = 0
})

async function newStore(): Promise<ApprovedCommands> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'remember-'))
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

describe('canRememberTool', () => {
  it('never allows remote_shell to be remembered', () => {
    expect(canRememberTool('remote_shell')).toBe(false)
    expect(canRememberTool('run_command')).toBe(false)
    expect(canRememberTool('write_file')).toBe(false)
    expect(canRememberTool('remote_write_file')).toBe(false)
    expect(canRememberTool('migrate_project')).toBe(false)
    expect(canRememberTool('scaffold_project')).toBe(false)
  })

  it('allows read-only tools to be remembered', () => {
    expect(canRememberTool('read_file')).toBe(true)
    expect(canRememberTool('list_dir')).toBe(true)
    expect(canRememberTool('exists')).toBe(true)
    expect(canRememberTool('remote_read_file')).toBe(true)
    expect(canRememberTool('remote_list_dir')).toBe(true)
    expect(canRememberTool('remote_exists')).toBe(true)
  })

  it('refuses to build a remembered approval for a sensitive tool', () => {
    expect(() => createRememberedApproval('remote_shell', 'vps-a', 'p1')).toThrow()
    expect(() => createRememberedApproval('write_file', 'vps-a', 'p1')).toThrow()
  })
})

describe('isRememberedApprovalValid', () => {
  const base: RememberedApproval = {
    toolName: 'read_file',
    vpsId: 'vps-a',
    projectId: 'p1',
    createdAt: 1_000,
    expiresAt: 1_000 + REMEMBER_TTL_MS
  }
  const ctx = { toolName: 'read_file', vpsId: 'vps-a', projectId: 'p1' }

  it('accepts the exact scope within the TTL', () => {
    expect(isRememberedApprovalValid(base, ctx, 1_000 + REMEMBER_TTL_MS - 1)).toBe(true)
  })

  it('expires after 30 minutes', () => {
    expect(isRememberedApprovalValid(base, ctx, base.expiresAt + 1)).toBe(false)
  })

  it('does not apply to a different VPS', () => {
    expect(isRememberedApprovalValid(base, { ...ctx, vpsId: 'vps-b' }, 2_000)).toBe(false)
  })

  it('does not apply to a different project', () => {
    expect(isRememberedApprovalValid(base, { ...ctx, projectId: 'p2' }, 2_000)).toBe(false)
  })

  it('does not apply to a different tool', () => {
    expect(isRememberedApprovalValid(base, { ...ctx, toolName: 'remote_read_file' }, 2_000)).toBe(
      false
    )
  })

  it('rejects a stored approval for a non-rememberable tool', () => {
    const evil = { ...base, toolName: 'remote_shell' }
    expect(isRememberedApprovalValid(evil, { ...ctx, toolName: 'remote_shell' }, 2_000)).toBe(false)
  })
})

describe('ApprovedCommands scoped approvals', () => {
  it('honours a scoped read approval only for the same VPS + project', async () => {
    const commands = await newStore()
    await commands.rememberScoped(createRememberedApproval('read_file', 'vps-a', 'p1'))
    expect(commands.isApproved('read_file', {}, undefined, { vpsId: 'vps-a', projectId: 'p1' })).toBe(
      true
    )
    expect(commands.isApproved('read_file', {}, undefined, { vpsId: 'vps-b', projectId: 'p1' })).toBe(
      false
    )
    expect(commands.isApproved('read_file', {}, undefined, { vpsId: 'vps-a', projectId: 'p2' })).toBe(
      false
    )
  })

  it('refuses to persist a scoped approval for a sensitive tool', async () => {
    const commands = await newStore()
    await commands.rememberScoped(
      // Bypass the constructor guard to simulate a hostile/legacy on-disk entry.
      { toolName: 'remote_shell', vpsId: 'vps-a', projectId: 'p1', createdAt: 0, expiresAt: Date.now() + 60_000 }
    )
    expect(commands.isApproved('remote_shell', {}, undefined, { vpsId: 'vps-a', projectId: 'p1' })).toBe(
      false
    )
    expect(commands.list()).toHaveLength(0)
  })

  it('ignores an already-stored legacy global tool entry for a sensitive tool', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'remember-legacy-'))
    temps.push(dir)
    const file = join(dir, 'approved-commands.json')
    await fs.writeFile(file, JSON.stringify({ version: 1, always: [], tools: ['remote_shell'], sessions: {} }))
    const commands = new ApprovedCommands({ file })
    await commands.load()
    expect(commands.isApproved('remote_shell', { command: 'uptime' })).toBe(false)
  })

  it('lists a scoped approval so it can be revoked', async () => {
    const commands = await newStore()
    await commands.rememberScoped(createRememberedApproval('read_file', 'vps-a', 'p1'))
    const views = commands.list()
    expect(views).toHaveLength(1)
    expect(views[0].kind).toBe('scoped')
    expect(await commands.revoke(views[0].id)).toBe(true)
    expect(commands.list()).toHaveLength(0)
    expect(commands.isApproved('read_file', {}, undefined, { vpsId: 'vps-a', projectId: 'p1' })).toBe(
      false
    )
  })
})

describe('createApprovalGate remember policy', () => {
  it('never remembers remote_shell even when the user asks to', async () => {
    const commands = await newStore()
    let asked = 0
    const gate = createApprovalGate({
      mode: 'ask',
      approvedCommands: commands,
      vpsId: 'vps-a',
      projectId: 'p1',
      requestApproval: async (): Promise<ApprovalOutcome> => {
        asked += 1
        return { approved: true, remember: 'tool' }
      }
    })
    const shell = action('remote_shell', { server_id: 'vps-a', command: 'rm -rf /srv' })
    expect(await gate(shell)).toBe(true)
    expect(await gate(shell)).toBe(true)
    // Every call still prompts: nothing was remembered.
    expect(asked).toBe(2)
    expect(commands.isApproved('remote_shell', {}, undefined, { vpsId: 'vps-a', projectId: 'p1' })).toBe(
      false
    )
  })

  it('remembers a read tool for the same VPS + project only', async () => {
    const commands = await newStore()
    let asked = 0
    const gate = createApprovalGate({
      mode: 'ask',
      approvedCommands: commands,
      vpsId: 'vps-a',
      projectId: 'p1',
      requestApproval: async (): Promise<ApprovalOutcome> => {
        asked += 1
        return { approved: true, remember: 'tool' }
      }
    })
    await gate(action('read_file', { path: 'a.txt' }))
    expect(asked).toBe(1)
    // Same scope: suppressed.
    await gate(action('read_file', { path: 'b.txt' }))
    expect(asked).toBe(1)
    // Different project: prompts again.
    const otherProject = createApprovalGate({
      mode: 'ask',
      approvedCommands: commands,
      vpsId: 'vps-a',
      projectId: 'p2',
      requestApproval: async (): Promise<ApprovalOutcome> => {
        asked += 1
        return { approved: true }
      }
    })
    await otherProject(action('read_file', { path: 'a.txt' }))
    expect(asked).toBe(2)
  })

  it('does not suggest remembering a sensitive tool', async () => {
    const commands = await newStore()
    const suggestions: string[] = []
    const gate = createApprovalGate({
      mode: 'ask',
      approvedCommands: commands,
      vpsId: 'vps-a',
      projectId: 'p1',
      requestApproval: async () => ({ approved: true }),
      onSuggestion: (tool) => suggestions.push(tool),
      suggestionAt: 2
    })
    await gate(action('write_file', { path: 'a', content: 'x' }))
    await gate(action('write_file', { path: 'b', content: 'x' }))
    expect(suggestions).toEqual([])
  })

  it('still suggests remembering a read tool', async () => {
    const commands = await newStore()
    const suggestions: string[] = []
    const gate = createApprovalGate({
      mode: 'ask',
      approvedCommands: commands,
      vpsId: 'vps-a',
      projectId: 'p1',
      requestApproval: async () => ({ approved: true }),
      onSuggestion: (tool) => suggestions.push(tool),
      suggestionAt: 2
    })
    await gate(action('read_file', { path: 'a' }))
    await gate(action('read_file', { path: 'b' }))
    expect(suggestions).toEqual(['read_file'])
  })
})
