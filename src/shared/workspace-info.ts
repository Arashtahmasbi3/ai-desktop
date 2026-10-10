/**
 * Remote workspace info (v2.3.3, A.1).
 *
 * The agent must know whether a project folder is a git repository before it
 * decides how to work (git diff/status/commit vs plain file tools). This shape
 * is shared so main, preload and renderer agree on what was detected.
 */

export interface RemoteWorkspaceInfo {
  /** Absolute project root on the remote host. */
  path: string
  isGitRepo: boolean
  gitBranch?: string
  gitRemote?: string
  gitDirty?: boolean
}

/** One-line badge for the chat header: a branch name or "No git". */
export function formatWorkspaceBadge(info: RemoteWorkspaceInfo | undefined): string {
  if (!info) return 'No git'
  if (!info.isGitRepo) return 'No git'
  const branch = info.gitBranch?.trim()
  return branch ? branch : '(detached)'
}

/** Tooltip: the remote, or an explicit hint that the repo is local-only. */
export function formatWorkspaceTooltip(info: RemoteWorkspaceInfo | undefined): string {
  if (!info) return 'Workspace not detected'
  if (!info.isGitRepo) return 'Not a git repository (plain file tools)'
  const remote = info.gitRemote?.trim()
  return remote ? remote : 'Local only'
}

/** Git project kinds with a bundled `.gitignore` template (v2.3.3, B.1). */
export type GitProjectType = 'node' | 'python' | 'generic'

/** Options chosen in the "Setup Git?" dialog (v2.3.3, B.1). */
export interface GitSetupOptions {
  init?: boolean
  gitignore?: boolean
  projectType?: GitProjectType | string
  commit?: boolean
  push?: boolean
  remoteUrl?: string
}

/** Structured remote git status for the sidebar (v2.3.3, B.2). */
export interface RemoteGitStatus {
  branch: string
  changes: number
  ahead: number
  behind: number
  clean: boolean
}

/** Result of an approved git-setup / install run (v2.3.3). */
export interface RemoteCommandRun {
  ran: string[]
  output: string
}
