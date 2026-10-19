import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Brain, FileText, Trash2 } from 'lucide-react'
import { useStore } from '../store'
import { PROVIDERS } from '@shared/providers'
import { buildContextPreview } from '@shared/context-preview'

/**
 * What the agent read and what will be sent as context (v2.6.0, B.4).
 * Mirrors the pre-send preview so "Sources" is visible without opening a modal.
 */
export default function SourcesList(): JSX.Element {
  const { t } = useTranslation()
  const selection = useStore((state) => state.selection)
  const messages = useStore((state) => state.messages)
  const settings = useStore((state) => state.settings)
  const memory = useStore((state) => state.memory)
  const clearMemory = useStore((state) => state.clearMemory)
  const [confirming, setConfirming] = useState(false)

  const filesRead = useMemo(
    () =>
      messages.flatMap((message) =>
        message.role === 'tool' && message.toolCall?.path ? [message.toolCall.path] : []
      ),
    [messages]
  )

  const preview = useMemo(() => {
    const activeProject = settings?.projects.find((project) => project.id === settings.activeProjectId)
    return buildContextPreview({
      provider: PROVIDERS[selection.provider]?.label ?? selection.provider,
      model: selection.model,
      messages,
      files: filesRead,
      remotePaths:
        activeProject?.type === 'remote' && activeProject.path ? [activeProject.path] : []
    })
  }, [selection, messages, settings, filesRead])

  const hasMemory =
    memory !== null && (memory.turns > 0 || memory.messages > 0 || memory.trustedPlan !== null)

  if (
    !hasMemory &&
    filesRead.length === 0 &&
    preview.included.every((section) => section.key === 'history')
  ) {
    return <p className="text-xs text-fg-subtle">{t('workspace.sourcesEmpty')}</p>
  }

  return (
    <div className="flex flex-col gap-3 text-xs">
      <section data-testid="chat-memory">
        <p className="mb-1 flex items-center gap-1.5 text-3xs font-semibold text-fg-subtle">
          <Brain className="h-3 w-3" />
          {t('workspace.memoryTitle')}
        </p>
        {memory ? (
          <ul className="space-y-0.5 text-fg-muted">
            <li className="flex justify-between gap-3">
              <span>{t('workspace.memoryTurns')}</span>
              <span className="font-mono text-fg-subtle">{memory.turns}</span>
            </li>
            <li className="flex justify-between gap-3">
              <span>{t('workspace.memoryMessages')}</span>
              <span className="font-mono text-fg-subtle">{memory.messages}</span>
            </li>
            {memory.summary ? (
              <li className="truncate" title={memory.summary}>
                <span className="text-fg-muted">{t('workspace.memorySummary')}: </span>
                {memory.summary}
              </li>
            ) : null}
            {memory.trustedPlan ? (
              <li className="flex justify-between gap-3">
                <span>{t('workspace.memoryTrustedPlan')}</span>
                <span className="font-mono text-fg-subtle">{memory.trustedPlan.steps}</span>
              </li>
            ) : null}
          </ul>
        ) : (
          <p className="text-fg-subtle">{t('workspace.memoryEmpty')}</p>
        )}
        <button
          type="button"
          disabled={!hasMemory}
          onClick={() => {
            if (!confirming) {
              setConfirming(true)
              return
            }
            setConfirming(false)
            void clearMemory()
          }}
          className="mt-2 flex items-center gap-1.5 rounded border border-border px-2 py-1 text-3xs text-fg-muted transition enabled:hover:border-danger/60 enabled:hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Trash2 className="h-3 w-3" />
          {confirming ? t('workspace.memoryClearConfirm') : t('workspace.memoryClear')}
        </button>
      </section>

      <section>
        <p className="mb-1 text-3xs font-semibold text-fg-subtle">
          {t('workspace.filesRead')}
        </p>
        {filesRead.length === 0 ? (
          <p className="text-fg-subtle">—</p>
        ) : (
          <ul className="space-y-0.5">
            {filesRead.map((path, index) => (
              <li
                key={`${path}-${index}`}
                className="flex items-center gap-1.5 truncate font-mono text-3xs text-fg-muted"
                dir="ltr"
              >
                <FileText className="h-3 w-3 shrink-0 text-fg-subtle" />
                {path}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <p className="mb-1 text-3xs font-semibold text-fg-subtle">
          {t('workspace.context')}
        </p>
        <ul className="space-y-0.5">
          {preview.included.map((section) => (
            <li key={section.key} className="flex justify-between gap-3">
              <span className="truncate text-fg-muted">
                {t('workspace.included')}: {section.label}
              </span>
              <span className="shrink-0 font-mono text-fg-subtle">{section.tokens}</span>
            </li>
          ))}
        </ul>
      </section>

      {preview.blockedFiles.length > 0 ? (
        <section>
          <p className="mb-1 text-3xs font-semibold text-warning">
            {t('workspace.withheld')}
          </p>
          <ul className="space-y-0.5">
            {preview.blockedFiles.map((file) => (
              <li key={file} className="truncate font-mono text-3xs text-warning/80" dir="ltr">
                {file}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <p className="mb-1 text-3xs font-semibold text-fg-subtle">
          {t('workspace.excluded')}
        </p>
        <ul className="space-y-0.5 text-fg-subtle">
          {preview.excluded.map((item) => (
            <li key={item}>• {item}</li>
          ))}
        </ul>
      </section>
    </div>
  )
}
