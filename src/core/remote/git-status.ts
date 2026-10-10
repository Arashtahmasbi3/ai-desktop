/**
 * Parse `git status --porcelain=v1 --branch` for a remote repo (v2.3.3, B.2).
 *
 * Pure: the sidebar gets a small, structured status and the 30-second refresh
 * just re-parses. Kept separate from the local `GitRunner` (which imports
 * `node:child_process`) so `core` stays free of main-process imports.
 */

import { quotePath } from './workspace-detect'
import type { RemoteGitStatus } from '@shared/workspace-info'

export type { RemoteGitStatus } from '@shared/workspace-info'

export function remoteGitStatusCommand(path: string): string {
  return `cd ${quotePath(path)} && git status --porcelain=v1 --branch 2>/dev/null`
}

export function parseRemoteGitStatus(porcelain: string): RemoteGitStatus {
  const lines = porcelain.split('\n').filter((line) => line !== '')
  let branch = ''
  let ahead = 0
  let behind = 0
  let changes = 0

  for (const line of lines) {
    if (line.startsWith('## ')) {
      const header = line.slice(3)
      const [branchPart, trackingPart] = header.split('...')
      branch = (branchPart ?? '').trim()
      if (trackingPart) {
        const bracket = trackingPart.match(/\[([^\]]+)\]/)
        if (bracket) {
          const aheadMatch = bracket[1].match(/ahead (\d+)/)
          const behindMatch = bracket[1].match(/behind (\d+)/)
          if (aheadMatch) ahead = Number(aheadMatch[1])
          if (behindMatch) behind = Number(behindMatch[1])
        }
      }
      continue
    }
    changes += 1
  }

  return { branch, changes, ahead, behind, clean: changes === 0 }
}

/** Compact sidebar label: `main · 3 changes · ↑2 ↓1`. */
export function formatGitStatusLabel(status: RemoteGitStatus): string {
  const parts: string[] = [status.branch || '(detached)']
  parts.push(status.changes === 0 ? 'clean' : `${status.changes} change${status.changes === 1 ? '' : 's'}`)
  if (status.ahead > 0) parts.push(`↑${status.ahead}`)
  if (status.behind > 0) parts.push(`↓${status.behind}`)
  return parts.join(' · ')
}
