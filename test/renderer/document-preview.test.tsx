// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import DocumentPreviewPane from '../../src/renderer/src/components/DocumentPreviewPane'

/**
 * T10 — the preview pane.
 *
 * Three shapes, and the honesty rule: a file that cannot be previewed says why instead of rendering an empty box.
 */
beforeAll(async () => {
  await i18n.changeLanguage('en')
})

describe('DocumentPreviewPane (T10)', () => {
  it('shows a spreadsheet as a table', () => {
    render(
      <DocumentPreviewPane
        path="report.xlsx"
        data={{ kind: 'xlsx', rows: [['name', 'qty'], ['tea', '12']] }}
      />
    )

    const table = screen.getByTestId('document-table')
    expect(table.textContent).toContain('name')
    expect(table.textContent).toContain('tea')
    cleanup()
  })

  it('shows a Word document as text', () => {
    render(<DocumentPreviewPane path="letter.docx" data={{ kind: 'docx', text: 'خط اول\nخط دوم' }} />)

    expect(screen.getByTestId('document-text').textContent).toContain('خط دوم')
    cleanup()
  })

  it('explains an unsupported file instead of showing an empty pane', () => {
    render(
      <DocumentPreviewPane path="scan.docx" data={{ kind: 'unsupported', reason: 'ساختار ZIP پیدا نشد.' }} />
    )

    const message = screen.getByTestId('document-unsupported')
    expect(message.textContent).toContain(i18n.t('documentPreview.unsupported'))
    expect(message.textContent).toContain('ZIP')
    cleanup()
  })
})
