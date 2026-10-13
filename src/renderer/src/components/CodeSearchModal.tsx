import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileCode2, Search, X } from 'lucide-react'
import { useStore } from '../store'

/** Ctrl+Shift+F: case-insensitive substring search across the active project. */
export default function CodeSearchModal(): JSX.Element | null {
  const { t } = useTranslation()
  const open = useStore((state) => state.searchOpen)
  const results = useStore((state) => state.searchResults)
  const runSearch = useStore((state) => state.runCodeSearch)
  const setSearchOpen = useStore((state) => state.setSearchOpen)
  const openFile = useStore((state) => state.openFile)
  const setView = useStore((state) => state.setView)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      const timer = setTimeout(() => inputRef.current?.focus(), 0)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const timer = setTimeout(() => void runSearch(query), 200)
    return () => clearTimeout(timer)
  }, [open, query, runSearch])

  if (!open) return null

  const select = (path: string): void => {
    setSearchOpen(false)
    void openFile(path)
    setView('files')
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pb-4 pt-24 backdrop-blur-sm"
      onClick={() => setSearchOpen(false)}
    >
      <div
        className="flex max-h-[70vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-bg-secondary shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-neutral-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setSearchOpen(false)
            }}
            placeholder={t('search.placeholder')}
            dir="ltr"
            className="flex-1 bg-transparent text-sm text-neutral-100 outline-none placeholder:text-neutral-600"
          />
          <button
            type="button"
            onClick={() => setSearchOpen(false)}
            aria-label={t('common.close')}
            className="rounded p-1 text-neutral-500 hover:bg-bg-tertiary hover:text-neutral-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {query.trim() === '' ? (
            <p className="px-3 py-4 text-xs text-neutral-500">{t('search.hint')}</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-4 text-xs text-neutral-500">{t('search.empty')}</p>
          ) : (
            results.map((match, index) => (
              <button
                key={`${match.path}:${match.line}:${index}`}
                type="button"
                onClick={() => select(match.path)}
                dir="ltr"
                className="flex w-full flex-col gap-0.5 border-b border-border/40 px-3 py-1.5 text-left last:border-b-0 hover:bg-bg-tertiary"
              >
                <span className="flex items-center gap-1.5 font-mono text-2xs text-accent">
                  <FileCode2 className="h-3 w-3 shrink-0" />
                  {match.path}
                  <span className="text-neutral-600">:{match.line}</span>
                </span>
                <span className="truncate font-mono text-2xs text-neutral-400">{match.text}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
