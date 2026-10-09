import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, Copy, Play, Square, Terminal } from 'lucide-react'
import { useStore } from '../store'

const LANGUAGE_LABEL: Record<string, string> = {
  bash: 'bash',
  sh: 'shell',
  shell: 'shell',
  zsh: 'shell',
  powershell: 'powershell',
  ps1: 'powershell',
  python: 'python',
  py: 'python',
  javascript: 'javascript',
  js: 'javascript',
  node: 'javascript',
  typescript: 'typescript',
  ts: 'typescript'
}

const RUNNABLE = new Set(Object.keys(LANGUAGE_LABEL))

interface LocalShellResult {
  stdout: string
  stderr: string
  exitCode: number
}

interface CodeBlockProps {
  code: string
  language: string
}

/**
 * A fenced code block with copy and (for shell/code languages) a Run button
 * that executes it locally via the sandboxed shell IPC (D.2). Running is
 * confirmed while the approval mode is "ask".
 */
export default function CodeBlock({ code, language }: CodeBlockProps): JSX.Element {
  const { t } = useTranslation()
  const approvalMode = useStore((state) => state.settings?.approvalMode ?? 'ask')
  const [copied, setCopied] = useState(false)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<LocalShellResult | null>(null)
  const [showOutput, setShowOutput] = useState(true)

  const normalized = language.toLowerCase()
  const canRun = RUNNABLE.has(normalized)

  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const run = async (): Promise<void> => {
    if (running) return
    if (approvalMode === 'ask' && !window.confirm(t('chat.runCodeConfirm'))) return
    setRunning(true)
    setResult(null)
    try {
      const output = (await window.api.shell.exec(code)) as LocalShellResult
      setResult(output)
      setShowOutput(true)
    } catch (error) {
      setResult({
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: -1
      })
      setShowOutput(true)
    } finally {
      setRunning(false)
    }
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (canRun && (event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault()
      void run()
    }
  }

  return (
    <div
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="my-2 overflow-hidden rounded-lg border border-border bg-bg-primary"
    >
      <div className="flex items-center gap-2 border-b border-border px-2 py-1 text-[10px] text-neutral-500">
        <Terminal className="h-3 w-3" />
        <span className="font-mono">{LANGUAGE_LABEL[normalized] ?? language ?? 'text'}</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => void copy()}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-bg-tertiary hover:text-neutral-200"
        >
          {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
          {copied ? t('chat.copied') : t('chat.copy')}
        </button>
        {canRun ? (
          <button
            type="button"
            onClick={() => void run()}
            disabled={running}
            title={t('chat.runHint')}
            className="flex items-center gap-1 rounded bg-accent/15 px-1.5 py-0.5 text-accent hover:bg-accent/25 disabled:opacity-50"
          >
            {running ? (
              <Square className="h-3 w-3 animate-pulse" />
            ) : (
              <Play className="h-3 w-3" />
            )}
            {running ? t('chat.runningCode') : t('chat.runCode')}
          </button>
        ) : null}
      </div>

      <pre className="overflow-auto p-3 text-xs leading-relaxed">
        <code dir="ltr" className="font-mono text-neutral-200">
          {code}
        </code>
      </pre>

      {result ? (
        <div className="border-t border-border">
          <button
            type="button"
            onClick={() => setShowOutput((value) => !value)}
            className="flex w-full items-center gap-1.5 px-2 py-1 text-[10px] text-neutral-500 hover:text-neutral-300"
          >
            <ChevronDown
              className={`h-3 w-3 transition ${showOutput ? '' : '-rotate-90'}`}
            />
            {t('chat.output')}
            <span
              className={`font-mono ${result.exitCode === 0 ? 'text-emerald-400' : 'text-red-400'}`}
            >
              exit {result.exitCode}
            </span>
          </button>
          {showOutput ? (
            <pre className="max-h-64 overflow-auto bg-black/40 p-2 text-[11px] leading-relaxed">
              {result.stdout ? (
                <code dir="ltr" className="block whitespace-pre-wrap text-neutral-300">
                  {result.stdout}
                </code>
              ) : null}
              {result.stderr ? (
                <code dir="ltr" className="block whitespace-pre-wrap text-red-400">
                  {result.stderr}
                </code>
              ) : null}
              {!result.stdout && !result.stderr ? (
                <code className="text-neutral-600">{t('chat.noOutput')}</code>
              ) : null}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
