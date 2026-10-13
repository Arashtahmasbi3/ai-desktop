import { useMemo } from 'react'
import type { SideBySideRow } from '../lib/split-diff'
import { sideBySideText } from '../lib/split-diff'
import HighlightedLine from './Highlighted'

interface DiffViewerProps {
  before: string
  after: string
  language: string
}

const CELL_CLASS = 'flex-1 overflow-hidden px-2 whitespace-pre'

function cellClass(kind: 'del' | 'add' | 'equal' | 'empty'): string {
  if (kind === 'del') return `${CELL_CLASS} bg-red-500/10`
  if (kind === 'add') return `${CELL_CLASS} bg-emerald-500/10`
  if (kind === 'empty') return `${CELL_CLASS} bg-bg-secondary/60`
  return CELL_CLASS
}

/**
 * Side-by-side (split) diff. The old file is on the left, the new on the right;
 * a changed line appears opposite its replacement with its own background tint.
 */
export default function DiffViewer({ before, after, language }: DiffViewerProps): JSX.Element {
  const rows = useMemo(() => sideBySideText(before, after), [before, after])

  return (
    <div className="min-h-0 flex-1 overflow-auto font-mono text-xs" dir="ltr">
      <div className="flex border-b border-border bg-bg-secondary text-3xs uppercase tracking-wide text-neutral-500">
        <div className="flex flex-1 gap-2 px-2 py-1">
          <span className="w-8 text-right">old</span>
          <span>before</span>
        </div>
        <div className="w-px bg-border" />
        <div className="flex flex-1 gap-2 px-2 py-1">
          <span className="w-8 text-right">new</span>
          <span>after</span>
        </div>
      </div>

      {rows.map((row, index) => (
        <div key={index} className="flex border-b border-border/40 last:border-b-0">
          <Side row={row.left} side="left" language={language} />
          <div className="w-px shrink-0 bg-border" />
          <Side row={row.right} side="right" language={language} />
        </div>
      ))}
    </div>
  )
}

function Side({
  row,
  side,
  language
}: {
  row?: SideBySideRow['left']
  side: 'left' | 'right'
  language: string
}): JSX.Element {
  if (!row) {
    return (
      <div className={cellClass('empty')}>
        <span className="w-8 shrink-0 select-none pr-2 text-right text-neutral-700"> </span>
      </div>
    )
  }

  const number = side === 'left' ? row.oldNo : row.newNo
  const kind = side === 'left' ? (row.type === 'del' ? 'del' : 'equal') : row.type === 'add' ? 'add' : 'equal'
  const marker = kind === 'del' ? '-' : kind === 'add' ? '+' : ' '

  return (
    <div className={cellClass(kind)}>
      <span className="w-8 shrink-0 select-none pr-2 text-right text-neutral-600">
        {number ?? ''}
      </span>
      <span
        className={`w-3 shrink-0 ${
          kind === 'del' ? 'text-red-400' : kind === 'add' ? 'text-emerald-400' : 'text-neutral-700'
        }`}
      >
        {marker}
      </span>
      <span className="whitespace-pre text-neutral-200">
        <HighlightedLine text={row.text} language={language} />
      </span>
    </div>
  )
}
