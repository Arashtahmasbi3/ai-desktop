// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import TodoPanel from '../../src/renderer/src/components/TodoPanel'
import { useStore } from '../../src/renderer/src/store'

/**
 * T11 — the deliverables section.
 *
 * What the agent presented is shown with its path, its one-line description and a way to reveal it in the file manager.
 * The reveal goes through the preload bridge; the panel never constructs a path itself.
 */
const presentedList = vi.fn()
const reveal = vi.fn()

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  presentedList.mockReset()
  reveal.mockReset()
  useStore.setState({ todos: [], presented: [], toasts: [] })
  ;(window as unknown as { api: unknown }).api = {
    todos: { list: vi.fn(async () => ({ version: 1, updatedAt: 0, items: [] })) },
    presented: { list: presentedList },
    fs: { reveal },
    settings: { setApprovalMode: vi.fn(async (mode: string) => ({ approvalMode: mode })) }
  }
  cleanup()
})

describe('deliverables section (T11)', () => {
  it('lists what was presented, with its path and description', async () => {
    presentedList.mockResolvedValue({
      version: 1,
      updatedAt: 1,
      items: [{ path: 'out/report.docx', description: 'گزارش نهایی' }]
    })
    render(<TodoPanel />)

    await waitFor(() => expect(screen.getByTestId('presented-list')).toBeTruthy())
    const rows = within(screen.getByTestId('presented-list')).getAllByRole('listitem')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.textContent).toContain('out/report.docx')
    expect(rows[0]!.textContent).toContain('گزارش نهایی')
  })

  it('reveals the file through the bridge', async () => {
    presentedList.mockResolvedValue({
      version: 1,
      updatedAt: 1,
      items: [{ path: 'out/report.docx', description: 'گزارش' }]
    })
    render(<TodoPanel />)
    await waitFor(() => expect(screen.getByTestId('presented-list')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: i18n.t('todos.reveal') }))

    expect(reveal).toHaveBeenCalledWith('out/report.docx')
  })

  it('explains an empty list', async () => {
    presentedList.mockResolvedValue({ version: 1, updatedAt: 0, items: [] })
    render(<TodoPanel />)

    await waitFor(() => expect(screen.getByText(i18n.t('todos.noDeliverables'))).toBeTruthy())
  })
})
