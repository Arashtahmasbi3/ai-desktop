import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ArrowDown, Bot, Loader2, Paperclip, Send, ShieldAlert, Square, Trash2, X } from 'lucide-react'
import { basename, useStore } from '../store'
import MessageBubble from './MessageBubble'
import ModelSwitcher from './ModelSwitcher'
import VpsSelector from './VpsSelector'
import ProviderWarning from './ProviderWarning'
import { filterSlashCommands, resolveSlashCommand } from '../lib/slash'
import { contextBudget, estimateTokens } from '@shared/memory'

const SUGGESTION_KEYS = ['chat.suggestion1', 'chat.suggestion2', 'chat.suggestion3']

/** A composer slash-command: either runs an action or seeds a prompt template. */
interface SlashCommand {
  id: string
  descKey: string
  run?: () => void
  insert?: string
}

export default function ChatPanel(): JSX.Element {
  const { t, i18n } = useTranslation()
  const messages = useStore((state) => state.messages)
  const running = useStore((state) => state.running)
  const warnings = useStore((state) => state.warnings)
  const send = useStore((state) => state.send)
  const abort = useStore((state) => state.abort)
  const newSession = useStore((state) => state.newSession)
  const projectMissing = useStore((state) => state.projectMissing)
  const showTokenCount = useStore((state) => state.showTokenCount)
  const openSettings = useStore((state) => state.openSettings)
  const setView = useStore((state) => state.setView)
  const planMode = useStore((state) => state.planMode)
  const setPlanMode = useStore((state) => state.setPlanMode)
  const pendingApproval = useStore((state) => state.pendingApproval)
  const respondApproval = useStore((state) => state.respondApproval)

  const [input, setInput] = useState('')
  const [attached, setAttached] = useState<string[]>([])
  const [atBottom, setAtBottom] = useState(true)
  const [commandIndex, setCommandIndex] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const dir = i18n.language === 'fa' ? 'rtl' : 'ltr'

  const commands = useMemo<SlashCommand[]>(
    () => [
      { id: 'new', descKey: 'slash.new', run: () => newSession() },
      { id: 'clear', descKey: 'slash.clear', run: () => newSession() },
      { id: 'settings', descKey: 'slash.settings', run: () => openSettings() },
      { id: 'workspace', descKey: 'slash.workspace', run: () => setView('files') },
      { id: 'vps', descKey: 'slash.vps', run: () => setView('vps') },
      { id: 'github', descKey: 'slash.github', run: () => setView('github') },
      {
        id: 'plan',
        descKey: 'slash.plan',
        insert: 'Plan the following task step by step before writing any code:\n\n'
      },
      { id: 'explain', descKey: 'slash.explain', insert: 'Explain what this code does and why:\n\n' },
      { id: 'fix', descKey: 'slash.fix', insert: 'Find and fix the bug in:\n\n' },
      { id: 'test', descKey: 'slash.test', insert: 'Write tests for:\n\n' },
      { id: 'help', descKey: 'slash.help', run: () => setInput('/') }
    ],
    [newSession, openSettings, setView]
  )

  const matches = useMemo(() => filterSlashCommands(commands, input), [commands, input])
  const budget = useMemo(() => contextBudget(messages, input), [messages, input])

  useEffect(() => {
    const node = scrollRef.current
    if (node && atBottom) node.scrollTop = node.scrollHeight
  }, [messages, running, atBottom])

  useEffect(() => {
    const node = textareaRef.current
    if (!node) return
    node.style.height = 'auto'
    node.style.height = `${Math.min(node.scrollHeight, 160)}px`
  }, [input])

  const onScroll = (): void => {
    const node = scrollRef.current
    if (!node) return
    setAtBottom(node.scrollHeight - node.scrollTop - node.clientHeight < 40)
  }

  const scrollToBottom = (): void => {
    const node = scrollRef.current
    if (node) node.scrollTop = node.scrollHeight
    setAtBottom(true)
  }

  const applyCommand = (command: SlashCommand): void => {
    setCommandIndex(0)
    if (command.run) {
      command.run()
      setInput('')
      return
    }
    setInput(command.insert ?? '')
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const submit = (): void => {
    const trimmed = input.trim()
    const command = resolveSlashCommand(commands, trimmed)
    if (command) {
      applyCommand(command)
      return
    }
    const body = [trimmed, ...attached.map((path) => `@${path}`)].filter(Boolean).join('\n')
    if (!body || running) return
    setInput('')
    setAttached([])
    setAtBottom(true)
    void send(body)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (matches.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setCommandIndex((index) => (index + 1) % matches.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setCommandIndex((index) => (index - 1 + matches.length) % matches.length)
        return
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && matches[commandIndex]) {
        event.preventDefault()
        applyCommand(matches[commandIndex])
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setInput('')
        return
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault()
      submit()
    }
  }

  const attach = async (): Promise<void> => {
    const picked = await window.api.dialog.pickFile()
    if (picked.length > 0) setAttached((current) => [...current, ...picked])
  }

  return (
    <section className="relative flex min-h-0 flex-1 flex-col bg-bg-primary">
      <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border px-3 text-[11px] text-neutral-500">
        <div className="flex min-w-0 items-center gap-2">
          <ModelSwitcher />
          <span className="text-neutral-700">·</span>
          <VpsSelector />
          <span className="text-neutral-700">·</span>
          <button
            type="button"
            onClick={() => setPlanMode(!planMode)}
            title={t('chat.planModeHint')}
            className={`flex items-center gap-1 rounded px-1.5 py-0.5 transition ${
              planMode
                ? 'bg-accent/20 text-accent'
                : 'text-neutral-500 hover:bg-bg-tertiary hover:text-neutral-300'
            }`}
          >
            <ShieldAlert className="h-3 w-3" />
            {planMode ? t('chat.planMode') : t('chat.codeMode')}
          </button>
        </div>
        <button
          type="button"
          onClick={() => newSession()}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-bg-tertiary hover:text-neutral-300"
        >
          <Trash2 className="h-3 w-3" />
          {t('chat.clear')}
        </button>
      </div>

      {projectMissing ? (
        <div className="mx-3 mt-2 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">{t('sidebar.missingPath')}</span>
          <button
            type="button"
            onClick={openSettings}
            className="rounded border border-amber-500/40 px-2 py-0.5 text-amber-200 hover:bg-amber-500/15"
          >
            {t('sidebar.locate')}
          </button>
        </div>
      ) : null}

      <div
        ref={scrollRef}
        onScroll={onScroll}
        dir={dir}
        className="relative flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto py-4"
      >
        {messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/15">
              <Bot className="h-7 w-7 text-accent" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-neutral-100">{t('chat.emptyTitle')}</h1>
              <p className="mt-1 max-w-md text-sm text-neutral-400">{t('chat.emptyBody')}</p>
            </div>
            <div className="flex max-w-lg flex-col gap-2">
              {SUGGESTION_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => void send(t(key))}
                  className="rounded-lg border border-border bg-bg-secondary px-3 py-2 text-start text-xs text-neutral-300 transition hover:border-accent/50 hover:bg-bg-tertiary"
                >
                  {t(key)}
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
            {t('chat.typing')}
          </div>
        ) : null}
      </div>

      {!atBottom && messages.length > 0 ? (
        <button
          type="button"
          onClick={scrollToBottom}
          aria-label={t('chat.typing')}
          className="absolute bottom-36 left-1/2 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-bg-secondary text-neutral-300 shadow-lg hover:bg-bg-tertiary"
        >
          <ArrowDown className="h-4 w-4" />
        </button>
      ) : null}

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
        {attached.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-1">
            {attached.map((path) => (
              <span
                key={path}
                className="flex items-center gap-1 rounded border border-border bg-bg-primary px-2 py-0.5 text-[10px] text-neutral-400"
              >
                <span className="max-w-[14rem] truncate" dir="ltr">
                  {basename(path)}
                </span>
                <button
                  type="button"
                  onClick={() => setAttached((current) => current.filter((item) => item !== path))}
                  aria-label={t('common.remove')}
                  className="text-neutral-600 hover:text-red-400"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        {matches.length > 0 ? (
            <div className="mb-2 overflow-hidden rounded-lg border border-border bg-bg-secondary">
              {matches.map((command, index) => (
                <button
                  key={command.id}
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault()
                    applyCommand(command)
                  }}
                  onMouseEnter={() => setCommandIndex(index)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition ${
                    index === commandIndex ? 'bg-bg-tertiary text-neutral-100' : 'text-neutral-400'
                  }`}
                >
                  <span className="font-mono text-accent">/{command.id}</span>
                  <span className="truncate text-neutral-500">{t(command.descKey)}</span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="flex items-end gap-2 rounded-xl border border-border bg-bg-primary p-2">
          <button
            type="button"
            onClick={() => void attach()}
            title={t('chat.attach')}
            aria-label={t('chat.attach')}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-500 hover:bg-bg-tertiary hover:text-neutral-300"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            dir={dir}
            placeholder={t('chat.placeholder')}
            className="max-h-40 min-h-[2.25rem] flex-1 resize-none bg-transparent px-1 py-1.5 text-sm text-neutral-100 outline-none placeholder:text-neutral-600"
          />
          {running ? (
            <button
              type="button"
              onClick={abort}
              title={t('chat.stop')}
              aria-label={t('chat.stop')}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30"
            >
              <Square className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!input.trim() && attached.length === 0}
              title={t('chat.send')}
              aria-label={t('chat.send')}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="mt-1.5 flex items-center justify-between px-1 text-[10px] text-neutral-600">
          <span>Enter = {t('chat.send')} · Shift+Enter = ↵</span>
          {showTokenCount ? (
            <span className="font-mono">
              {t('chat.tokens', { count: estimateTokens(input) })}
              {input.length > 0 ? ` · ${input.length}` : ''}
            </span>
          ) : null}
        </div>
        {budget.overBudget ? (
          <p className="mt-1 px-1 text-[10px] text-amber-400">
            {t('chat.overBudget', { count: budget.tokens })}
          </p>
        ) : null}
      </div>

      {pendingApproval ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-border bg-bg-secondary p-4 shadow-2xl">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-100">
              <ShieldAlert className="h-4 w-4 text-amber-400" />
              {t('chat.approvalTitle')}
            </h2>
            <p className="mt-2 text-xs text-neutral-400">{t('chat.approvalBody')}</p>
            <pre
              dir="ltr"
              className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-bg-primary p-2 font-mono text-[11px] text-neutral-200"
            >
              {pendingApproval.tool}
              {'\n'}
              {pendingApproval.summary}
            </pre>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => respondApproval(false)}
                className="rounded-lg border border-border px-3 py-1.5 text-xs text-neutral-300 hover:bg-bg-tertiary"
              >
                {t('chat.deny')}
              </button>
              <button
                type="button"
                onClick={() => respondApproval(true)}
                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
              >
                {t('chat.approve')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
