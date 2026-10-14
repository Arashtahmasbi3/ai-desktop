import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LayoutTemplate, Plus, Trash2 } from 'lucide-react'
import {
  BUILTIN_TEMPLATES,
  addUserTemplate,
  loadUserTemplates,
  removeUserTemplate,
  type ChatTemplate
} from '../lib/templates'

interface TemplateMenuProps {
  currentInput: string
  onPick: (text: string) => void
}

/** Empty-state dropdown of prompt templates, with user-defined templates (D.1). */
export default function TemplateMenu({ currentInput, onPick }: TemplateMenuProps): JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [userTemplates, setUserTemplates] = useState<ChatTemplate[]>(() => loadUserTemplates())

  const pick = (prompt: string): void => {
    onPick(prompt)
    setOpen(false)
  }

  const saveCurrent = (): void => {
    const name = window.prompt(t('chat.templateNamePrompt'))
    if (!name || !name.trim()) return
    const prompt = currentInput.trim()
    if (!prompt) return
    setUserTemplates(addUserTemplate(name, prompt))
    setOpen(false)
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1.5 rounded-lg border border-border bg-bg-secondary px-3 py-1.5 text-xs text-fg transition hover:border-accent/50 hover:bg-bg-tertiary"
      >
        <LayoutTemplate className="h-3.5 w-3.5 text-accent" />
        {t('chat.templates')}
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute left-1/2 top-10 z-50 w-64 -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-bg-secondary py-1 text-start text-xs shadow-2xl">
            {BUILTIN_TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => pick(template.prompt)}
                className="block w-full px-3 py-1.5 text-left text-fg hover:bg-bg-tertiary"
              >
                {t(template.labelKey)}
              </button>
            ))}
            {userTemplates.length > 0 ? (
              <div className="mt-1 border-t border-border pt-1">
                {userTemplates.map((template) => (
                  <div key={template.id} className="group flex items-center">
                    <button
                      type="button"
                      onClick={() => pick(template.prompt)}
                      className="block flex-1 truncate px-3 py-1.5 text-left text-fg hover:bg-bg-tertiary"
                    >
                      {template.label}
                    </button>
                    <button
                      type="button"
                      aria-label={t('common.remove')}
                      onClick={() => setUserTemplates(removeUserTemplate(template.id))}
                      className="mr-1 hidden rounded p-1 text-fg-muted hover:text-danger focus-visible:block group-hover:block group-focus-within:block"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="mt-1 border-t border-border pt-1">
              <button
                type="button"
                onClick={saveCurrent}
                disabled={!currentInput.trim()}
                className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-accent hover:bg-bg-tertiary disabled:opacity-40"
              >
                <Plus className="h-3 w-3" />
                {t('chat.templateSaveCurrent')}
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
