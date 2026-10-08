import { diffLines } from './diff'
import type { DiffLine } from './diff'

/** One row of a side-by-side diff: the old line (left) and new line (right). */
export interface SideBySideRow {
  left?: DiffLine
  right?: DiffLine
}

/**
 * Turn a unified line diff into aligned side-by-side rows. Deletion/addition
 * runs are paired index-by-index so a changed line sits opposite its
 * replacement instead of being stacked.
 */
export function toSideBySide(lines: DiffLine[]): SideBySideRow[] {
  const rows: SideBySideRow[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (line.type === 'equal') {
      rows.push({ left: line, right: line })
      index++
      continue
    }

    const deleted: DiffLine[] = []
    const added: DiffLine[] = []
    while (index < lines.length && lines[index].type !== 'equal') {
      const current = lines[index]
      if (current.type === 'del') deleted.push(current)
      else added.push(current)
      index++
    }

    for (let i = 0; i < Math.max(deleted.length, added.length); i++) {
      rows.push({ left: deleted[i], right: added[i] })
    }
  }

  return rows
}

/** Build side-by-side rows straight from the two texts. */
export function sideBySideText(before: string, after: string): SideBySideRow[] {
  return toSideBySide(diffLines(before, after))
}
