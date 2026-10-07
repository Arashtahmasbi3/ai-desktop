export type DiffType = 'equal' | 'add' | 'del'

export interface DiffLine {
  type: DiffType
  text: string
  /** 1-based line number in the original text (absent for additions). */
  oldNo?: number
  /** 1-based line number in the new text (absent for deletions). */
  newNo?: number
}

const MAX_CELLS = 4_000_000

/**
 * Line-level diff using a longest-common-subsequence table. Falls back to a
 * whole-file replace for pathologically large inputs to bound memory/time.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n')
  const b = after.split('\n')

  if (a.length * b.length > MAX_CELLS) {
    return [
      ...a.map((text, index) => ({ type: 'del' as const, text, oldNo: index + 1 })),
      ...b.map((text, index) => ({ type: 'add' as const, text, newNo: index + 1 }))
    ]
  }

  // lcs[i][j] = LCS length of a[i:] and b[j:]
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0)
  )
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const result: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      result.push({ type: 'equal', text: a[i], oldNo: i + 1, newNo: j + 1 })
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      result.push({ type: 'del', text: a[i], oldNo: i + 1 })
      i++
    } else {
      result.push({ type: 'add', text: b[j], newNo: j + 1 })
      j++
    }
  }
  while (i < a.length) result.push({ type: 'del', text: a[i], oldNo: ++i })
  while (j < b.length) result.push({ type: 'add', text: b[j], newNo: ++j })

  return result
}

export interface DiffSummary {
  added: number
  removed: number
}

export function summarizeDiff(lines: DiffLine[]): DiffSummary {
  let added = 0
  let removed = 0
  for (const line of lines) {
    if (line.type === 'add') added++
    else if (line.type === 'del') removed++
  }
  return { added, removed }
}
