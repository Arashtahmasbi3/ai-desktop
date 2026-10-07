import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Code2,
  Eye,
  FileWarning,
  Pencil,
  Save,
  Search,
  Undo2,
  X
} from 'lucide-react'
import { diffLines, summarizeDiff } from '../lib/diff'
import { languageOf, tokenClassName, tokenize } from '../lib/highlight'
import { useStore } from '../store'

function HighlightedLine({ text, language }: { text: string; language: string }): JSX.Element {
  const tokens = useMemo(() => tokenize(text, language), [text, language])
  return (
    <>
      {tokens.map((token, index) => (
        <span key={index} className={tokenClassName(token.type)}>
          {token.text}
        </span>
      ))}
    </>
  )
}

/** Case-insensitive match ranges within a line. */
function matchRanges(line: string, query: string): Array<[number, number]> {
  if (!query) return []
  const ranges: Array<[number, number]> = []
  const haystack = line.toLowerCase()
  const needle = query.toLowerCase()
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    ranges.push([index, index + needle.length])
    index = haystack.indexOf(needle, index + needle.length)
  }
  return ranges
}

export default function CodeViewer(): JSX.Element {
  const selectedFile = useStore((state) => state.selectedFile)
  const fileContent = useStore((state) => state.fileContent)
  const draft = useStore((state) => state.draft)
  const saving = useStore((state) => state.saving)
  const setDraft = useStore((state) => state.setDraft)
  const saveFile = useStore((state) => state.saveFile)
  const discardDraft = useStore((state) => state.discardDraft)
  const openFile = useStore((state) => state.openFile)

  const [editing, setEditing] = useState(false)
  const [query, setQuery] = useState('')
  const [matchIndex, setMatchIndex] = useState(0)
  const bodyRef = useRef<HTMLDivElement>(null)
  const matchRefs = useRef<Array<HTMLDivElement | null>>([])

  const language = selectedFile ? languageOf(selectedFile) : 'plain'
  const lines = (draft ?? fileContent).split('\n')
  const changed = draft !== null && draft !== fileContent
  const diff = useMemo(
    () => (changed ? diffLines(fileContent, draft) : []),
    [changed, fileContent, draft]
  )
  const summary = useMemo(() => summarizeDiff(diff), [diff])

  const matchLines = useMemo(() => {
    if (!query.trim()) return []
    const result: number[] = []
    lines.forEach((line, index) => {
      if (line.toLowerCase().includes(query.toLowerCase())) result.push(index)
    })
    return result
  }, [lines, query])

  useEffect(() => {
    matchRefs.current = []
    setMatchIndex(0)
  }, [query, selectedFile])

  useEffect(() => {
    const lineIndex = matchLines[matchIndex]
    if (lineIndex === undefined) return
    matchRefs.current[lineIndex]?.scrollIntoView({ block: 'center' })
  }, [matchIndex, matchLines])

  if (!selectedFile) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-bg-primary text-neutral-600">
        <Code2 className="h-8 w-8" />
        <p className="text-xs">برای مشاهده، یک فایل را از Workspace انتخاب کنید.</p>
      </div>
    )
  }

  const jump = (delta: number): void => {
    if (matchLines.length === 0) return
    setMatchIndex((current) => (current + delta + matchLines.length) % matchLines.length)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-primary">
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-border px-2 text-[11px]">
        <span className="truncate font-mono text-neutral-400" dir="ltr" title={selectedFile}>
          {selectedFile}
          {changed ? <span className="ml-2 text-amber-400">● modified</span> : null}
        </span>
        <div className="flex items-center gap-1">
          {editing ? (
            <>
              <button
                type="button"
                onClick={() => void saveFile()}
                disabled={!changed || saving}
                className="flex items-center gap-1 rounded bg-accent px-2 py-0.5 text-white hover:bg-accent-hover disabled:opacity-40"
              >
                <Save className="h-3 w-3" />
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={!changed}
                title="Preview diff"
                className="flex items-center gap-1 rounded px-2 py-0.5 text-neutral-400 hover:bg-bg-tertiary disabled:opacity-30"
              >
                <Eye className="h-3 w-3" />
                Diff
              </button>
              <button
                type="button"
                onClick={() => {
                  discardDraft()
                  setEditing(false)
                }}
                className="flex items-center gap-1 rounded px-2 py-0.5 text-neutral-400 hover:bg-bg-tertiary"
              >
                <Undo2 className="h-3 w-3" />
                Discard
              </button>
            </>
          ) : draft !== null ? (
            <>
              <button
                type="button"
                onClick={() => void saveFile()}
                disabled={saving}
                className="flex items-center gap-1 rounded bg-accent px-2 py-0.5 text-white hover:bg-accent-hover disabled:opacity-40"
              >
                <Save className="h-3 w-3" />
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditing(true)}
                title="Back to editor"
                className="flex items-center gap-1 rounded px-2 py-0.5 text-neutral-400 hover:bg-bg-tertiary"
              >
                <Pencil className="h-3 w-3" />
                Edit
              </button>
              <button
                type="button"
                onClick={discardDraft}
                className="flex items-center gap-1 rounded px-2 py-0.5 text-neutral-400 hover:bg-bg-tertiary"
              >
                <Undo2 className="h-3 w-3" />
                Discard
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="flex items-center gap-1 rounded px-2 py-0.5 text-neutral-400 hover:bg-bg-tertiary hover:text-neutral-200"
            >
              <Pencil className="h-3 w-3" />
              Edit
            </button>
          )}
          <button
            type="button"
            onClick={() => void openFile(selectedFile)}
            title="Close"
            className="rounded p-0.5 text-neutral-500 hover:bg-bg-tertiary hover:text-neutral-200"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>

      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-2">
        <div className="relative flex-1">
          <Search className="absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-neutral-600" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search in file…"
            className="w-full rounded border border-border bg-bg-secondary py-0.5 pr-7 pl-2 text-[11px] text-neutral-200 outline-none focus:border-accent/50"
          />
        </div>
        {query ? (
          <div className="flex items-center gap-1 text-[10px] text-neutral-500">
            <span>
              {matchLines.length === 0 ? 0 : matchIndex + 1}/{matchLines.length}
            </span>
            <button type="button" onClick={() => jump(-1)} className="rounded p-0.5 hover:bg-bg-tertiary">
              <ChevronUp className="h-3 w-3" />
            </button>
            <button type="button" onClick={() => jump(1)} className="rounded p-0.5 hover:bg-bg-tertiary">
              <ChevronDown className="h-3 w-3" />
            </button>
          </div>
        ) : null}
        {changed ? (
          <span className="flex items-center gap-1 text-[10px]">
            <span className="text-emerald-400">+{summary.added}</span>
            <span className="text-red-400">-{summary.removed}</span>
          </span>
        ) : null}
      </div>

      {editing ? (
        <textarea
          value={draft ?? fileContent}
          onChange={(event) => setDraft(event.target.value)}
          dir="ltr"
          spellCheck={false}
          className="min-h-0 flex-1 resize-none bg-bg-primary p-3 font-mono text-xs text-neutral-200 outline-none"
        />
      ) : changed ? (
        <div ref={bodyRef} className="min-h-0 flex-1 overflow-auto font-mono text-xs">
          {diff.map((line, index) => (
            <div
              key={index}
              className={`flex px-2 ${
                line.type === 'add'
                  ? 'bg-emerald-500/10'
                  : line.type === 'del'
                    ? 'bg-red-500/10'
                    : ''
              }`}
            >
              <span className="w-10 shrink-0 select-none pr-2 text-right text-neutral-600">
                {line.oldNo ?? ''}
              </span>
              <span className="w-10 shrink-0 select-none pr-2 text-right text-neutral-600">
                {line.newNo ?? ''}
              </span>
              <span className={`w-3 shrink-0 ${line.type === 'add' ? 'text-emerald-400' : line.type === 'del' ? 'text-red-400' : 'text-neutral-700'}`}>
                {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
              </span>
              <span className="whitespace-pre text-neutral-200">
                <HighlightedLine text={line.text} language={language} />
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div ref={bodyRef} className="min-h-0 flex-1 overflow-auto font-mono text-xs">
          {lines.map((line, index) => {
            const isMatch = matchLines.includes(index)
            const isCurrent = matchLines[matchIndex] === index
            return (
              <div
                key={index}
                ref={(node) => {
                  matchRefs.current[index] = node
                }}
                className={`flex px-2 ${
                  isCurrent ? 'bg-amber-500/20' : isMatch ? 'bg-amber-500/10' : ''
                }`}
              >
                <span className="w-10 shrink-0 select-none pr-2 text-right text-neutral-600">
                  {index + 1}
                </span>
                <span className="whitespace-pre text-neutral-200">
                  {query && isMatch
                    ? renderWithMatches(line, query)
                    : <HighlightedLine text={line} language={language} />}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {draft !== null && !editing ? (
        <div className="flex shrink-0 items-center gap-2 border-t border-border bg-bg-secondary px-3 py-1 text-[11px] text-amber-400">
          <FileWarning className="h-3 w-3" />
          Unsaved changes — preview shows a diff against the file on disk.
        </div>
      ) : null}
    </div>
  )
}

function renderWithMatches(line: string, query: string): JSX.Element {
  const ranges = matchRanges(line, query)
  const parts: JSX.Element[] = []
  let cursor = 0
  ranges.forEach(([start, end], index) => {
    if (start > cursor) parts.push(<span key={`t-${index}`}>{line.slice(cursor, start)}</span>)
    parts.push(
      <mark key={`m-${index}`} className="rounded bg-amber-500/40 text-neutral-100">
        {line.slice(start, end)}
      </mark>
    )
    cursor = end
  })
  if (cursor < line.length) parts.push(<span key="tail">{line.slice(cursor)}</span>)
  return <>{parts}</>
}
