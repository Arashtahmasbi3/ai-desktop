import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Globe, Loader2, Lock, RotateCw } from 'lucide-react'
import { normalizeUrl } from '@shared/url'
import type { ElectronWebviewElement } from '../webview'

const HOME = 'https://duckduckgo.com'
const MAX_HISTORY = 12

interface WebviewNavigationEvent extends Event {
  url?: string
}

interface WebviewFailEvent extends Event {
  errorDescription?: string
}

/** In-app browser: a hardened `<webview>` with a URL bar and history chips. */
export default function BrowserPanel(): JSX.Element {
  const [src, setSrc] = useState<string | null>(null)
  const [input, setInput] = useState(HOME)
  const [loading, setLoading] = useState(false)
  const [canBack, setCanBack] = useState(false)
  const [canForward, setCanForward] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<string[]>([])
  const ref = useRef<HTMLElement | null>(null)

  const webview = (): ElectronWebviewElement | null => ref.current as ElectronWebviewElement | null

  const go = useCallback((raw: string): void => {
    const url = normalizeUrl(raw)
    if (!url) {
      setError('Only http(s) URLs can be opened here.')
      return
    }
    setError(null)
    setInput(url)
    setSrc(url)
    setHistory((current) => [url, ...current.filter((entry) => entry !== url)].slice(0, MAX_HISTORY))
  }, [])

  useEffect(() => {
    const element = ref.current as ElectronWebviewElement | null
    if (!element) return

    const onStart = (): void => setLoading(true)
    const onStop = (): void => {
      setLoading(false)
      setCanBack(element.canGoBack())
      setCanForward(element.canGoForward())
    }
    const onNavigate = (event: Event): void => {
      const url = (event as WebviewNavigationEvent).url
      if (url) setInput(url)
    }
    const onFail = (event: Event): void => {
      setError((event as WebviewFailEvent).errorDescription ?? 'Failed to load the page.')
    }

    element.addEventListener('did-start-loading', onStart)
    element.addEventListener('did-stop-loading', onStop)
    element.addEventListener('did-navigate', onNavigate)
    element.addEventListener('did-navigate-in-page', onNavigate)
    element.addEventListener('did-fail-load', onFail)
    return () => {
      element.removeEventListener('did-start-loading', onStart)
      element.removeEventListener('did-stop-loading', onStop)
      element.removeEventListener('did-navigate', onNavigate)
      element.removeEventListener('did-navigate-in-page', onNavigate)
      element.removeEventListener('did-fail-load', onFail)
    }
  }, [src])

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-primary">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2">
        <button
          type="button"
          onClick={() => webview()?.goBack()}
          disabled={!canBack}
          title="Back"
          className="rounded p-1 text-fg-muted hover:bg-bg-tertiary hover:text-fg disabled:opacity-30"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => webview()?.goForward()}
          disabled={!canForward}
          title="Forward"
          className="rounded p-1 text-fg-muted hover:bg-bg-tertiary hover:text-fg disabled:opacity-30"
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => webview()?.reload()}
          disabled={!src}
          title="Reload"
          className="rounded p-1 text-fg-muted hover:bg-bg-tertiary hover:text-fg disabled:opacity-30"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
        </button>

        <form
          className="flex flex-1 items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault()
            go(input)
          }}
        >
          <div className="relative flex flex-1 items-center">
            <Lock className="absolute left-2 h-3 w-3 text-fg-subtle" />
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              dir="ltr"
              spellCheck={false}
              placeholder="Search or enter an address"
              className="w-full rounded border border-border bg-bg-secondary py-1 pl-7 pr-2 text-2xs text-fg outline-none focus:border-accent/50"
            />
          </div>
          <button
            type="submit"
            className="rounded border border-border px-2 py-1 text-2xs text-fg hover:bg-bg-tertiary"
          >
            Go
          </button>
        </form>
      </div>

      {error ? (
        <div className="shrink-0 border-b border-warning/30 bg-warning/10 px-3 py-1 text-2xs text-warning">
          {error}
        </div>
      ) : null}

      {src ? (
        <webview
          ref={ref}
          src={src}
          partition="persist:ai-desktop-browser"
          className="min-h-0 flex-1"
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4">
          <Globe className="h-9 w-9 text-accent" />
          <div className="text-center">
            <p className="text-sm text-fg">In-app browser</p>
            <p className="mt-1 text-xs text-fg-subtle">
              Pages load in a sandboxed webview. Only http(s) is allowed.
            </p>
          </div>
          <button
            type="button"
            onClick={() => go(HOME)}
            className="rounded bg-accent-solid px-3 py-1.5 text-xs text-white hover:bg-accent-solid-hover"
          >
            Open {HOME.replace('https://', '')}
          </button>
          {history.length > 0 ? (
            <div className="flex max-w-md flex-wrap justify-center gap-2">
              {history.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  onClick={() => go(entry)}
                  className="max-w-[16rem] truncate rounded-full border border-border px-2.5 py-1 text-3xs text-fg-muted hover:bg-bg-tertiary"
                  dir="ltr"
                >
                  {entry}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
