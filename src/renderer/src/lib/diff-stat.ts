import { diffLines } from './diff'

export interface DiffStat {
  added: number
  removed: number
}

/** Count added/removed lines between two texts for the file-change summary. */
export function diffStat(before: string, after: string): DiffStat {
  let added = 0
  let removed = 0
  for (const line of diffLines(before, after)) {
    if (line.type === 'add') added += 1
    else if (line.type === 'del') removed += 1
  }
  return { added, removed }
}

export type FileKind = 'sql' | 'markdown' | 'json' | 'code' | 'other'

/** Coarse file kind used to pick an icon in the changes list. */
export function fileKind(path: string): FileKind {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'sql') return 'sql'
  if (ext === 'md' || ext === 'markdown') return 'markdown'
  if (ext === 'json') return 'json'
  if (
    ['ts', 'tsx', 'js', 'jsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'css', 'html', 'sh', 'yml', 'yaml'].includes(
      ext
    )
  ) {
    return 'code'
  }
  return 'other'
}
