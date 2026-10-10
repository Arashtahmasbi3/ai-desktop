import { describe, it, expect } from 'vitest'
import { formatGitStatusLabel, parseRemoteGitStatus } from '@core/remote/git-status'

/**
 * Sprint v2.3.3 — Task B.2: parse remote git status for the sidebar panel.
 */
describe('parseRemoteGitStatus (B.2)', () => {
  it('1. clean repo → no changes', () => {
    const status = parseRemoteGitStatus('## main...origin/main\n')
    expect(status.branch).toBe('main')
    expect(status.clean).toBe(true)
    expect(status.changes).toBe(0)
  })

  it('2. dirty repo → counts changed files', () => {
    const status = parseRemoteGitStatus(
      '## main...origin/main\n M src/a.ts\n?? b.txt\n M c.md\n'
    )
    expect(status.changes).toBe(3)
    expect(status.clean).toBe(false)
  })

  it('3. ahead → ↑N', () => {
    const status = parseRemoteGitStatus('## main...origin/main [ahead 2]\n')
    expect(status.ahead).toBe(2)
    expect(status.behind).toBe(0)
    expect(formatGitStatusLabel(status)).toContain('↑2')
  })

  it('4. behind → ↓N', () => {
    const status = parseRemoteGitStatus('## main...origin/main [behind 3]\n')
    expect(status.behind).toBe(3)
    expect(formatGitStatusLabel(status)).toContain('↓3')
  })

  it('ahead and behind together, plus a change', () => {
    const status = parseRemoteGitStatus('## dev...origin/dev [ahead 1, behind 4]\n M x\n')
    expect(status).toMatchObject({ branch: 'dev', ahead: 1, behind: 4, changes: 1 })
    expect(formatGitStatusLabel(status)).toBe('dev · 1 change · ↑1 · ↓4')
  })

  it('handles a detached HEAD header', () => {
    const status = parseRemoteGitStatus('## HEAD (no branch)\n')
    expect(status.branch).toBe('HEAD (no branch)')
  })
})
