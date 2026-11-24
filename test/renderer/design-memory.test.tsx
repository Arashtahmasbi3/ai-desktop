// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import DesignPanel from '../../src/renderer/src/components/design/DesignPanel'
import { useStore } from '../../src/renderer/src/store'
import { suggestDesign } from '../../src/shared/design'
import type { DesignMemory } from '../../src/shared/design-memory'

/**
 * Art Board phase 5 — the memory panel.
 *
 * A user has to be able to see what the assistant remembers and make it forget, without reading a JSON file. The test
 * also pins that forgetting asks the service; a panel that only hides the row would lie on the next load.
 */
const forget = vi.fn()

const memory: DesignMemory = {
  version: 1,
  records: [
    {
      id: 'mem-1',
      layer: 'decision',
      statement: 'دکمهٔ تماس در هدر همهٔ صفحه‌ها باشد',
      scope: 'global',
      source: { kind: 'user', messageId: 'm1', text: 'همیشه دکمه تماس بالای سایت باشه' },
      createdAt: 1_000,
      status: 'active',
      confidence: 'high'
    },
    {
      id: 'mem-2',
      layer: 'decision',
      statement: 'گالری سه‌ستونه باشد',
      scope: 'page:home',
      source: { kind: 'accepted', text: 'این پیشنهاد را قبول می‌کنم' },
      createdAt: 2_000,
      status: 'superseded',
      confidence: 'high'
    }
  ]
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  forget.mockReset()
  forget.mockImplementation(async (_id: string, recordId: string) => ({
    version: 1,
    records: memory.records.map((record) =>
      record.id === recordId ? { ...record, status: 'forgotten' as const } : record
    )
  }))
  const design = suggestDesign(
    { kind: 'website', type: 'corporate', needs: ['contact'], brand: 'blue', locale: 'fa', siteName: 'شرکت نمونه' },
    { id: 'd-1', now: 1_000 }
  )
  useStore.setState({
    designProjects: [],
    activeDesign: design,
    designDraft: structuredClone(design),
    designPast: [],
    designFuture: [],
    designDirty: false,
    designBuildResult: null,
    designVersions: [],
    designMemory: memory,
    designBusy: false,
    toasts: []
  })
  ;(window as unknown as { api: unknown }).api = {
    design: {
      list: vi.fn(async () => []),
      create: vi.fn(),
      get: vi.fn(async () => null),
      save: vi.fn(async (entry: unknown) => entry),
      remove: vi.fn(async () => true),
      build: vi.fn(),
      openPath: vi.fn(async () => ''),
      versions: vi.fn(async () => []),
      getVersion: vi.fn(async () => null),
      restore: vi.fn(),
      memory: vi.fn(async () => memory),
      remember: vi.fn(),
      forget
    },
    settings: { setApprovalMode: vi.fn(async (mode: string) => ({ approvalMode: mode })) }
  }
  cleanup()
})

describe('memory panel (phase 5)', () => {
  it('shows what is remembered and the sentence it came from', async () => {
    render(<DesignPanel />)
    fireEvent.click(screen.getByTestId('design-tab-memory'))

    await waitFor(() => expect(screen.getByTestId('design-memory-mem-1')).toBeTruthy())
    const row = screen.getByTestId('design-memory-mem-1')
    expect(within(row).getByText('دکمهٔ تماس در هدر همهٔ صفحه‌ها باشد')).toBeTruthy()
    expect(within(row).getByText(/همیشه دکمه تماس بالای سایت باشه/)).toBeTruthy()
    // A superseded record is history, not a row.
    expect(screen.queryByTestId('design-memory-mem-2')).toBeNull()
  })

  it('forgets through the service and removes the row', async () => {
    render(<DesignPanel />)
    fireEvent.click(screen.getByTestId('design-tab-memory'))
    await waitFor(() => expect(screen.getByTestId('design-memory-mem-1')).toBeTruthy())

    fireEvent.click(
      within(screen.getByTestId('design-memory-mem-1')).getByRole('button', {
        name: i18n.t('design.memoryForget')
      })
    )

    await waitFor(() => expect(forget).toHaveBeenCalledWith('d-1', 'mem-1'))
    await waitFor(() => expect(screen.queryByTestId('design-memory-mem-1')).toBeNull())
  })
})
