import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Link2, FolderInput, Plus, X } from 'lucide-react'
import { useStore } from '../store'
import type { ChatTransferChoice } from '../lib/chat-transfer'

const OPTIONS: Array<{
  id: ChatTransferChoice
  icon: typeof Link2
  labelKey: string
  hintKey: string
}> = [
  { id: 'link', icon: Link2, labelKey: 'projectSwitch.link', hintKey: 'projectSwitch.linkHint' },
  { id: 'move', icon: FolderInput, labelKey: 'projectSwitch.move', hintKey: 'projectSwitch.moveHint' },
  { id: 'new', icon: Plus, labelKey: 'projectSwitch.new', hintKey: 'projectSwitch.newHint' }
]

/**
 * Asks what should happen to the open conversation when the user opens a
 * different project (v2.6.4, Fix D). The chat is never silently orphaned: it
 * can be linked into the new project, filed there and superseded by a fresh
 * session, or left where it is while a new chat starts.
 */
export default function ProjectSwitchDialog(): JSX.Element | null {
  const { t } = useTranslation()
  const pending = useStore((state) => state.pendingProjectSwitch)
  const settings = useStore((state) => state.settings)
  const complete = useStore((state) => state.completeProjectSwitch)
  const cancel = useStore((state) => state.cancelProjectSwitch)
  const [remember, setRemember] = useState(false)

  const project = (settings?.projects ?? []).find((entry) => entry.id === pending)
  if (!pending || !project) return null

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      data-testid="project-switch-dialog"
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-bg-secondary p-4 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-fg-strong">{t('projectSwitch.title')}</h2>
            <p className="mt-1 text-xs text-fg-muted">
              {t('projectSwitch.body', { project: project.name })}
            </p>
          </div>
          <button
            type="button"
            onClick={cancel}
            aria-label={t('common.close')}
            className="rounded p-1 text-fg-muted hover:bg-bg-tertiary hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <ul className="mt-3 flex flex-col gap-2">
          {OPTIONS.map((option) => {
            const Icon = option.icon
            return (
              <li key={option.id}>
                <button
                  type="button"
                  data-testid={`project-switch-${option.id}`}
                  onClick={() => void complete(pending, option.id, remember)}
                  className="flex w-full items-start gap-2.5 rounded-lg border border-border bg-bg-primary p-2.5 text-left transition hover:border-accent/50 hover:bg-bg-tertiary"
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-fg-strong">
                      {t(option.labelKey)}
                    </span>
                    <span className="mt-0.5 block text-3xs leading-snug text-fg-muted">
                      {t(option.hintKey, { project: project.name })}
                    </span>
                  </span>
                  <ArrowRight className="ml-auto mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                </button>
              </li>
            )
          })}
        </ul>

        <div className="mt-3 flex items-center justify-between gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-2xs text-fg-muted">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
              className="accent-accent"
            />
            {t('projectSwitch.remember')}
          </label>
          <button
            type="button"
            onClick={cancel}
            className="rounded px-2 py-1 text-2xs text-fg-muted hover:bg-bg-tertiary hover:text-fg"
          >
            {t('projectSwitch.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
