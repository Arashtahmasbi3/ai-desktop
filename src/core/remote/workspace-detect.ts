/**
 * Detect whether a remote project folder is a git repository (v2.3.3, A.1).
 *
 * All work goes through an injected `exec`, so the detection is testable without
 * SSH and reusable for local shells later. Paths are POSIX-quoted so a project
 * path can never break out of the detection commands.
 */

import type { RemoteWorkspaceInfo } from '@shared/workspace-info'

export interface WorkspaceExecResult {
  ok: boolean
  stdout: string
  stderr?: string
  exitCode?: number
}

export type WorkspaceExec = (command: string) => Promise<WorkspaceExecResult>

/** POSIX single-quote so a path can't inject into a command. */
export function quotePath(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** `yes`/`no` probe for a `.git` directory. */
export function gitProbeCommand(path: string): string {
  const dir = quotePath(`${path.replace(/\/+$/, '')}/.git`)
  return `test -d ${dir} && echo yes || echo no`
}

export function branchCommand(path: string): string {
  return `cd ${quotePath(path)} && git rev-parse --abbrev-ref HEAD 2>/dev/null`
}

export function remoteCommand(path: string): string {
  return `cd ${quotePath(path)} && git remote get-url origin 2>/dev/null`
}

export function dirtyCommand(path: string): string {
  return `cd ${quotePath(path)} && git status --porcelain 2>/dev/null`
}

/**
 * Detect a remote workspace. Runs the cheap `test -d .git` probe first and only
 * asks git for branch/remote/dirty when it is a repo, so a non-repo folder costs
 * a single round-trip.
 */
export async function detectWorkspace(
  exec: WorkspaceExec,
  path: string
): Promise<RemoteWorkspaceInfo> {
  const probe = await exec(gitProbeCommand(path))
  const isGit = probe.ok && probe.stdout.trim().split('\n').pop()?.trim() === 'yes'
  if (!isGit) return { path, isGitRepo: false }

  const [branch, remote, dirty] = await Promise.all([
    exec(branchCommand(path)),
    exec(remoteCommand(path)),
    exec(dirtyCommand(path))
  ])

  const branchName = branch.ok ? branch.stdout.trim() : ''
  const remoteUrl = remote.ok ? remote.stdout.trim() : ''
  const dirtyOutput = dirty.ok ? dirty.stdout : ''

  return {
    path,
    isGitRepo: true,
    ...(branchName ? { gitBranch: branchName } : {}),
    ...(remoteUrl ? { gitRemote: remoteUrl } : {}),
    gitDirty: dirtyOutput.trim().length > 0
  }
}
