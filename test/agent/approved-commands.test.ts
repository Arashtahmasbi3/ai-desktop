import { describe, it, expect, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  actionFingerprint,
  actionPattern,
  ApprovedCommands,
  toolPattern
} from '@core/agent/approved-commands'

const temps: string[] = []
afterEach(async () => {
  for (const dir of temps) await fs.rm(dir, { recursive: true, force: true })
  temps.length = 0
})

async function newFile(): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'approved-'))
  temps.push(dir)
  return join(dir, 'approved-commands.json')
}

describe('action fingerprints', () => {
  it('is stable regardless of key order', () => {
    expect(actionFingerprint({ a: 1, b: 2 })).toBe(actionFingerprint({ b: 2, a: 1 }))
  })

  it('distinguishes different arguments', () => {
    expect(actionPattern('run_command', { command: 'ls' })).not.toBe(
      actionPattern('run_command', { command: 'rm -rf /' })
    )
  })

  it('builds wildcard tool patterns', () => {
    expect(toolPattern('read_file')).toBe('read_file:*')
  })
})

describe('ApprovedCommands', () => {
  it('approves an exact action only after remembering it', async () => {
    const commands = new ApprovedCommands({ file: await newFile() })
    await commands.load()
    expect(commands.isApproved('read_file', { path: 'a.txt' })).toBe(false)
    await commands.rememberAction('read_file', { path: 'a.txt' })
    expect(commands.isApproved('read_file', { path: 'a.txt' })).toBe(true)
    expect(commands.isApproved('read_file', { path: 'b.txt' })).toBe(false)
  })

  it('approves every call of a remembered tool', async () => {
    const commands = new ApprovedCommands({ file: await newFile() })
    await commands.rememberTool('list_dir')
    expect(commands.isApproved('list_dir', { path: 'anywhere' })).toBe(true)
    expect(commands.isApproved('read_file', { path: 'a.txt' })).toBe(false)
  })

  it('scopes session approvals to that session', async () => {
    const commands = new ApprovedCommands({ file: await newFile() })
    await commands.rememberSession('session-1', 'remote_read_file')
    expect(commands.isApproved('remote_read_file', {}, 'session-1')).toBe(true)
    expect(commands.isApproved('remote_read_file', {}, 'session-2')).toBe(false)
  })

  it('refuses to remember a write or shell tool', async () => {
    const commands = new ApprovedCommands({ file: await newFile() })
    await commands.rememberTool('remote_shell')
    await commands.rememberSession('s1', 'write_file')
    await commands.rememberAction('run_command', { command: 'ls' })
    expect(commands.isApproved('remote_shell', {})).toBe(false)
    expect(commands.isApproved('write_file', {}, 's1')).toBe(false)
    expect(commands.isApproved('run_command', { command: 'ls' })).toBe(false)
    expect(commands.list()).toHaveLength(0)
  })

  it('persists remember choices across instances', async () => {
    const file = await newFile()
    const commands = new ApprovedCommands({ file })
    await commands.rememberTool('read_file')
    const reloaded = new ApprovedCommands({ file })
    await reloaded.load()
    expect(reloaded.isApproved('read_file', {})).toBe(true)
  })

  it('lists and revokes each kind of approval', async () => {
    const commands = new ApprovedCommands({ file: await newFile() })
    await commands.rememberAction('read_file', { path: 'a.txt' })
    await commands.rememberTool('list_dir')
    await commands.rememberSession('s1', 'remote_read_file')

    const views = commands.list()
    expect(views).toHaveLength(3)
    for (const view of views) {
      expect(await commands.revoke(view.id)).toBe(true)
    }
    expect(commands.list()).toHaveLength(0)
    expect(commands.isApproved('read_file', { path: 'a.txt' })).toBe(false)
    expect(commands.isApproved('list_dir', {})).toBe(false)
    expect(commands.isApproved('remote_read_file', {}, 's1')).toBe(false)
  })
})
