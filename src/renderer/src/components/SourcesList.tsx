import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText } from 'lucide-react'
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

  if (filesRead.length === 0 && preview.included.every((section) => section.key === 'history')) {
    return <p className="text-xs text-neutral-600">{t('workspace.sourcesEmpty')}</p>
  }

  return (
    <div className="flex flex-col gap-3 text-xs">
      <section>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-600">
          {t('workspace.filesRead')}
        </p>
        {filesRead.length === 0 ? (
          <p className="text-neutral-600">—</p>
        ) : (
          <ul className="space-y-0.5">
            {filesRead.map((path, index) => (
              <li
                key={`${path}-${index}`}
                className="flex items-center gap-1.5 truncate font-mono text-[10px] text-neutral-400"
                dir="ltr"
              >
                <FileText className="h-3 w-3 shrink-0 text-neutral-600" />
                {path}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-600">
          {t('workspace.context')}
        </p>
        <ul className="space-y-0.5">
          {preview.included.map((section) => (
            <li key={section.key} className="flex justify-between gap-3">
              <span className="truncate text-neutral-400">
                {t('workspace.included')}: {section.label}
              </span>
              <span className="shrink-0 font-mono text-neutral-600">{section.tokens}</span>
            </li>
          ))}
        </ul>
      </section>

      {preview.blockedFiles.length > 0 ? (
        <section>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-amber-500">
            {t('workspace.withheld')}
          </p>
          <ul className="space-y-0.5">
            {preview.blockedFiles.map((file) => (
              <li key={file} className="truncate font-mono text-[10px] text-amber-300/80" dir="ltr">
                {file}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-600">
          {t('workspace.excluded')}
        </p>
        <ul className="space-y-0.5 text-neutral-600">
          {preview.excluded.map((item) => (
            <li key={item}>• {item}</li>
          ))}
        </ul>
      </section>
    </div>
  )
}
