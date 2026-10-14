import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, Send, X } from 'lucide-react'
import { formatContextPreview, type ContextPreview } from '@shared/context-preview'
import Modal from './ui/Modal'

interface ContextPreviewCardProps {
  preview: ContextPreview
  onSend: () => void
  onClose: () => void
}

/**
 * Privacy preview shown before a send (v2.3.2, B.4). Summarises what the model
 * will receive — system prompt, history, files, remote context — and what is
 * always withheld, so the user can send or cancel.
 */
export default function ContextPreviewCard({
  preview,
  onSend,
  onClose
}: ContextPreviewCardProps): JSX.Element {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  return (
    <Modal open onClose={onClose} maxWidth="28rem" ariaLabel={t('chat.contextTitle')} closeOnBackdrop>
      <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-fg-strong">{t('chat.contextTitle')}</h2>
        <button
          type="button"
          onClick={onClose}
          title={t('common.close')}
          aria-label={t('common.close')}
          className="rounded-lg p-1 text-fg-muted hover:bg-bg-tertiary hover:text-fg"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 text-xs text-fg">
        <div className="flex items-center justify-between">
          <span className="text-fg-muted">{t('chat.contextProvider')}</span>
          <span className="text-fg" dir="ltr">
            {preview.provider} · {preview.model}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-fg-muted">{t('chat.contextTokens')}</span>
          <span className="font-mono text-fg" dir="ltr">
            ≈ {preview.tokens.toLocaleString('en-US')}
          </span>
        </div>

        <div>
          <p className="mb-1 font-medium text-fg">{t('chat.contextIncluded')}</p>
          <ul className="space-y-0.5">
            {preview.included.map((section) => (
              <li key={section.key} className="flex justify-between gap-3">
                <span className="truncate">• {section.label}</span>
                <span className="shrink-0 font-mono text-fg-muted">{section.tokens}</span>
              </li>
            ))}
            {preview.included.length === 0 ? <li className="text-fg-subtle">—</li> : null}
          </ul>
        </div>

        {preview.blockedFiles.length > 0 ? (
          <div>
            <p className="mb-1 font-medium text-warning">{t('chat.contextWithheld')}</p>
            <ul className="space-y-0.5">
              {preview.blockedFiles.map((file) => (
                <li key={file} className="truncate font-mono text-3xs text-warning/80" dir="ltr">
                  • {file}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div>
          <p className="mb-1 font-medium text-fg">{t('chat.contextExcluded')}</p>
          <ul className="space-y-0.5 text-fg-muted">
            {preview.excluded.map((item) => (
              <li key={item}>• {item}</li>
            ))}
          </ul>
        </div>

        {expanded ? (
          <pre
            dir="ltr"
            className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-bg-primary p-2 text-left font-mono text-3xs text-fg-muted"
          >
            {formatContextPreview(preview)}
          </pre>
        ) : null}
      </div>

      <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-4 py-3">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-fg-muted hover:bg-bg-tertiary hover:text-fg"
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {expanded ? t('chat.contextCollapse') : t('chat.contextExpand')}
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-xs text-fg-muted hover:bg-bg-tertiary hover:text-fg"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onSend}
            className="flex items-center gap-1.5 rounded-lg bg-accent-solid px-3 py-1.5 text-xs text-white hover:bg-accent-solid-hover"
          >
            <Send className="h-3.5 w-3.5" />
            {t('chat.contextSendAnyway')}
          </button>
        </div>
      </footer>
    </Modal>
  )
}
