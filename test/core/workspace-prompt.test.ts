import { describe, it, expect } from 'vitest'
import { buildWorkspaceSystemHint } from '@core/agent/workspace-prompt'
import type { RemoteWorkspaceInfo } from '@shared/workspace-info'

/**
 * Sprint v2.3.3 — Task A.2: the system prompt adapts to git availability.
 */
describe('buildWorkspaceSystemHint (A.2)', () => {
  it('1. tells the model git is available', () => {
    const hint = buildWorkspaceSystemHint({
      path: '/srv/app',
      isGitRepo: true,
      gitBranch: 'main',
      gitRemote: 'git@github.com:org/app.git',
      gitDirty: false
    })
    expect(hint).toContain('GIT IS AVAILABLE')
    expect(hint).not.toContain('GIT IS NOT AVAILABLE')
  })

  it('2. tells the model git is not available', () => {
    const hint = buildWorkspaceSystemHint({ path: '/srv/app', isGitRepo: false })
    expect(hint).toContain('GIT IS NOT AVAILABLE')
    expect(hint).toContain('git init')
    expect(hint).not.toContain('GIT IS AVAILABLE')
  })

  it('3. includes the branch name', () => {
    const hint = buildWorkspaceSystemHint({
      path: '/srv/app',
      isGitRepo: true,
      gitBranch: 'feature/x'
    })
    expect(hint).toContain('Branch: feature/x')
  })

  it('4. includes the remote or "none"', () => {
    const withRemote = buildWorkspaceSystemHint({
      path: '/srv/app',
      isGitRepo: true,
      gitBranch: 'main',
      gitRemote: 'https://github.com/org/app.git'
    })
    expect(withRemote).toContain('Remote: https://github.com/org/app.git')

    const withoutRemote: RemoteWorkspaceInfo = {
      path: '/srv/app',
      isGitRepo: true,
      gitBranch: 'main'
    }
    expect(buildWorkspaceSystemHint(withoutRemote)).toContain('Remote: none')
  })
})
