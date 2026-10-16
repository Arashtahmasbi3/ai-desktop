import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, Image as ImageIcon, X } from 'lucide-react'
import { formatAttachmentSize } from '@shared/attachments'
import type { PendingAttachment } from '../lib/context-gate'
import Modal from './ui/Modal'

export interface AttachmentChipProps {
  attachment: PendingAttachment
  /** Whether the selected model can be shown an image (see `modelSupportsVision`). */
  visionCapable: boolean
  onRemove: () => void
}

/**
 * One registered attachment (v2.9.0, preview added v3.0).
 *
 * The chip is the only place the user confirms *what* will be sent, so an image
 * attachment shows the 40×40 preview main produced, and clicking it opens the
 * full image in the shared modal primitive. The preview data URL is whatever
 * main already put on the ref — the renderer never reads the file and no new IPC
 * exists for this. An attachment without a preview (a text file, or a release
 * where main had no thumbnailer) renders exactly as it did before.
 *
 * Lives in its own component so the composer and the Sources/Outputs panel show
 * the same chip instead of two drifting copies.
 */
export default function AttachmentChip({
  attachment,
  visionCapable,
  onRemove
}: AttachmentChipProps): JSX.Element {
  const { t } = useTranslation()
  const [previewOpen, setPreviewOpen] = useState(false)
  // v2.9.0: an image with a model that has no vision is worth saying out loud
  // before the send, not after the agent refuses to look at it.
  const blind = attachment.kind === 'image' && !visionCapable
  const thumbnail = attachment.thumbnail

  return (
    <>
      <span
        data-testid={`attachment-chip-${attachment.name}`}
        title={`${attachment.name} (${formatAttachmentSize(attachment.bytes ?? 0)})`}
        className={`flex items-center gap-1 rounded border px-2 py-0.5 text-3xs ${
          blind ? 'border-warning/50 text-warning' : 'border-border text-fg-muted'
        }`}
      >
        {thumbnail ? (
          <button
            type="button"
            data-testid={`attachment-thumb-${attachment.name}`}
            onClick={() => setPreviewOpen(true)}
            title={t('chat.viewImage')}
            aria-label={t('chat.viewImage')}
            className="shrink-0 overflow-hidden rounded-clay-sm"
          >
            <img
              src={thumbnail}
              alt={attachment.name}
              className="h-10 w-10 rounded-clay-sm object-cover"
            />
          </button>
        ) : attachment.kind === 'image' ? (
          <ImageIcon className="h-3 w-3 shrink-0" />
        ) : (
          <FileText className="h-3 w-3 shrink-0" />
        )}
        <span className="max-w-[14rem] truncate" dir="ltr">
          {attachment.name}
        </span>
        {blind ? (
          <span className="shrink-0" title={t('chat.attachNoVisionHint')}>
            {t('chat.attachNoVision')}
          </span>
        ) : null}
        <button
          type="button"
          onClick={onRemove}
          aria-label={t('common.remove')}
          className="text-fg-subtle hover:text-danger"
        >
          <X className="h-3 w-3" />
        </button>
      </span>

      {thumbnail && previewOpen ? (
        <Modal
          open
          onClose={() => setPreviewOpen(false)}
          maxWidth="min(92vw, 48rem)"
          ariaLabel={t('chat.imagePreview')}
          closeOnBackdrop
        >
          <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2">
            <h2 className="min-w-0 truncate text-xs font-semibold text-fg-strong" dir="ltr">
              {attachment.name}
            </h2>
            <button
              type="button"
              onClick={() => setPreviewOpen(false)}
              title={t('common.close')}
              aria-label={t('common.close')}
              className="shrink-0 rounded-lg p-1 text-fg-muted hover:bg-bg-tertiary hover:text-fg"
            >
              <X className="h-4 w-4" />
            </button>
          </header>
          <div
            data-testid={`attachment-preview-${attachment.name}`}
            className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-3"
          >
            <img
              src={thumbnail}
              alt={attachment.name}
              className="max-h-[70vh] w-auto max-w-full rounded-clay-sm object-contain"
            />
          </div>
        </Modal>
      ) : null}
    </>
  )
}
