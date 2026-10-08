import ReactMarkdown from 'react-markdown'
import { AlertTriangle, Bot, User } from 'lucide-react'
import type { ChatMessage } from '../store'

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

/** A single chat message: avatar + role + Markdown body (+ model for assistant). */
export default function MessageBubble({ message }: { message: ChatMessage }): JSX.Element {
  const isUser = message.role === 'user'

  if (message.role === 'tool') {
    return (
      <div className="flex justify-start px-4">
        <span className="rounded-full border border-border bg-bg-secondary px-2.5 py-1 font-mono text-[11px] text-sky-300">
          {message.content}
        </span>
      </div>
    )
  }

  return (
    <div className={`flex gap-2 px-4 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <Avatar role={message.role} />
      <div
        className={`flex min-w-0 max-w-[min(46rem,85%)] flex-col ${
          isUser ? 'items-end' : 'items-start'
        }`}
      >
        <span className="mb-0.5 px-1 text-[10px] uppercase tracking-wide text-neutral-500">
          {message.role}
        </span>
        <div
          className={`chat-markdown w-full rounded-xl px-3 py-2 text-sm leading-relaxed ${
            isUser ? 'bg-accent/20 text-neutral-100' : 'bg-bg-tertiary text-neutral-200'
          } ${message.role === 'system' ? 'border border-amber-500/30' : ''}`}
        >
          <ReactMarkdown>{message.content}</ReactMarkdown>
        </div>
        {message.role === 'assistant' && message.model ? (
          <span
            className="mt-0.5 px-1 font-mono text-[10px] text-neutral-600"
            dir="ltr"
            title="Model that answered"
          >
            {message.model}
          </span>
        ) : null}
      </div>
    </div>
  )
}
