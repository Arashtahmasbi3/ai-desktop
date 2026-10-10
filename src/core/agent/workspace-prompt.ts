/**
 * Dynamic workspace system hint (v2.3.3, A.2).
 *
 * The model must know whether git is available before it picks a workflow:
 * with git it can rely on status/diff/commit, without it those commands fail and
 * it should fall back to plain file tools and manual backups.
 */

import type { RemoteWorkspaceInfo } from '@shared/workspace-info'

/**
 * Build the `# Workspace` hint appended to the system prompt. Deterministic and
 * pure so it can be asserted in tests without an LLM.
 */
export function buildWorkspaceSystemHint(workspace: RemoteWorkspaceInfo): string {
  const base = `You are working on the project at ${workspace.path}.`

  if (workspace.isGitRepo) {
    const branch = workspace.gitBranch?.trim() || '(detached HEAD)'
    const remote = workspace.gitRemote?.trim() || 'none'
    return `${base}

GIT IS AVAILABLE.
- Branch: ${branch}
- Remote: ${remote}
- Workflow: use git diff/status/commit to review and record changes.
- Before editing: check git status.
- After editing: show the diff.`
  }

  return `${base}

GIT IS NOT AVAILABLE.
- DO NOT run git commands (they will fail).
- Use: ls, cat, head, tail, grep, find, echo, pwd.
- For edits: back up first (cp <file> <file>.backup-<date>).
- Before overwriting: read the file.
- For version control: suggest \`git init\` to the user.`
}
