import type { DocumentPreview } from '@shared/document-preview'
import i18n from '../i18n'

/**
 * A read-only preview for a Word document, a spreadsheet or a CSV (T10).
 *
 * It shows what the file contains — paragraphs, or a small table — and says so when it cannot: an unsupported file gets
 * a sentence, never an empty pane. Nothing here edits, and a workbook is capped by the parser, so a 50 000-row sheet
 * cannot freeze the window.
 */
export default function DocumentPreviewPane({
  path,
  data
}: {
  path: string
  data: DocumentPreview
}): React.JSX.Element {
  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-primary" data-testid="document-preview">
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="truncate font-mono text-2xs text-fg-muted" dir="ltr" title={path}>
          {path}
        </span>
        <span className="shrink-0 text-3xs text-fg-muted">
          {i18n.t('documentPreview.readOnly')}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {data.kind === 'docx' ? (
          <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-fg" data-testid="document-text">
            {data.text || i18n.t('documentPreview.emptyDocument')}
          </pre>
        ) : data.kind === 'unsupported' ? (
          <p className="text-xs text-fg-muted" data-testid="document-unsupported">
            {i18n.t('documentPreview.unsupported')} — {data.reason}
          </p>
        ) : data.rows.length === 0 ? (
          <p className="text-xs text-fg-muted">{i18n.t('documentPreview.emptySheet')}</p>
        ) : (
          <table className="w-full border-collapse text-xs" data-testid="document-table">
            <tbody>
              {data.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  <th className="w-8 border-b border-border px-1 py-0.5 text-3xs text-fg-subtle">
                    {rowIndex + 1}
                  </th>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="border-b border-border px-1 py-0.5 text-fg">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
