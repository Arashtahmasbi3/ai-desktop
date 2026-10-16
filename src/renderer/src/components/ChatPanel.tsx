import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  ArrowDown,
  Bot,
  Eye,
  Paperclip,
  Send,
  SlidersHorizontal,
  Square
} from 'lucide-react'
import { basename, useStore } from '../store'
import { PROVIDERS } from '@shared/providers'
import { buildContextPreview, type ContextPreview } from '@shared/context-preview'
import { buildRunIntentBlock } from '@shared/run-outputs'
import MessageBubble from './MessageBubble'
import AttachmentChip from './AttachmentChip'
import SourcesOutputsPanel from './SourcesOutputsPanel'
import ContextPreviewCard from './ContextPreviewCard'
import FileChangesPanel from './FileChangesPanel'
import ContextWarning from './ContextWarning'
import TemplateMenu from './TemplateMenu'
import TerminalPanel from './TerminalPanel'
import ModelSwitcher from './ModelSwitcher'
import ProviderWarning from './ProviderWarning'
import PreflightBanner from './PreflightBanner'
import LoopStopCard from './LoopStopCard'
import ApprovalDialog from './ApprovalDialog'
import PreflightOverrideDialog from './PreflightOverrideDialog'
import PlanCard from './PlanCard'
import QuestionCard from './QuestionCard'
import TaskTracker from './TaskTracker'
import ExecutionBar from './ExecutionBar'
import ProgressTimeline from './ProgressTimeline'
import StatusCard from './StatusCard'
import InlineTrace from './InlineTrace'
import RunChangesCard from './RunChangesCard'
import GoalSummaryCard from './GoalSummaryCard'
import LiveStatus from './LiveStatus'
import JobsPanel from './JobsPanel'
import MicButton from './MicButton'
import { FullAccessBanner, FullAccessToggle } from './FullAccessToggle'
import { filterSlashCommands, resolveSlashCommand } from '../lib/slash'
import { decideSend, type PendingAttachment } from '../lib/context-gate'
import { modelSupportsVision } from '@shared/attachments'
import { attachmentPaths, dedupePaths, pasteIntent } from '../lib/attach-drop'
import { workspaceStatus, shouldShowWorkspaceBanner } from '../lib/project-status'
import { CHAT_MAX_WIDTH } from '../lib/layout'
import { visibleChatMessages } from '../lib/tool-rows'
import { toolLabel } from '../lib/tool-labels'
import { contextBudget, contextWarningVisible } from '@shared/memory'

const SUGGESTION_KEYS = [
  'chat.suggestion1',
  'chat.suggestion2',
  'chat.suggestion3',
  'chat.suggestion4'
]

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
  const decisions = useStore((state) => state.decisions)
  const showRawToolRows = useStore((state) => state.showRawToolRows)
  const running = useStore((state) => state.running)
  const warnings = useStore((state) => state.warnings)
  const send = useStore((state) => state.send)
  const abort = useStore((state) => state.abort)
  const newSession = useStore((state) => state.newSession)
  const projectMissing = useStore((state) => state.projectMissing)
  const settings = useStore((state) => state.settings)
  const vpsConnectedServers = useStore((state) => state.vpsConnected)
  const connectVps = useStore((state) => state.connectVps)
  const addProject = useStore((state) => state.addProject)
  const showContextBeforeSend = useStore((state) => state.showContextBeforeSend)
  const showContextWarning = useStore((state) => state.showContextWarning)
  const compactContext = useStore((state) => state.compactContext)
  const selection = useStore((state) => state.selection)
  const openSettings = useStore((state) => state.openSettings)
  const setView = useStore((state) => state.setView)
  const approvalSuggestion = useStore((state) => state.approvalSuggestion)
  const rememberApprovalTool = useStore((state) => state.rememberApprovalTool)
  const dismissApprovalSuggestion = useStore((state) => state.dismissApprovalSuggestion)
  const loopStop = useStore((state) => state.loopStop)
  const dismissLoopStop = useStore((state) => state.dismissLoopStop)
  const preflightNotice = useStore((state) => state.preflightNotice)
  const dismissPreflight = useStore((state) => state.dismissPreflight)
  const fileChanges = useStore((state) => state.fileChanges)
  const terminalOpen = useStore((state) => state.terminalOpen)
  // v3.0: the declared run intent, read here so the context preview can show what
  // `send` will append to the task (the panel itself owns editing it).
  const runOutputs = useStore((state) => state.runOutputs)
  const runSources = useStore((state) => state.runSources)
  const addRunSource = useStore((state) => state.addRunSource)

  const [input, setInput] = useState('')
  /**
   * v2.9.0: registered attachment refs, not raw desktop paths. Main reads the file and
   * gives back an opaque id; the chip shows the name so the user sees what will be sent.
   */
  const [attached, setAttached] = useState<PendingAttachment[]>([])
  /** v3.1: true while a file is held over the composer, so the drop target is visible. */
  const [attachDragOver, setAttachDragOver] = useState(false)
  const pushToast = useStore((state) => state.pushToast)
  // v2.9.0: whether the selected model can actually be shown an image. Mirrors each
  // adapter's getCapabilities().vision, which stays the runtime authority.
  const visionCapable = modelSupportsVision(selection.provider, selection.model)
  const [atBottom, setAtBottom] = useState(true)
  const [commandIndex, setCommandIndex] = useState(0)
  const [timelineOpen, setTimelineOpen] = useState(false)
  /** v3.0: the composer's Sources / Outputs panel. */
  const [sourcesPanelOpen, setSourcesPanelOpen] = useState(false)
  const [contextCard, setContextCard] = useState<{
    preview: ContextPreview
    body: string
    willSend: boolean
    /** v2.9.0: the ids that go with this preview when the user confirms. */
    attachmentNames: string[]
  } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const dir = i18n.language === 'fa' ? 'rtl' : 'ltr'
  const activeProject = settings?.projects.find(
    (project) => project.id === settings.activeProjectId
  )
  // v2.8.0: ask the connected *set*, not the single status slot. With two servers
  // up the slot named whichever changed last, so a remote project whose host was
  // perfectly connected showed the red "disconnected — Reconnect" banner.
  const vpsConnected = Boolean(
    activeProject?.type === 'remote' &&
      activeProject.vpsId &&
      vpsConnectedServers.includes(activeProject.vpsId)
  )
  const wsStatus = workspaceStatus({
    project: activeProject
      ? {
          ...activeProject,
          exists:
            activeProject.type !== 'remote' && projectMissing ? false : activeProject.exists
        }
      : undefined,
    vpsConnected
  })
  const wsBanner = shouldShowWorkspaceBanner(wsStatus)
  const runStatusAction = (): void => {
    if (wsStatus.action === 'picker') void pickWorkspace()
    else if (wsStatus.action === 'settings') openSettings()
    else if (wsStatus.action === 'reconnect' && activeProject?.vpsId) {
      void connectVps(activeProject.vpsId)
    }
  }
  const statusTone =
    wsStatus.tone === 'error'
      ? 'border-danger/30 bg-danger/10 text-danger'
      : wsStatus.tone === 'warning'
        ? 'border-warning/30 bg-warning/10 text-warning'
        : 'border-border bg-bg-tertiary text-fg'
  const statusActionTone =
    wsStatus.tone === 'error'
      ? 'border-danger/40 text-danger hover:bg-danger/15'
      : wsStatus.tone === 'warning'
        ? 'border-warning/40 text-warning hover:bg-warning/15'
        : 'border-border text-fg hover:bg-bg-secondary'

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
  const chatMessages = useMemo(
    () => visibleChatMessages(messages, decisions, showRawToolRows),
    [messages, decisions, showRawToolRows]
  )
  const contextPercent = Math.min(100, Math.round(budget.ratio * 100))

  useEffect(() => {
    const node = scrollRef.current
    if (node && atBottom) node.scrollTop = node.scrollHeight
  }, [messages, running, atBottom])

  useEffect(() => {
    const node = textareaRef.current
    if (!node) return
    node.style.height = 'auto'
    node.style.height = `${Math.min(node.scrollHeight, 200)}px`
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

  const previewContext = (
    body: string,
    willSend: boolean,
    attachmentNames: string[] = attached.map((item) => item.name)
  ): void => {
    // v3.0: `send` appends the declared-output block to the task, so the preview
    // counts it too — the dialog must not under-report what leaves the machine.
    const intent = buildRunIntentBlock(runOutputs, runSources)
    const previewBody = intent ? (body ? `${body}\n\n${intent}` : intent) : body
    const preview = buildContextPreview({
      provider: PROVIDERS[selection.provider]?.label ?? selection.provider,
      model: selection.model,
      messages: [...messages, { role: 'user', content: previewBody }],
      // v2.9.0: attached files are copied into the run workspace and read there, so
      // they are genuinely part of what is sent — the dialog says so instead of
      // listing them as withheld.
      files: attachmentNames,
      remotePaths: activeProject?.type === 'remote' ? [activeProject.path] : []
    })
    setContextCard({ preview, body, willSend, attachmentNames })
  }

  const doSend = (body: string, attachments: string[] = []): void => {
    if ((!body && attachments.length === 0) || running) return
    setInput('')
    setAttached([])
    setAtBottom(true)
    void send(body, attachments)
  }

  const submit = (): void => {
    const trimmed = input.trim()
    const command = resolveSlashCommand(commands, trimmed)
    if (command) {
      applyCommand(command)
      return
    }
    const decision = decideSend(trimmed, attached, showContextBeforeSend)
    if (!decision || running) return
    if (decision.preview) {
      previewContext(decision.body, true, decision.attachmentNames)
      return
    }
    doSend(decision.body, decision.attachments)
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
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey || !event.shiftKey)) {
      event.preventDefault()
      submit()
    }
  }

  const pickWorkspace = async (): Promise<void> => {
    const picked = await window.api.dialog.pickDirectory()
    if (picked) await addProject(basename(picked), picked)
  }

  /**
   * v3.1: attach files by path — the one path shared by the picker, a drop and a paste.
   *
   * Main remains the only side that reads a file: it stat()s it, refuses a credential-shaped path
   * and returns an opaque id, so nothing here widens what the renderer may see.
   */
  const attachPaths = async (input: string[]): Promise<void> => {
    const paths = dedupePaths(input)
    if (paths.length === 0) return
    const refs = await window.api.attachments.register(paths)
    if (refs.length === 0) {
      pushToast('error', t('chat.attachFailed'))
      return
    }
    if (refs.length < paths.length) pushToast('warning', t('chat.attachSkipped'))
    setAttached((current) => [
      ...current,
      ...refs.map((ref) => ({
        id: ref.id,
        name: ref.name,
        kind: ref.kind,
        bytes: ref.bytes,
        // v3.0: the preview main already produced, if any. Nothing new crosses
        // the bridge for this and the renderer still never reads the file.
        ...(ref.thumbnail ? { thumbnail: ref.thumbnail } : {})
      }))
    ])
  }

  const attach = async (): Promise<void> => {
    await attachPaths(await window.api.dialog.pickFile())
  }

  /** The OS paths of a dropped or pasted payload, via the pure helper the tests can drive. */
  const pathsFrom = (data: DataTransfer | null): string[] =>
    attachmentPaths(data?.files ?? null, (entry) =>
      window.api.webUtils.pathForFile(entry as File)
    )

  /**
   * v3.1: a drop on the composer attaches.
   *
   * `stopPropagation` is the important line: the app-level drop handler adds whatever is dropped as
   * a **project**, so without it dropping a screenshot opens it as a project instead of attaching it.
   */
  const onComposerDrop = (event: React.DragEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    setAttachDragOver(false)
    void attachPaths(pathsFrom(event.dataTransfer))
  }

  /**
   * v3.1: a paste attaches the files it carries, and is otherwise left completely alone so pasting
   * text into the composer behaves exactly as it did before.
   */
  const onComposerPaste = (event: React.ClipboardEvent): void => {
    /*
     * The decision is a pure function so it can be tested directly: attaching when the user meant to
     * paste text would break typing, and ignoring a real file would lose their action.
     */
    const intent = pasteIntent({
      files: event.clipboardData?.files ?? null,
      items: event.clipboardData?.items ?? null,
      pathForFile: (entry) => window.api.webUtils.pathForFile(entry as File)
    })
    if (intent === 'attach') {
      event.preventDefault()
      void attachPaths(pathsFrom(event.clipboardData))
      return
    }
    if (intent === 'image-unsupported') {
      event.preventDefault()
      pushToast('warning', t('chat.pasteImageUnsupported'))
    }
    // 'text' falls through untouched, so an ordinary paste behaves exactly as before.
  }

  /**
   * v3.0: "Add folder" in the Sources section. It reuses the existing
   * `dialog:pickDirectory` channel and records the picked folder as a plain
   * source entry — prompt text, not a new permission.
   */
  const addFolderSource = async (): Promise<void> => {
    const picked = await window.api.dialog.pickDirectory()
    if (picked) addRunSource(picked)
  }

  return (
    <section className="relative flex min-h-0 flex-1 flex-col bg-bg-primary">
      <ExecutionBar
        timelineOpen={timelineOpen}
        onToggleTimeline={() => setTimelineOpen((open) => !open)}
      />

      <FullAccessBanner />

      {wsBanner ? (
        <div
          className={`mx-3 mt-2 flex items-center gap-2 rounded-lg border px-3 py-2 text-2xs ${statusTone}`}
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">{t(wsStatus.messageKey as string, { path: wsStatus.path })}</span>
          {wsStatus.actionKey ? (
            <button
              type="button"
              onClick={runStatusAction}
              className={`rounded border px-2 py-0.5 ${statusActionTone}`}
            >
              {t(wsStatus.actionKey)}
            </button>
          ) : null}
        </div>
      ) : null}

      <div
        ref={scrollRef}
        onScroll={onScroll}
        dir={dir}
        className="relative flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto py-4"
      >
        <div
          data-testid="chat-measure"
          style={{ maxWidth: CHAT_MAX_WIDTH }}
          className="mx-auto flex min-h-0 w-full flex-1 flex-col gap-3 px-4"
        >
        <StatusCard />

        {timelineOpen ? <ProgressTimeline embedded /> : null}

        {messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            {/* v4.0: the mark is a stamped plate and the title is a label — the empty state
                states what this is instead of advertising it. */}
            <div className="brutal-panel flex h-14 w-14 items-center justify-center shadow-shape-sm">
              <Bot className="h-7 w-7 text-accent" />
            </div>
            <div>
              <h1 className="brutal-label text-sm text-fg-strong">
                {activeProject
                  ? t('chat.emptyTitleProject', { project: activeProject.name })
                  : t('chat.emptyTitle')}
              </h1>
              <p className="mt-1 max-w-md text-sm text-fg-muted">{t('chat.emptyBody')}</p>
            </div>
            <div className="grid max-w-lg grid-cols-1 gap-2 sm:grid-cols-2">
              {SUGGESTION_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => void send(t(key))}
                  className="brutal-btn brutal-press py-2 text-start text-xs"
                >
                  {t(key)}
                </button>
              ))}
            </div>
            <TemplateMenu currentInput={input} onPick={(text) => setInput(text)} />
          </div>
        ) : (
          chatMessages.map((message) => <MessageBubble key={message.id} message={message} />)
        )}

        <LiveStatus />

        {loopStop && !running ? (
          <LoopStopCard
            stop={loopStop}
            onContinue={() => {
              dismissLoopStop()
              void send(t('chat.loopStopContinuePrompt'))
            }}
            onCorrect={() => {
              dismissLoopStop()
              requestAnimationFrame(() => textareaRef.current?.focus())
            }}
            onStop={dismissLoopStop}
          />
        ) : null}

        <InlineTrace />
        {/* v2.9.0: the reference design keeps the ongoing goal and the changed files
            visible in the transcript, where the reader actually looks. */}
        <GoalSummaryCard />
        <RunChangesCard />
        </div>
      </div>
      <JobsPanel />

      {!atBottom && messages.length > 0 ? (
        <button
          type="button"
          onClick={scrollToBottom}
          aria-label={t('chat.typing')}
          className="absolute bottom-36 left-1/2 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-shape-pill border border-border bg-bg-secondary text-fg shadow-shape transition-colors duration-fast ease-shape hover:bg-bg-tertiary"
        >
          <ArrowDown className="h-4 w-4" />
        </button>
      ) : null}

      <ProviderWarning />

      {preflightNotice ? (
        <div className="mx-3 mb-2">
          <PreflightBanner
            checks={preflightNotice.checks}
            tier={preflightNotice.tier}
            onDismiss={dismissPreflight}
          />
        </div>
      ) : null}

      {warnings.length > 0 ? (
        <div className="brutal-banner mx-3 mb-2 flex items-start gap-2 border-warning text-2xs text-warning">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="flex flex-col gap-0.5">
            {warnings.map((warning, index) => (
              <span key={`${warning.kind}-${index}`}>{warning.message}</span>
            ))}
          </div>
        </div>
      ) : null}

      {terminalOpen ? <TerminalPanel /> : null}

      <div className="shrink-0 border-t border-border bg-bg-secondary py-3">
        <div
          data-testid="chat-composer"
          style={{ maxWidth: CHAT_MAX_WIDTH }}
          className="mx-auto w-full px-4"
        >
        {approvalSuggestion ? (
          <div className="mx-3 mb-1 flex items-center justify-between gap-2 rounded-lg border border-accent/40 bg-accent-solid/10 px-2 py-1.5 text-2xs text-fg">
            <span>
              {t('chat.rememberSuggestion', { tool: toolLabel(approvalSuggestion.tool, t) })}
            </span>
            <span className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => dismissApprovalSuggestion()}
                className="rounded border border-border px-1.5 py-0.5 text-fg-muted hover:bg-bg-tertiary"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void rememberApprovalTool(approvalSuggestion.tool)}
                className="rounded bg-accent-solid px-1.5 py-0.5 font-medium text-white hover:bg-accent-solid-hover"
              >
                {t('chat.approvalAlways')}
              </button>
            </span>
          </div>
        ) : null}
        <FileChangesPanel changes={fileChanges} />

        {attached.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-1" data-testid="attachment-chips">
            {attached.map((item) => (
              <AttachmentChip
                key={item.id}
                attachment={item}
                visionCapable={visionCapable}
                onRemove={() =>
                  setAttached((current) => current.filter((entry) => entry.id !== item.id))
                }
              />
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
                    index === commandIndex ? 'bg-bg-tertiary text-fg-strong' : 'text-fg-muted'
                  }`}
                >
                  <span className="font-mono text-accent">/{command.id}</span>
                  <span className="truncate text-fg-muted">{t(command.descKey)}</span>
                </button>
              ))}
            </div>
          ) : null}

          {/* v3.0 clay: the composer is the app's primary touchable surface — the full
              clay tier. The field is a recessed well inside the raised hero.
              v3.1: this is also where a drop or a paste lands, so the handlers sit on
              the hero rather than on the textarea — the whole composer is the target,
              which is what a user aims at. */}
          <div
            className={`brutal-panel p-2 transition-shadow duration-base ${
              attachDragOver ? 'ring-2 ring-accent' : ''
            }`}
            data-testid="composer-hero"
            onDragOver={(event) => {
              // preventDefault is what makes this element a valid drop target at all.
              event.preventDefault()
              event.stopPropagation()
              setAttachDragOver(true)
            }}
            onDragLeave={() => setAttachDragOver(false)}
            onDrop={onComposerDrop}
            onPaste={onComposerPaste}
          >
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={() => void attach()}
              title={t('chat.attach')}
              aria-label={t('chat.attach')}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-shape-sm text-fg-muted transition-colors duration-fast hover:bg-bg-tertiary hover:text-fg"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <MicButton
              appLanguage={i18n.language}
              onTranscript={(text) =>
                setInput((current) => (current ? `${current} ${text}` : text))
              }
            />
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              dir={dir}
              placeholder={t('chat.placeholder')}
              className="brutal-inset max-h-[200px] min-h-[2.25rem] flex-1 resize-none rounded-shape-sm px-2 py-2 text-sm text-fg-strong outline-none placeholder:text-fg-subtle"
            />
            <span className="shrink-0">
              <ModelSwitcher />
            </span>
            {/* v3.0 clay: the Sources/Outputs panel lives at the composer's top-right,
                in the same control row as the model and send buttons so it costs no
                extra height. */}
            <button
              type="button"
              data-testid="composer-sources-toggle"
              onClick={() => setSourcesPanelOpen((open) => !open)}
              title={t('runPanel.open')}
              aria-label={t('runPanel.open')}
              aria-pressed={sourcesPanelOpen}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-shape-sm transition-colors duration-fast hover:bg-bg-tertiary ${
                sourcesPanelOpen ? 'text-accent' : 'text-fg-muted hover:text-fg'
              }`}
            >
              <SlidersHorizontal className="h-4 w-4" />
            </button>
            {running ? (
              <button
                type="button"
                onClick={abort}
                title={`${t('chat.stop')} (Shift+Esc)`}
                aria-label={`${t('chat.stop')} (Shift+Esc)`}
                className="brutal-press flex h-8 w-8 items-center justify-center rounded-shape-pill bg-danger/20 text-danger hover:bg-danger/30"
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
                className={`flex h-8 w-8 items-center justify-center rounded-shape-pill ${
                  input.trim() || attached.length > 0
                    ? 'brutal-press bg-accent-solid text-accent-fg hover:bg-accent-solid-hover'
                    : 'bg-bg-tertiary text-fg-muted'
                } disabled:cursor-not-allowed`}
              >
                <Send className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="mt-1.5 flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <FullAccessToggle />
              <button
                type="button"
                onClick={() => previewContext(input.trim(), false)}
                title={t('chat.viewContext')}
                className="flex items-center gap-1 rounded-shape-sm px-1.5 py-0.5 text-3xs text-fg-muted transition-colors duration-fast hover:bg-bg-tertiary hover:text-fg"
              >
                <Eye className="h-3 w-3" />
                {t('chat.viewContext')}
              </button>
            </div>
            {contextWarningVisible(showContextWarning, budget.nearLimit) ? (
              <ContextWarning
                percent={contextPercent}
                overBudget={budget.overBudget}
                running={running}
                onCompact={compactContext}
              />
            ) : null}
          </div>
        </div>
        <div className="mt-1.5 flex items-center justify-between px-1 text-3xs text-fg-subtle">
          <span>Enter = {t('chat.send')} · Shift+Enter = ↵ · Ctrl+Enter = {t('chat.send')}</span>
        </div>
        </div>
      </div>

      <TaskTracker />
      <PlanCard />
      <ApprovalDialog />
      {/* v2.8.0: the agent asks and keeps going; answering resumes the same run. */}
      <QuestionCard />
      <PreflightOverrideDialog />
      {sourcesPanelOpen ? (
        <SourcesOutputsPanel
          attached={attached}
          visionCapable={visionCapable}
          onRemoveAttachment={(id) =>
            setAttached((current) => current.filter((entry) => entry.id !== id))
          }
          onAddFiles={() => void attach()}
          onAddFolder={() => void addFolderSource()}
          // "View all" is a drill-down: the panel closes and the existing context
          // preview opens, so there is never a second preview implementation.
          onViewAll={() => {
            setSourcesPanelOpen(false)
            previewContext(input.trim(), false)
          }}
          onClose={() => setSourcesPanelOpen(false)}
        />
      ) : null}
      {contextCard ? (
        <ContextPreviewCard
          preview={contextCard.preview}
          onClose={() => setContextCard(null)}
          onSend={() => {
            const { body, attachmentNames } = contextCard
            setContextCard(null)
            // v2.9.0: the ids were captured when the preview opened, so confirming it
            // sends exactly what the dialog showed.
            if (contextCard.willSend) {
              const ids = attached
                .filter((item) => attachmentNames.includes(item.name))
                .map((item) => item.id)
              doSend(body, ids)
            }
          }}
        />
      ) : null}
    </section>
  )
}
