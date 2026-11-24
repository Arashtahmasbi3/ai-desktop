// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import TodoPanel from '../../src/renderer/src/components/TodoPanel'
import { useStore } from '../../src/renderer/src/store'

/**
 * T04 — the checklist panel.
 *
 * Read-only by design: the list belongs to the run. The test pins what a user sees — the items in order, a completed
 * one struck through by its status attribute, and an empty state that explains where the list comes from.
 */
const list = vi.fn()

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  list.mockReset()
  useStore.setState({ todos: [], toasts: [] })
  ;(window as unknown as { api: unknown }).api = {
    todos: { list },
    settings: { setApprovalMode: vi.fn(async (mode: string) => ({ approvalMode: mode })) }
  }
  cleanup()
})

describe('TodoPanel (T04)', () => {
  it('renders the list the agent wrote, with its statuses', async () => {
    list.mockResolvedValue({
      version: 1,
      updatedAt: 1,
      items: [
        { id: 't1', text: 'wire the store', status: 'completed' },
        { id: 't2', text: 'write the tests', status: 'in_progress' }
      ]
    })
    render(<TodoPanel />)

    await waitFor(() => expect(screen.getByTestId('todo-list')).toBeTruthy())
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.getAttribute('data-status')).toBe('completed')
    expect(rows[1]!.getAttribute('data-status')).toBe('in_progress')
    expect(screen.getByText(i18n.t('todos.inProgress'))).toBeTruthy()
  })

  it('explains an empty list instead of showing nothing', async () => {
    list.mockResolvedValue({ version: 1, updatedAt: 0, items: [] })
    render(<TodoPanel />)

    await waitFor(() => expect(screen.getByText(i18n.t('todos.empty'))).toBeTruthy())
  })

  it('re-reads when the user asks', async () => {
    list.mockResolvedValue({ version: 1, updatedAt: 0, items: [] })
    render(<TodoPanel />)
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: i18n.t('todos.refresh') }))

    await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
  })
})
