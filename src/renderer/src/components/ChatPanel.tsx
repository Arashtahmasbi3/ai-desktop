import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Bot, Loader2, Send, Square, Trash2 } from 'lucide-react'
import { useStore } from '../store'
import MessageBubble from './MessageBubble'
import ModelSwitcher from './ModelSwitcher'
import ProviderWarning from './ProviderWarning'

const SUGGESTIONS = [
  'لیست فایل‌های پوشه پروژه را بخوان و ساختار آن را توضیح بده.',
  'یک تابع TypeScript برای اعتبارسنجی ایمیل بنویس و تستش کن.',
  'package.json را باز کن و وابستگی‌های قدیمی را گزارش کن.'
]

export default function ChatPanel(): JSX.Element {
  const messages = useStore((state) => state.messages)
  const running = useStore((state) => state.running)
  const warnings = useStore((state) => state.warnings)
  const send = useStore((state) => state.send)
  const abort = useStore((state) => state.abort)
  const newSession = useStore((state) => state.newSession)

  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const node = scrollRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [messages, running])

  const submit = (): void => {
    const text = input.trim()
    if (!text || running) return
    setInput('')
    void send(text)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-bg-primary">
      <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border px-3 text-[11px] text-neutral-500">
        <ModelSwitcher />
        <button
          type="button"
          onClick={newSession}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-bg-tertiary hover:text-neutral-300"
        >
          <Trash2 className="h-3 w-3" />
          Clear
        </button>
      </div>

      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto py-4">
        {messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/15">
              <Bot className="h-7 w-7 text-accent" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-neutral-100">AI Desktop</h1>
              <p className="mt-1 max-w-md text-sm text-neutral-400">
                دستیار رومیزی شما برای چت، کدنویسی، اجرای دستور در سندباکس و کار با فایل‌های پروژه.
              </p>
            </div>
            <div className="flex max-w-lg flex-col gap-2">
              {SUGGESTIONS.map((text) => (
                <button
                  key={text}
                  type="button"
                  onClick={() => void send(text)}
                  className="rounded-lg border border-border bg-bg-secondary px-3 py-2 text-right text-xs text-neutral-300 transition hover:border-accent/50 hover:bg-bg-tertiary"
                >
                  {text}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) => <MessageBubble key={message.id} message={message} />)
        )}

        {running ? (
          <div className="flex items-center gap-2 px-4 text-xs text-neutral-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
            در حال تایپ…
          </div>
        ) : null}
      </div>

      <ProviderWarning />

      {warnings.length > 0 ? (
        <div className="mx-3 mb-2 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="flex flex-col gap-0.5">
            {warnings.map((warning, index) => (
              <span key={`${warning.kind}-${index}`}>{warning.message}</span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="shrink-0 border-t border-border bg-bg-secondary p-3">
        <div className="flex items-end gap-2 rounded-xl border border-border bg-bg-primary p-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            dir="rtl"
            placeholder="پیام خود را بنویسید… (Enter ارسال، Shift+Enter خط جدید)"
            className="max-h-40 min-h-[2.25rem] flex-1 resize-none bg-transparent px-1 py-1.5 text-sm text-neutral-100 outline-none placeholder:text-neutral-600"
          />
          {running ? (
            <button
              type="button"
              onClick={abort}
              title="Stop"
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30"
            >
              <Square className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!input.trim()}
              title="Send (Enter / Ctrl+Enter)"
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
        <p className="mt-1.5 px-1 text-[10px] text-neutral-600">
          Enter = ارسال · Shift+Enter = خط جدید · Ctrl+Enter = ارسال · Ctrl+N = سشن جدید
        </p>
      </div>
    </section>
  )
}
