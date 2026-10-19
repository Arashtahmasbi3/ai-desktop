import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Eye,
  FileOutput,
  FileSearch,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Globe,
  Plus,
  SlidersHorizontal,
  X
} from 'lucide-react'
import { RUN_OUTPUT_KINDS, type RunOutputKind } from '@shared/run-outputs'
import { useStore } from '../store'
import type { PendingAttachment } from '../lib/context-gate'
import AttachmentChip from './AttachmentChip'
import Modal from './ui/Modal'

/** i18n key per output kind; the picker and the list share it. */
const KIND_KEY: Record<RunOutputKind, string> = {
  file: 'runPanel.kindFile',
  site: 'runPanel.kindSite',
  folder: 'runPanel.kindFolder'
}

export interface SourcesOutputsPanelProps {
  /** The attachments registered for this send — the same list the composer chips show. */
  attached: PendingAttachment[]
  /** Whether the selected model can be shown an image (drives the chip warning). */
  visionCapable: boolean
  onRemoveAttachment: (id: string) => void
  /** Opens the existing `dialog:pickFile` flow; no new picker is introduced here. */
  onAddFiles: () => void
  /** Opens the existing `dialog:pickDirectory` flow and records the folder as a source. */
  onAddFolder: () => void
  /** Opens the existing context-preview modal (the single "what will be sent" view). */
  onViewAll: () => void
  onClose: () => void
}

/**
 * The composer's Sources / Outputs panel (v3.0).
 *
 * Two honest lists: **Outputs** is what the user declares the run should produce,
 * **Sources** is what it may read. Both are only ever *prompt text* — the declared
 * outputs are appended to the task by `store.send` through `buildRunIntentBlock`,
 * and nothing here grants access, widens the IPC surface or bypasses an approval.
 *
 * "Web search" and "GitHub repo" are shown as disabled coming-soon entries on
 * purpose: web search needs a new agent tool, a network-policy decision and an
 * approval flow, which is deliberately out of scope for this change.
 */
export default function SourcesOutputsPanel({
  attached,
  visionCapable,
  onRemoveAttachment,
  onAddFiles,
  onAddFolder,
  onViewAll,
  onClose
}: SourcesOutputsPanelProps): JSX.Element {
  const { t } = useTranslation()
  const outputs = useStore((state) => state.runOutputs)
  const sources = useStore((state) => state.runSources)
  const addRunOutput = useStore((state) => state.addRunOutput)
  const removeRunOutput = useStore((state) => state.removeRunOutput)
  const removeRunSource = useStore((state) => state.removeRunSource)
  const [kind, setKind] = useState<RunOutputKind>('file')
  const [target, setTarget] = useState('')

  const submitOutput = (): void => {
    addRunOutput(kind, target.trim() || undefined)
    setTarget('')
  }

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth="min(92vw, 30rem)"
      ariaLabel={t('runPanel.title')}
      closeOnBackdrop
    >
      <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-fg-strong">
          <SlidersHorizontal className="h-3.5 w-3.5 text-fg-muted" />
          {t('runPanel.title')}
        </h2>
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

      <div
        data-testid="sources-outputs-panel"
        className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3 text-xs text-fg"
      >
        <section>
          <p className="mb-1 flex items-center gap-1.5 text-3xs font-semibold text-fg-subtle">
            <FileOutput className="h-3 w-3" />
            {t('runPanel.outputs')}
          </p>
          <p className="mb-2 text-3xs text-fg-subtle">{t('runPanel.outputsHint')}</p>

          <div className="flex flex-wrap items-center gap-1.5">
            {RUN_OUTPUT_KINDS.map((option) => (
              <button
                key={option}
                type="button"
                data-testid={`run-output-kind-${option}`}
                aria-pressed={option === kind}
                data-selected={option === kind}
                onClick={() => setKind(option)}
                /*
                 * v4.0: the segmented control is part of the surface vocabulary now. The selected
                 * state is filled and ink-bordered rather than accent-tinted, so it reads as
                 * "chosen" by structure instead of by a colour wash nobody can distinguish from a
                 * hover.
                 */
                className="ui-tab text-3xs"
              >
                {t(KIND_KEY[option])}
              </button>
            ))}
          </div>

          <div className="mt-1.5 flex items-center gap-1.5">
            <input
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  submitOutput()
                }
              }}
              placeholder={t('runPanel.targetPlaceholder')}
              aria-label={t('runPanel.targetLabel')}
              data-testid="run-output-target"
              dir="ltr"
              className="ui-inset min-w-0 flex-1 rounded-shape-sm px-2 py-1 text-3xs text-fg-strong outline-none placeholder:text-fg-subtle"
            />
            <button
              type="button"
              onClick={submitOutput}
              data-testid="run-output-add"
              className="ui-press flex shrink-0 items-center gap-1 rounded-shape-sm bg-accent-solid px-2 py-1 text-3xs text-accent-fg hover:bg-accent-solid-hover"
            >
              <Plus className="h-3 w-3" />
              {t('runPanel.add')}
            </button>
          </div>

          {outputs.length === 0 ? (
            <p className="mt-2 text-3xs text-fg-subtle">{t('runPanel.outputsEmpty')}</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {outputs.map((output) => (
                <li
                  key={output.id}
                  data-testid={`run-output-${output.id}`}
                  className="flex items-center gap-1.5 rounded-shape-sm border border-border bg-bg-tertiary px-2 py-1 text-3xs"
                >
                  <span className="shrink-0 font-medium text-fg">{t(KIND_KEY[output.kind])}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-fg-muted" dir="ltr">
                    {output.target ?? ''}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeRunOutput(output.id)}
                    aria-label={t('runPanel.removeOutput')}
                    className="shrink-0 text-fg-subtle hover:text-danger"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <p className="mb-1 flex items-center gap-1.5 text-3xs font-semibold text-fg-subtle">
            <FileSearch className="h-3 w-3" />
            {t('runPanel.sources')}
          </p>
          <p className="mb-2 text-3xs text-fg-subtle">{t('runPanel.sourcesHint')}</p>

          {attached.length === 0 ? (
            <p className="text-3xs text-fg-subtle">{t('runPanel.sourcesEmpty')}</p>
          ) : (
            <div className="mb-2 flex flex-wrap gap-1" data-testid="run-sources-chips">
              {attached.map((item) => (
                <AttachmentChip
                  key={item.id}
                  attachment={item}
                  visionCapable={visionCapable}
                  onRemove={() => onRemoveAttachment(item.id)}
                />
              ))}
            </div>
          )}

          {sources.length > 0 ? (
            <ul className="mb-2 space-y-1">
              {sources.map((source) => (
                <li
                  key={source.id}
                  data-testid={`run-source-${source.id}`}
                  className="flex items-center gap-1.5 rounded-shape-sm border border-border bg-bg-tertiary px-2 py-1 text-3xs"
                >
                  <FolderOpen className="h-3 w-3 shrink-0 text-fg-subtle" />
                  <span className="min-w-0 flex-1 truncate font-mono text-fg-muted" dir="ltr">
                    {source.value}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeRunSource(source.id)}
                    aria-label={t('runPanel.removeSource')}
                    className="shrink-0 text-fg-subtle hover:text-danger"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={onAddFiles}
              data-testid="run-sources-add-files"
              className="flex items-center gap-1 rounded-shape-sm border border-border px-2 py-0.5 text-3xs text-fg-muted hover:bg-bg-tertiary hover:text-fg"
            >
              <Plus className="h-3 w-3" />
              {t('runPanel.addFiles')}
            </button>
            <button
              type="button"
              onClick={onAddFolder}
              data-testid="run-sources-add-folder"
              className="flex items-center gap-1 rounded-shape-sm border border-border px-2 py-0.5 text-3xs text-fg-muted hover:bg-bg-tertiary hover:text-fg"
            >
              <FolderPlus className="h-3 w-3" />
              {t('runPanel.addFolder')}
            </button>
            <button
              type="button"
              onClick={onViewAll}
              data-testid="run-sources-view-all"
              className="flex items-center gap-1 rounded-shape-sm border border-border px-2 py-0.5 text-3xs text-fg-muted hover:bg-bg-tertiary hover:text-fg"
            >
              <Eye className="h-3 w-3" />
              {t('runPanel.viewAll')}
            </button>
          </div>

          {/* Deliberately not implemented. The tooltip says why, so nobody assumes a bug. */}
          <div className="mt-2 flex flex-col gap-1">
            <span className="flex items-center gap-1.5" title={t('runPanel.webSearchHint')}>
              <button
                type="button"
                disabled
                data-testid="run-source-web-search"
                title={t('runPanel.webSearchHint')}
                className="flex cursor-not-allowed items-center gap-1 rounded-shape-sm border border-dashed border-border px-2 py-0.5 text-3xs text-fg-subtle opacity-70"
              >
                <Globe className="h-3 w-3" />
                {t('runPanel.webSearch')}
              </button>
              <span className="text-3xs text-fg-subtle">{t('runPanel.comingSoon')}</span>
            </span>
            <span className="flex items-center gap-1.5" title={t('runPanel.githubHint')}>
              <button
                type="button"
                disabled
                data-testid="run-source-github"
                title={t('runPanel.githubHint')}
                className="flex cursor-not-allowed items-center gap-1 rounded-shape-sm border border-dashed border-border px-2 py-0.5 text-3xs text-fg-subtle opacity-70"
              >
                <GitBranch className="h-3 w-3" />
                {t('runPanel.githubRepo')}
              </button>
              <span className="text-3xs text-fg-subtle">{t('runPanel.comingSoon')}</span>
            </span>
          </div>
        </section>
      </div>
    </Modal>
  )
}
