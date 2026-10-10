import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown, { type Components } from 'react-markdown'
import CodeBlock from './CodeBlock'
import ToolResultCard from './ToolResultCard'
import { readCode } from '../lib/markdown-code'
import { AlertTriangle, Bot, Check, Copy, GitFork, Server, User } from 'lucide-react'
import { useStore, type ChatMessage } from '../store'

const MARKDOWN_COMPONENTS: Components = {
  pre: ({ node }) => {
    const { code, language } = readCode(node)
    if (!code) return null
    return <CodeBlock code={code} language={language} />
  },
  code: ({ children }) => (
    <code className="rounded bg-bg-primary px-1 py-0.5 font-mono text-[0.85em] text-accent">
      {children}
    </code>
  )
}

const ROLE_LABEL: Record<ChatMessage['role'], string> = {
  user: 'chat.roleUser',
  assistant: 'chat.roleAssistant',
  tool: 'chat.roleUser',
  system: 'chat.roleSystem'
}

function Avatar({ role }: { role: ChatMessage['role'] }): JSX.Element {
  const map = {
    user: { icon: User, className: 'bg-accent/20 text-accent' },
    assistant: { icon: Bot, className: 'bg-bg-tertiary text-emerald-400' },
    tool: { icon: Bot, className: 'bg-bg-tertiary text-sky-400' },
    system: { icon: AlertTriangle, className: 'bg-amber-500/15 text-amber-400' }
  }[role]
  const Icon = map.icon
  return (
    <span
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${map.className}`}
    >
      <Icon className="h-4 w-4" />
    </span>
  )
}

/** A single chat message: avatar + role + Markdown body (+ model / copy / badges). */
export default function MessageBubble({ message }: { message: ChatMessage }): JSX.Element {
  const { t } = useTranslation()
  const activeChatId = useStore((state) => state.activeChatId)
  const forkChat = useStore((state) => state.forkChat)
  const [copied, setCopied] = useState(false)
  const isUser = message.role === 'user'

  if (message.role === 'tool') {
    return (
      <div className="flex justify-start px-4">
        {message.toolCall ? (
          <ToolResultCard {...message.toolCall} />
        ) : (
          <span className="rounded-full border border-border bg-bg-secondary px-2.5 py-1 font-mono text-[11px] text-sky-300">
            {message.content}
          </span>
        )}
      </div>
    )
  }

  const copy = (): void => {
    void navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    })
  }

  return (
    <div className={`group flex gap-2 px-4 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <Avatar role={message.role} />
      <div
        className={`flex min-w-0 max-w-[min(46rem,85%)] flex-col ${
          isUser ? 'items-end' : 'items-start'
        }`}
      >
        <span className="mb-0.5 px-1 text-[10px] uppercase tracking-wide text-neutral-500">
          {t(ROLE_LABEL[message.role])}
        </span>
        <div
          className={`chat-markdown w-full rounded-xl px-3 py-2 text-sm leading-relaxed ${
            isUser ? 'bg-accent/20 text-neutral-100' : 'bg-bg-tertiary text-neutral-200'
          } ${message.role === 'system' ? 'border border-amber-500/30' : ''}`}
        >
          <ReactMarkdown components={MARKDOWN_COMPONENTS}>{message.content}</ReactMarkdown>
        </div>
        <div className="mt-0.5 flex items-center gap-2 px-1">
          {message.role === 'assistant' && message.model ? (
            <span className="font-mono text-[10px] text-neutral-600" dir="ltr">
              {message.model}
            </span>
          ) : null}
          {message.usedRemote ? (
            <span className="flex items-center gap-0.5 text-[10px] text-sky-400">
              <Server className="h-2.5 w-2.5" />
              {t('chat.usedRemote')}
            </span>
          ) : null}
          <button
            type="button"
            onClick={copy}
            title={t('toast.copied')}
            aria-label={t('common.export')}
            className={`flex items-center gap-0.5 text-[10px] text-neutral-600 transition hover:text-neutral-300 ${
              copied ? '' : 'opacity-0 group-hover:opacity-100'
            }`}
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? t('toast.copied') : null}
          </button>
          {message.role !== 'system' && activeChatId ? (
            <button
              type="button"
              onClick={() => void forkChat(activeChatId, message.id)}
              title={t('chat.forkFrom')}
              aria-label={t('chat.forkFrom')}
              className="flex items-center gap-0.5 text-[10px] text-neutral-600 opacity-0 transition hover:text-neutral-300 group-hover:opacity-100"
            >
              <GitFork className="h-3 w-3" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
