import { useCallback, useEffect, useState } from 'react'
import { ArrowUp, File as FileIcon, Folder, RefreshCw, Save } from 'lucide-react'
import type { RemoteFileEntry } from '@shared/vps'

function text(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Browses and edits files on a connected VPS over SFTP. */
export default function RemoteFileExplorer({ serverId }: { serverId: string }): JSX.Element {
  const [path, setPath] = useState('/')
  const [entries, setEntries] = useState<RemoteFileEntry[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const list = useCallback(
    async (target: string): Promise<void> => {
      setBusy(true)
      setError(null)
      try {
        setEntries(await window.api.vps.files.list(serverId, target))
        setPath(target)
      } catch (cause) {
        setError(text(cause))
      } finally {
        setBusy(false)
      }
    },
    [serverId]
  )

  useEffect(() => {
    setSelected(null)
    setContent('')
    void list('/')
  }, [list])

  const open = async (entry: RemoteFileEntry): Promise<void> => {
    if (entry.type === 'dir') {
      await list(entry.path)
      return
    }
    setBusy(true)
    setError(null)
    try {
      setSelected(entry.path)
      setContent(await window.api.vps.files.read(serverId, entry.path))
    } catch (cause) {
      setError(text(cause))
    } finally {
      setBusy(false)
    }
  }

  const save = async (): Promise<void> => {
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      await window.api.vps.files.write(serverId, selected, content)
    } catch (cause) {
      setError(text(cause))
    } finally {
      setBusy(false)
    }
  }

  const parent = path.replace(/\/[^/]+\/?$/, '') || '/'

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
        <button
          onClick={() => void list(parent)}
          disabled={path === '/' || busy}
          className="rounded p-1 text-fg-muted hover:bg-bg-tertiary hover:text-fg-strong disabled:opacity-30"
          title="Up"
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => void list(path)}
          disabled={busy}
          aria-busy={busy}
          className="rounded p-1 text-fg-muted hover:bg-bg-tertiary hover:text-fg-strong disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
        </button>
        <span className="truncate font-mono text-xs text-fg-muted">{path}</span>
        {selected ? (
          <button
            onClick={() => void save()}
            disabled={busy}
            className="ml-auto flex items-center gap-1 rounded bg-accent-solid px-2 py-1 text-xs font-medium text-accent-fg disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" /> Save
          </button>
        ) : null}
      </div>

      {error ? <p className="px-2 py-1 text-xs text-danger">{error}</p> : null}

      <div className="flex min-h-0 flex-1">
        <div className="w-64 shrink-0 overflow-auto border-r border-border">
          {entries.map((entry) => (
            <button
              key={entry.path}
              onClick={() => void open(entry)}
              disabled={busy}
              className={`flex w-full items-center gap-2 px-2 py-1 text-left text-xs hover:bg-bg-tertiary disabled:opacity-60 ${
                selected === entry.path ? 'bg-bg-tertiary text-accent' : 'text-fg'
              }`}
            >
              {entry.type === 'dir' ? (
                <Folder className="h-3.5 w-3.5 shrink-0 text-accent" />
              ) : (
                <FileIcon className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
              )}
              <span className="truncate">{entry.name}</span>
            </button>
          ))}
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          readOnly={!selected}
          spellCheck={false}
          placeholder={selected ? '' : 'Select a file to view or edit'}
          className="min-w-0 flex-1 resize-none bg-bg-primary p-3 font-mono text-xs text-fg outline-none"
        />
      </div>
    </div>
  )
}
