/**
 * Git worktree support (v2.4, C.3).
 *
 * Worktrees let the agent work on several branches of one repository in parallel
 * without cloning it. Every command is injected so this stays testable and `core`
 * keeps no node imports.
 */

import type { VpsExecResult } from '@shared/vps'
import { shellQuote } from '../tools/remote-fs-tools'

export interface WorktreeDeps {
  exec(serverId: string, command: string): Promise<VpsExecResult>
}

export interface Worktree {
  path: string
  branch?: string
  head?: string
  detached?: boolean
  locked?: boolean
}

export interface WorktreeResult {
  ok: boolean
  path?: string
  branch?: string
  logs: string[]
}

const BRANCH_RE = /^[a-zA-Z0-9][a-zA-Z0-9._\/-]*$/

export function isValidBranch(branch: string): boolean {
  if (!BRANCH_RE.test(branch)) return false
  return !branch.includes('..') && !branch.endsWith('.lock') && !branch.endsWith('/')
}

export function worktreesRoot(projectPath: string): string {
  return `${projectPath.replace(/\/+$/, '')}.worktrees`
}

export function worktreePath(projectPath: string, branch: string): string {
  return `${worktreesRoot(projectPath)}/${branch}`
}

/** Parse `git worktree list --porcelain` into structured entries. */
export function parseWorktreeList(stdout: string): Worktree[] {
  const entries: Worktree[] = []
  for (const block of stdout.split(/\n\s*\n/)) {
    const lines = block
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    if (lines.length === 0) continue
    const entry: Worktree = { path: '' }
    for (const line of lines) {
      if (line.startsWith('worktree ')) entry.path = line.slice('worktree '.length)
      else if (line.startsWith('branch refs/heads/')) entry.branch = line.slice('branch refs/heads/'.length)
      else if (line.startsWith('HEAD ')) entry.head = line.slice('HEAD '.length)
      else if (line === 'detached') entry.detached = true
      else if (line.startsWith('locked')) entry.locked = true
    }
    if (entry.path) entries.push(entry)
  }
  return entries
}

function first(result: VpsExecResult): string {
  return [result.stdout, result.stderr].filter((part) => part.trim().length > 0).join('\n').trim()
}

export async function listWorktrees(
  deps: WorktreeDeps,
  serverId: string,
  projectPath: string
): Promise<Worktree[]> {
  const result = await deps.exec(serverId, `cd ${shellQuote(projectPath)} && git worktree list --porcelain`)
  if (!result.ok) return []
  return parseWorktreeList(result.stdout)
}

export async function createWorktree(
  deps: WorktreeDeps,
  serverId: string,
  project: { path: string },
  branch: string
): Promise<WorktreeResult> {
  if (!isValidBranch(branch)) {
    return { ok: false, logs: [`Invalid branch name: ${branch}`] }
  }
  const path = worktreePath(project.path, branch)

  const existing = await listWorktrees(deps, serverId, project.path)
  const match = existing.find((entry) => entry.path === path || entry.branch === branch)
  if (match) {
    // Conflict: the branch is already checked out somewhere.
    if (match.branch === branch && match.path !== path) {
      return { ok: false, logs: [`Branch ${branch} is already checked out at ${match.path}`] }
    }
    return { ok: true, path, branch, logs: [`Worktree already exists at ${path}`] }
  }

  const create = await deps.exec(
    serverId,
    `cd ${shellQuote(project.path)} && git worktree add ${shellQuote(path)} ${shellQuote(branch)}`
  )
  if (!create.ok) {
    return { ok: false, logs: [`git worktree add failed: ${first(create)}`] }
  }
  return { ok: true, path, branch, logs: [`Created worktree ${path} for ${branch}`] }
}

export async function removeWorktree(
  deps: WorktreeDeps,
  serverId: string,
  projectPath: string,
  branch: string
): Promise<WorktreeResult> {
  if (!isValidBranch(branch)) {
    return { ok: false, logs: [`Invalid branch name: ${branch}`] }
  }
  const path = worktreePath(projectPath, branch)
  const result = await deps.exec(
    serverId,
    `cd ${shellQuote(projectPath)} && git worktree remove ${shellQuote(path)}`
  )
  if (!result.ok) {
    return { ok: false, logs: [`git worktree remove failed: ${first(result)}`] }
  }
  return { ok: true, path, branch, logs: [`Removed worktree ${path}`] }
}
