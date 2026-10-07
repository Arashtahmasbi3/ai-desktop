import { useMemo } from 'react'
import {
  ArrowRight,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  RefreshCw,
  Search
} from 'lucide-react'
import { useState } from 'react'
import type { FileEntry } from '@shared/ui'
import { useStore } from '../store'

function iconFor(entry: FileEntry): JSX.Element {
  if (entry.type === 'dir') return <Folder className="h-4 w-4 text-sky-400/80" />
  const codeExt = /\.(ts|tsx|js|jsx|py|go|rs|java|c|cpp|h|css|scss|html|json|yml|yaml|sh)$/i
  if (codeExt.test(entry.name)) return <FileCode2 className="h-4 w-4 text-emerald-400/80" />
  return <FileText className="h-4 w-4 text-neutral-500" />
}

export default function FileExplorer(): JSX.Element {
  const entries = useStore((state) => state.entries)
  const cwd = useStore((state) => state.cwd)
  const selectedFile = useStore((state) => state.selectedFile)
  const settings = useStore((state) => state.settings)
  const refreshFiles = useStore((state) => state.refreshFiles)
  const openFile = useStore((state) => state.openFile)
  const openProject = useStore((state) => state.openProject)
  const [query, setQuery] = useState('')

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return entries
    return entries.filter((entry) => entry.name.toLowerCase().includes(needle))
  }, [entries, query])

  const projects = settings?.projects ?? []
  const activeProject = projects.find((project) => project.id === settings?.activeProjectId)

  const goUp = (): void => {
    const parts = cwd.split('/').filter((part) => part && part !== '.')
    parts.pop()
    void refreshFiles(parts.length > 0 ? parts.join('/') : '.')
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-bg-primary">
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-border px-3 text-[11px] text-neutral-500">
        <span className="flex items-center gap-1">
          <FolderOpen className="h-3.5 w-3.5" />
          Workspace
        </span>
        <button
          type="button"
          onClick={() => void refreshFiles()}
          title="Refresh"
          className="rounded p-0.5 hover:bg-bg-tertiary hover:text-neutral-300"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
          <Folder className="h-8 w-8 text-neutral-600" />
          <p className="text-xs text-neutral-500">
            هیچ پروژه‌ای اضافه نشده. از Settings یک پوشه پروژه اضافه کنید یا یک پوشه را روی پنجره
            رها کنید (Drag &amp; Drop).
          </p>
        </div>
      ) : (
        <>
          <div className="shrink-0 border-b border-border p-2">
            <select
              value={settings?.activeProjectId ?? ''}
              onChange={(event) => void openProject(event.target.value)}
              className="mb-2 w-full rounded border border-border bg-bg-secondary px-2 py-1 text-xs text-neutral-200 outline-none focus:border-accent/50"
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={goUp}
                disabled={cwd === '.'}
                title="Up one level"
                className="rounded p-1 hover:bg-bg-tertiary disabled:opacity-30"
              >
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
              <span className="truncate font-mono text-[11px] text-neutral-400" dir="ltr" title={activeProject?.path}>
                ./{cwd === '.' ? '' : cwd}
              </span>
            </div>

            <div className="relative mt-2">
              <Search className="absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-neutral-600" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter files…"
                className="w-full rounded border border-border bg-bg-secondary py-1 pr-7 pl-2 text-xs text-neutral-200 outline-none focus:border-accent/50"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {visible.length === 0 ? (
              <p className="px-3 py-3 text-xs text-neutral-600">Empty folder.</p>
            ) : (
              visible.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  onClick={() =>
                    entry.type === 'dir' ? void refreshFiles(entry.path) : void openFile(entry.path)
                  }
                  className={`flex w-full items-center gap-2 px-3 py-1 text-left text-xs transition hover:bg-bg-tertiary ${
                    selectedFile === entry.path ? 'bg-accent/15 text-neutral-100' : 'text-neutral-300'
                  }`}
                >
                  {iconFor(entry)}
                  <span className="truncate" dir="ltr">
                    {entry.name}
                  </span>
                  {entry.size !== undefined ? (
                    <span className="ml-auto shrink-0 text-[10px] text-neutral-600">{entry.size}b</span>
                  ) : null}
                </button>
              ))
            )}
          </div>
        </>
      )}
    </section>
  )
}
