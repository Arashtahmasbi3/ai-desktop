import { describe, expect, it } from 'vitest'
import type { VpsExecResult } from '@shared/vps'
import {
  createWorktree,
  isValidBranch,
  listWorktrees,
  parseWorktreeList,
  removeWorktree,
  worktreePath,
  worktreesRoot,
  type WorktreeDeps
} from '@core/agent/worktree-manager'

const ok = (stdout = ''): VpsExecResult => ({ ok: true, stdout, stderr: '', exitCode: 0 })
const bad = (stderr = 'boom'): VpsExecResult => ({ ok: false, stdout: '', stderr, exitCode: 1 })

interface Harness extends WorktreeDeps {
  calls: string[]
}

function harness(listOutput = '', opts: { failAdd?: boolean; failRemove?: boolean } = {}): Harness {
  const calls: string[] = []
  return {
    calls,
    exec: async (_serverId, command): Promise<VpsExecResult> => {
      calls.push(command)
      if (command.includes('git worktree list')) return ok(listOutput)
      if (command.includes('git worktree add')) return opts.failAdd ? bad('already exists') : ok()
      if (command.includes('git worktree remove')) return opts.failRemove ? bad('locked') : ok()
      return ok()
    }
  }
}

const PORCELAIN = [
  'worktree /var/www/app',
  'HEAD abc123',
  'branch refs/heads/main',
  '',
  'worktree /var/www/app.worktrees/feature-a',
  'HEAD def456',
  'branch refs/heads/feature-a'
].join('\n')

describe('worktree helpers', () => {
  it('parses git worktree porcelain output', () => {
    const trees = parseWorktreeList(PORCELAIN)
    expect(trees).toHaveLength(2)
    expect(trees[0]).toMatchObject({ path: '/var/www/app', branch: 'main' })
    expect(trees[1]).toMatchObject({ path: '/var/www/app.worktrees/feature-a', branch: 'feature-a' })
  })

  it('validates branch names and computes paths', () => {
    expect(isValidBranch('feature/login')).toBe(true)
    expect(isValidBranch('bad..name')).toBe(false)
    expect(worktreesRoot('/var/www/app/')).toBe('/var/www/app.worktrees')
    expect(worktreePath('/var/www/app', 'feature-a')).toBe('/var/www/app.worktrees/feature-a')
  })
})

describe('worktree manager', () => {
  it('creates a new worktree for a branch (scenario 1)', async () => {
    const deps = harness()
    const result = await createWorktree(deps, 'srv-1', { path: '/var/www/app' }, 'feature-a')
    expect(result.ok).toBe(true)
    expect(deps.calls.some((c) => c.includes('git worktree add'))).toBe(true)
  })

  it('reuses an existing worktree', async () => {
    const deps = harness(PORCELAIN)
    const result = await createWorktree(deps, 'srv-1', { path: '/var/www/app' }, 'feature-a')
    expect(result.ok).toBe(true)
    expect(deps.calls.some((c) => c.includes('git worktree add'))).toBe(false)
  })

  it('reports a branch checked out elsewhere as a conflict (scenario 5)', async () => {
    const deps = harness(PORCELAIN)
    const result = await createWorktree(deps, 'srv-1', { path: '/var/www/other' }, 'feature-a')
    expect(result.ok).toBe(false)
    expect(result.logs.join()).toContain('already checked out')
  })

  it('lists and removes worktrees', async () => {
    const listDeps = harness(PORCELAIN)
    expect(await listWorktrees(listDeps, 'srv-1', '/var/www/app')).toHaveLength(2)

    const removeDeps = harness()
    const removed = await removeWorktree(removeDeps, 'srv-1', '/var/www/app', 'feature-a')
    expect(removed.ok).toBe(true)
    expect(removeDeps.calls[0]).toContain('git worktree remove')
  })

  it('fails cleanly when add or remove errors', async () => {
    const addDeps = harness('', { failAdd: true })
    expect((await createWorktree(addDeps, 'srv-1', { path: '/var/www/app' }, 'x')).ok).toBe(false)

    const removeDeps = harness('', { failRemove: true })
    expect((await removeWorktree(removeDeps, 'srv-1', '/var/www/app', 'x')).ok).toBe(false)
  })
})
