import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, Send, X } from 'lucide-react'
import { formatContextPreview, type ContextPreview } from '@shared/context-preview'

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-border bg-bg-secondary shadow-2xl">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-neutral-100">{t('chat.contextTitle')}</h2>
          <button
            type="button"
            onClick={onClose}
            title={t('common.close')}
            aria-label={t('common.close')}
            className="rounded-lg p-1 text-neutral-500 hover:bg-bg-tertiary hover:text-neutral-200"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-3 px-4 py-3 text-xs text-neutral-300">
          <div className="flex items-center justify-between">
            <span className="text-neutral-500">{t('chat.contextProvider')}</span>
            <span className="text-neutral-200">
              {preview.provider} · {preview.model}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-neutral-500">{t('chat.contextTokens')}</span>
            <span className="font-mono text-neutral-200">
              ≈ {preview.tokens.toLocaleString('en-US')}
            </span>
          </div>

          <div>
            <p className="mb-1 font-medium text-neutral-200">{t('chat.contextIncluded')}</p>
            <ul className="space-y-0.5">
              {preview.included.map((section) => (
                <li key={section.key} className="flex justify-between gap-3">
                  <span className="truncate">• {section.label}</span>
                  <span className="shrink-0 font-mono text-neutral-500">{section.tokens}</span>
                </li>
              ))}
              {preview.included.length === 0 ? (
                <li className="text-neutral-600">—</li>
              ) : null}
            </ul>
          </div>

          {preview.blockedFiles.length > 0 ? (
            <div>
              <p className="mb-1 font-medium text-amber-400">{t('chat.contextWithheld')}</p>
              <ul className="space-y-0.5">
                {preview.blockedFiles.map((file) => (
                  <li key={file} className="truncate text-amber-300/80">
                    • {file}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div>
            <p className="mb-1 font-medium text-neutral-200">{t('chat.contextExcluded')}</p>
            <ul className="space-y-0.5 text-neutral-500">
              {preview.excluded.map((item) => (
                <li key={item}>• {item}</li>
              ))}
            </ul>
          </div>

          {expanded ? (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-bg-primary p-2 font-mono text-[10px] text-neutral-400">
              {formatContextPreview(preview)}
            </pre>
          ) : null}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-neutral-400 hover:bg-bg-tertiary hover:text-neutral-200"
          >
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {expanded ? t('chat.contextCollapse') : t('chat.contextExpand')}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-xs text-neutral-400 hover:bg-bg-tertiary hover:text-neutral-200"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={onSend}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs text-white hover:bg-accent-hover"
            >
              <Send className="h-3.5 w-3.5" />
              {t('chat.contextSendAnyway')}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
