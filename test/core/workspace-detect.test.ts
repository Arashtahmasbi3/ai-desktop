import { describe, it, expect } from 'vitest'
import {
  detectWorkspace,
  gitProbeCommand,
  quotePath,
  type WorkspaceExec
} from '@core/remote/workspace-detect'

/**
 * Sprint v2.3.3 — Task A.1: automatic git detection on a remote host.
 */
function fakeExec(map: Record<string, { ok?: boolean; stdout: string }>): WorkspaceExec {
  return async (command: string) => {
    for (const [key, value] of Object.entries(map)) {
      if (command.includes(key)) {
        return { ok: value.ok ?? true, stdout: value.stdout }
      }
    }
    return { ok: false, stdout: '' }
  }
}

const PATH = '/srv/app'

describe('detectWorkspace (A.1)', () => {
  it('1. reports a git repo', async () => {
    const exec = fakeExec({
      'test -d': { stdout: 'yes\n' },
      'rev-parse': { stdout: 'main\n' },
      'remote get-url': { stdout: 'git@github.com:org/app.git\n' },
      'git status --porcelain': { stdout: '' }
    })
    const info = await detectWorkspace(exec, PATH)
    expect(info.isGitRepo).toBe(true)
    expect(info.path).toBe(PATH)
  })

  it('2. reports a non-git folder without asking git', async () => {
    const seen: string[] = []
    const exec: WorkspaceExec = async (command) => {
      seen.push(command)
      return { ok: true, stdout: 'no\n' }
    }
    const info = await detectWorkspace(exec, PATH)
    expect(info).toEqual({ path: PATH, isGitRepo: false })
    expect(seen).toHaveLength(1)
  })

  it('3. captures the origin remote', async () => {
    const exec = fakeExec({
      'test -d': { stdout: 'yes\n' },
      'rev-parse': { stdout: 'develop\n' },
      'remote get-url': { stdout: 'https://github.com/org/app.git\n' },
      'git status --porcelain': { stdout: '' }
    })
    const info = await detectWorkspace(exec, PATH)
    expect(info.gitRemote).toBe('https://github.com/org/app.git')
    expect(info.gitBranch).toBe('develop')
  })

  it('4. leaves gitRemote undefined when there is no origin', async () => {
    const exec = fakeExec({
      'test -d': { stdout: 'yes\n' },
      'rev-parse': { stdout: 'main\n' },
      'remote get-url': { ok: false, stdout: '' },
      'git status --porcelain': { stdout: '' }
    })
    const info = await detectWorkspace(exec, PATH)
    expect(info.isGitRepo).toBe(true)
    expect(info.gitRemote).toBeUndefined()
  })

  it('5. flags a dirty working tree', async () => {
    const exec = fakeExec({
      'test -d': { stdout: 'yes\n' },
      'rev-parse': { stdout: 'main\n' },
      'remote get-url': { stdout: '\n' },
      'git status --porcelain': { stdout: ' M src/index.ts\n?? new.txt\n' }
    })
    const info = await detectWorkspace(exec, PATH)
    expect(info.gitDirty).toBe(true)
  })

  it('6. reports a clean working tree', async () => {
    const exec = fakeExec({
      'test -d': { stdout: 'yes\n' },
      'rev-parse': { stdout: 'main\n' },
      'remote get-url': { stdout: 'origin\n' },
      'git status --porcelain': { stdout: '\n' }
    })
    const info = await detectWorkspace(exec, PATH)
    expect(info.gitDirty).toBe(false)
  })

  it('quotes the path and strips a trailing slash', () => {
    expect(gitProbeCommand('/srv/app')).toBe("test -d '/srv/app/.git' && echo yes || echo no")
    expect(quotePath("a'b")).toBe(`'a'\\''b'`)
  })
})
