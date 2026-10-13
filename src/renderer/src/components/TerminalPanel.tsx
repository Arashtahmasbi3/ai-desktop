import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Terminal, Trash2, X } from 'lucide-react'
import { useStore } from '../store'

const LINE_CLASS: Record<string, string> = {
  command: 'text-neutral-200',
  stdout: 'text-neutral-400',
  stderr: 'text-red-400',
  info: 'text-neutral-500'
}

/** A one-shot local shell under the chat, scoped to the active project. */
export default function TerminalPanel(): JSX.Element {
  const { t } = useTranslation()
  const lines = useStore((state) => state.terminalLines)
  const run = useStore((state) => state.runTerminalCommand)
  const toggle = useStore((state) => state.toggleTerminal)
  const [input, setInput] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = scrollRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [lines])

  const submit = (): void => {
    const command = input.trim()
    if (!command) return
    setHistory((current) => [...current, command])
    setHistoryIndex(-1)
    setInput('')
    void run(command)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      submit()
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (history.length === 0) return
      const next = historyIndex < 0 ? history.length - 1 : Math.max(0, historyIndex - 1)
      setHistoryIndex(next)
      setInput(history[next] ?? '')
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (historyIndex < 0) return
      const next = historyIndex + 1
      if (next >= history.length) {
        setHistoryIndex(-1)
        setInput('')
      } else {
        setHistoryIndex(next)
        setInput(history[next] ?? '')
      }
    }
  }

  return (
    <div className="flex h-56 shrink-0 flex-col border-t border-border bg-bg-primary">
      <div className="flex h-7 shrink-0 items-center justify-between border-b border-border px-3 text-2xs text-neutral-500">
        <span className="flex items-center gap-1.5">
          <Terminal className="h-3.5 w-3.5" />
          {t('chat.terminalTitle')}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => useStore.setState({ terminalLines: [] })}
            title={t('common.clear')}
            aria-label={t('common.clear')}
            className="rounded p-1 hover:bg-bg-tertiary hover:text-neutral-300"
          >
            <Trash2 className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={toggle}
            title={t('common.close')}
            aria-label={t('common.close')}
            className="rounded p-1 hover:bg-bg-tertiary hover:text-neutral-300"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>
      <div ref={scrollRef} dir="ltr" className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-2xs">
        {lines.map((line) => (
          <div key={line.id} className={`whitespace-pre-wrap ${LINE_CLASS[line.kind] ?? ''}`}>
            {line.text}
          </div>
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-1.5 font-mono text-2xs">
        <span className="text-accent">$</span>
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          dir="ltr"
          spellCheck={false}
          placeholder={t('chat.terminalPlaceholder')}
          className="flex-1 bg-transparent text-neutral-100 outline-none placeholder:text-neutral-600"
        />
      </div>
    </div>
  )
}
