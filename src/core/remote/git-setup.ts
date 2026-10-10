/**
 * Auto git setup for new remote projects (v2.3.3, B.1).
 *
 * Builds the ordered command list the user confirms in the "Setup Git?" dialog.
 * Pure so the exact commands can be asserted in tests — nothing here runs by
 * itself; the caller sends each command through the guarded remote shell.
 */

import { quotePath } from './workspace-detect'
import type { GitProjectType, GitSetupOptions } from '@shared/workspace-info'

export type { GitProjectType, GitSetupOptions } from '@shared/workspace-info'

export const GITIGNORE_TEMPLATES: Readonly<Record<GitProjectType, string>> = {
  node: ['node_modules/', 'dist/', '.env', '*.log', '.DS_Store'].join('\n'),
  python: ['__pycache__/', '*.pyc', '.env', 'venv/', '*.log'].join('\n'),
  generic: ['.env', '*.log', '.DS_Store', '*.tmp'].join('\n')
}

export function getGitignoreTemplate(type: GitProjectType | string | undefined): string {
  const key = (type ?? 'generic') as GitProjectType
  return GITIGNORE_TEMPLATES[key] ?? GITIGNORE_TEMPLATES.generic
}

/** Build a heredoc that writes the .gitignore without a temp file. */
export function gitignoreCommand(path: string, type: GitProjectType | string | undefined): string {
  const body = getGitignoreTemplate(type)
  const file = `${path.replace(/\/+$/, '')}/.gitignore`
  return `cat > ${quotePath(file)} << 'AI_DESKTOP_EOF'\n${body}\nAI_DESKTOP_EOF`
}

/**
 * The ordered, shell-ready commands for the chosen options. `[Skip]` yields an
 * empty list, so callers never need a special case.
 */
export function buildGitSetupCommands(path: string, options: GitSetupOptions): string[] {
  const root = quotePath(path)
  const commands: string[] = []

  if (options.init) commands.push(`cd ${root} && git init`)
  if (options.gitignore) commands.push(gitignoreCommand(path, options.projectType))
  if (options.commit) {
    commands.push(`cd ${root} && git add -A && git commit -m 'Initial commit'`)
  }
  if (options.push && options.remoteUrl) {
    commands.push(`cd ${root} && git remote add origin ${quotePath(options.remoteUrl)}`)
    commands.push(`cd ${root} && git push -u origin HEAD`)
  }
  return commands
}
