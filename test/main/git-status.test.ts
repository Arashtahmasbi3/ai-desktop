import { describe, it, expect } from 'vitest'
import { GitRunner, parseGitStatus, type GitExec } from '../../src/main/github/git'

describe('parseGitStatus', () => {
  it('parses branch, upstream and ahead/behind', () => {
    const parsed = parseGitStatus(
      '## main...origin/main [ahead 1, behind 2]\n M src/app.ts\n?? notes.txt\n'
    )
    expect(parsed.branch).toBe('main')
    expect(parsed.upstream).toBe('origin/main')
    expect(parsed.ahead).toBe(1)
    expect(parsed.behind).toBe(2)
    expect(parsed.clean).toBe(false)
    expect(parsed.files).toEqual([
      { path: 'src/app.ts', index: ' ', workingDir: 'M' },
      { path: 'notes.txt', index: '?', workingDir: '?' }
    ])
  })

  it('treats an empty porcelain output as clean', () => {
    expect(parseGitStatus('## main...origin/main\n')).toMatchObject({
      clean: true,
      files: []
    })
  })

  it('uses the destination path for renames', () => {
    const parsed = parseGitStatus('## main\nR  old.ts -> new.ts\n')
    expect(parsed.files[0]).toMatchObject({ path: 'new.ts', index: 'R' })
  })

  it('handles a repo with no upstream or commits', () => {
    expect(parseGitStatus('## No commits yet on main\n')).toMatchObject({
      branch: 'No commits yet on main',
      ahead: 0,
      behind: 0
    })
  })
})

describe('GitRunner', () => {
  const exec = (results: Array<{ stdout?: string; stderr?: string; exitCode?: number }>): GitExec => {
    let index = 0
    return async (args) => {
      const argsText = args.join(' ')
      const result = results[index++] ?? {}
      return {
        stdout: result.stdout ?? `ran: ${argsText}`,
        stderr: result.stderr ?? '',
        exitCode: result.exitCode ?? 0
      }
    }
  }

  it('reports a non-repository when git status fails', async () => {
    const runner = new GitRunner({
      exec: exec([{ exitCode: 128, stderr: 'fatal: not a git repository' }])
    })
    await expect(runner.status('/tmp/nope')).resolves.toMatchObject({
      isRepo: false,
      error: 'fatal: not a git repository'
    })
  })

  it('returns a structured status and repo root', async () => {
    const runner = new GitRunner({
      exec: exec([
        { stdout: '## main...origin/main [ahead 3]\n M a.txt\n' },
        { stdout: '/work/repo\n' }
      ])
    })
    await expect(runner.status('/work/repo')).resolves.toMatchObject({
      isRepo: true,
      branch: 'main',
      ahead: 3,
      root: '/work/repo',
      files: [{ path: 'a.txt', index: ' ', workingDir: 'M' }]
    })
  })

  it('rejects an empty commit message without running git', async () => {
    const runner = new GitRunner({ exec: exec([{ stdout: 'should not run' }]) })
    await expect(runner.commit('/repo', { message: '   ' })).resolves.toEqual({
      ok: false,
      output: 'Commit message is required'
    })
  })

  it('stages everything before committing when asked', async () => {
    const calls: string[] = []
    const runner = new GitRunner({
      exec: async (args) => {
        calls.push(args.join(' '))
        return { stdout: '', stderr: '', exitCode: 0 }
      }
    })
    const result = await runner.commit('/repo', { message: 'feat: x', all: true })
    expect(result.ok).toBe(true)
    expect(calls).toEqual(['add -A', 'commit -m feat: x'])
  })
})
