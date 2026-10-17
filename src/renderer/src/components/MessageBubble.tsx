import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import ToolResultCard from './ToolResultCard'
import { MARKDOWN_COMPONENTS } from './Markdown'
import { AlertTriangle, Bot, Check, Copy, GitFork, Server, User } from 'lucide-react'
import { useStore, type ChatMessage } from '../store'
import { toolLabel } from '../lib/tool-labels'

const ROLE_LABEL: Record<ChatMessage['role'], string> = {
  user: 'chat.roleUser',
  assistant: 'chat.roleAssistant',
  tool: 'chat.roleUser',
  system: 'chat.roleSystem'
}

function Avatar({ role }: { role: ChatMessage['role'] }): JSX.Element {
  const map = {
    user: { icon: User, className: 'bg-accent-solid/20 text-accent' },
    assistant: { icon: Bot, className: 'bg-bg-tertiary text-success' },
    tool: { icon: Bot, className: 'bg-bg-tertiary text-info' },
    system: { icon: AlertTriangle, className: 'bg-warning/15 text-warning' }
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
          <span className="rounded-full border border-border bg-bg-secondary px-2.5 py-1 font-mono text-2xs text-info">
            {toolLabel(message.content, t)}
          </span>
        )}
      </div>
    )
  }

  const copy = (): void => {
    // U-5: a clipboard write can be refused (insecure context, no permission).
    // It used to fail silently — the copy button simply did nothing.
    const clipboard = navigator.clipboard
    if (!clipboard?.writeText) {
      useStore.getState().pushToast('error', t('toast.copyFailed'))
      return
    }
    void clipboard
      .writeText(message.content)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      })
      .catch(() => useStore.getState().pushToast('error', t('toast.copyFailed')))
  }

  return (
    <div className={`group flex gap-2 px-4 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <Avatar role={message.role} />
      <div
        className={`flex min-w-0 max-w-[min(46rem,85%)] flex-col ${
          isUser ? 'items-end' : 'items-start'
        }`}
      >
        <span className="brutal-label mb-0.5 px-1">
          {t(ROLE_LABEL[message.role])}
        </span>
        {/* v4.0: a message is a bordered block, not a pillow. The speaker is told apart by the
            border colour — the user's own words take the accent, the assistant's take ink, a system
            notice takes the warning colour — instead of by a soft fill, and each keeps its own
            label, so nothing depends on colour alone. */}
        <div
          dir="auto"
          data-testid={`message-${message.role}`}
          className={`chat-markdown w-full rounded-shape border-2 px-3 py-2 text-sm leading-relaxed ${
            isUser
              ? 'border-accent bg-accent-solid/10 text-fg-strong'
              : message.role === 'system'
                ? 'border-warning bg-bg-tertiary text-fg'
                : 'border-border-strong bg-bg-tertiary text-fg'
          }`}
        >
          <ReactMarkdown components={MARKDOWN_COMPONENTS}>{message.content}</ReactMarkdown>
        </div>
        <div className="mt-0.5 flex items-center gap-2 px-1">
          {message.role === 'assistant' && message.model ? (
            <span className="font-mono text-3xs text-fg-muted" dir="ltr">
              {message.model}
            </span>
          ) : null}
          {message.usedRemote ? (
            <span className="flex items-center gap-0.5 text-3xs text-info">
              <Server className="h-2.5 w-2.5" />
              {t('chat.usedRemote')}
            </span>
          ) : null}
          <button
            type="button"
            onClick={copy}
            title={t('toast.copied')}
            aria-label={t('common.export')}
            className={`flex items-center gap-0.5 text-3xs text-fg-muted transition hover:text-fg ${
              copied
                ? ''
                : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 group-focus-within:opacity-100'
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
              className="flex items-center gap-0.5 text-3xs text-fg-muted opacity-0 transition hover:text-fg focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
            >
              <GitFork className="h-3 w-3" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
