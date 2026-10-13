// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import FileChangesPanel from '../../src/renderer/src/components/FileChangesPanel'
import { useStore } from '../../src/renderer/src/store'
import type { FileChangeView } from '@shared/ui'

/**
 * U-5: "Apply all" used to fire every apply without awaiting, so several
 * `set({fileChanges})` calls raced each other. The loop is sequential now: the
 * next change is only applied once the previous reply has landed.
 */

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

function change(id: string): FileChangeView {
  return { id, runId: 'r1', path: `/src/${id}.ts`, before: 'a\n', after: 'b\n' }
}

beforeEach(() => {
  useStore.setState({
    fileChanges: [change('c1'), change('c2'), change('c3')],
    settings: { approvalMode: 'full', activeProjectId: 'p1', projects: [] } as never,
    toasts: []
  })
})

describe('apply-all is sequential (U-5)', () => {
  it('waits for each apply before starting the next', async () => {
    const resolvers: Array<(ok: boolean) => void> = []
    const applyChange = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolvers.push(resolve)
        })
    )
    ;(window as unknown as { api: unknown }).api = {
      agent: { applyChange, rejectChange: vi.fn(async () => true) },
      fs: { list: vi.fn(async () => []) }
    }

    render(<FileChangesPanel changes={useStore.getState().fileChanges} />)
    fireEvent.click(screen.getByRole('button', { name: 'Apply all' }))

    // Only the first apply is in flight; the other two must not have started.
    await waitFor(() => expect(applyChange).toHaveBeenCalledTimes(1))
    expect(applyChange).toHaveBeenCalledWith('c1')

    resolvers.shift()?.(true)
    await waitFor(() => expect(applyChange).toHaveBeenCalledTimes(2))
    expect(applyChange).toHaveBeenCalledWith('c2')

    resolvers.shift()?.(true)
    await waitFor(() => expect(applyChange).toHaveBeenCalledTimes(3))

    resolvers.shift()?.(true)
    await waitFor(() => expect(useStore.getState().fileChanges).toHaveLength(0))
  })

  it('applies every change and leaves nothing pending', async () => {
    const applyChange = vi.fn(async () => true)
    ;(window as unknown as { api: unknown }).api = {
      agent: { applyChange, rejectChange: vi.fn(async () => true) },
      fs: { list: vi.fn(async () => []) }
    }

    render(<FileChangesPanel changes={useStore.getState().fileChanges} />)
    fireEvent.click(screen.getByRole('button', { name: 'Apply all' }))

    await waitFor(() => expect(applyChange).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(useStore.getState().fileChanges).toHaveLength(0))
  })
})
