import { execFile } from 'node:child_process'
import { dirname } from 'node:path'
import type { GitOpResult, GitRepoStatus, GitStatusFile } from '@shared/github'

export interface GitExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

export type GitExec = (args: string[], cwd: string) => Promise<GitExecResult>

/** Real git runner. Requires a `git` binary on PATH (the app is a Git client). */
export function createNodeGitExec(timeoutMs = 120_000): GitExec {
  return (args, cwd) =>
    new Promise((resolve) => {
      execFile(
        'git',
        args,
        { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
        (error, stdout, stderr) => {
          const code = (error as { code?: unknown } | null)?.code
          const exitCode = typeof code === 'number' ? code : error ? 1 : 0
          const err = String(stderr ?? '')
          resolve({
            stdout: String(stdout ?? ''),
            stderr: err || (error ? String(error.message) : ''),
            exitCode
          })
        }
      )
    })
}

/**
 * Parse `git status --porcelain=v1 --branch` output into a structured status.
 * Pure so it can be unit-tested without a repository.
 */
export function parseGitStatus(porcelain: string): {
  branch: string
  upstream?: string
  ahead: number
  behind: number
  clean: boolean
  files: GitStatusFile[]
} {
  const lines = porcelain.split('\n').filter((line) => line !== '')
  let branch = ''
  let upstream: string | undefined
  let ahead = 0
  let behind = 0
  const files: GitStatusFile[] = []
  let sawHeader = false

  for (const line of lines) {
    if (!sawHeader && line.startsWith('## ')) {
      sawHeader = true
      const header = line.slice(3)
      const [branchPart, trackingPart] = header.split('...')
      branch = branchPart.trim()
      if (trackingPart) {
        const [up, ...rest] = trackingPart.split(' ')
        if (up) upstream = up.trim()
        const bracket = rest.join(' ').match(/\[([^\]]+)\]/)
        if (bracket) {
          const aheadMatch = bracket[1].match(/ahead (\d+)/)
          const behindMatch = bracket[1].match(/behind (\d+)/)
          if (aheadMatch) ahead = Number(aheadMatch[1])
          if (behindMatch) behind = Number(behindMatch[1])
        }
      }
      continue
    }

    let path = line.slice(3)
    if (path.includes(' -> ')) path = path.split(' -> ').pop() ?? path
    files.push({ path, index: line[0] ?? ' ', workingDir: line[1] ?? ' ' })
  }

  return {
    branch,
    ...(upstream ? { upstream } : {}),
    ahead,
    behind,
    clean: files.length === 0,
    files
  }
}

export interface GitRunnerOptions {
  exec: GitExec
}

/** Thin wrapper over the `git` CLI for the repo operations the app exposes. */
export class GitRunner {
  private readonly exec: GitExec

  constructor(options: GitRunnerOptions) {
    this.exec = options.exec
  }

  async status(cwd: string): Promise<GitRepoStatus> {
    const result = await this.exec(['status', '--porcelain=v1', '--branch'], cwd)
    if (result.exitCode !== 0) {
      return {
        isRepo: false,
        branch: '',
        ahead: 0,
        behind: 0,
        clean: true,
        files: [],
        error: result.stderr.trim() || 'Not a git repository'
      }
    }
    const parsed = parseGitStatus(result.stdout)
    const root = await this.exec(['rev-parse', '--show-toplevel'], cwd)
    return {
      isRepo: true,
      ...parsed,
      ...(root.exitCode === 0 && root.stdout.trim() ? { root: root.stdout.trim() } : {})
    }
  }

  async clone(url: string, target: string): Promise<GitOpResult> {
    return this.run(['clone', url, target], dirname(target))
  }

  async pull(cwd: string): Promise<GitOpResult> {
    return this.run(['pull', '--ff-only'], cwd)
  }

  async push(cwd: string): Promise<GitOpResult> {
    return this.run(['push'], cwd)
  }

  async commit(cwd: string, input: { message: string; all?: boolean }): Promise<GitOpResult> {
    const message = input.message.trim()
    if (!message) return { ok: false, output: 'Commit message is required' }
    if (input.all) {
      const add = await this.run(['add', '-A'], cwd)
      if (!add.ok) return add
    }
    return this.run(['commit', '-m', message], cwd)
  }

  async checkout(cwd: string, branch: string, create = false): Promise<GitOpResult> {
    return create ? this.run(['checkout', '-b', branch], cwd) : this.run(['checkout', branch], cwd)
  }

  private async run(args: string[], cwd: string): Promise<GitOpResult> {
    const result = await this.exec(args, cwd)
    return {
      ok: result.exitCode === 0,
      output: `${result.stdout}${result.stderr}`.trim()
    }
  }
}
