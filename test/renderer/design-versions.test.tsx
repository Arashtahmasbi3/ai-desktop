// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import DesignPanel from '../../src/renderer/src/components/design/DesignPanel'
import { useStore } from '../../src/renderer/src/store'
import { suggestDesign, type DesignProject } from '../../src/shared/design'

/**
 * Art Board phase 4 — the versions panel.
 *
 * What a user needs from it: see what happened, and go back. The test walks exactly that: open the tab, read the rows,
 * press restore, and check that the board now shows the old document and the service was asked for that version.
 */
const restore = vi.fn()
const versions = vi.fn()

function seed(): DesignProject {
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
    designBusy: false,
    toasts: []
  })
  return design
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  restore.mockReset()
  versions.mockReset()
  versions.mockResolvedValue([
    { version: 2, at: 2_000, by: 'board', summary: 'یک بخش ویرایش شد' },
    { version: 1, at: 1_000, by: 'wizard', summary: 'نسخهٔ اولیه' }
  ])
  restore.mockImplementation(async () => {
    const old = seed()
    return { ...old, name: 'نسخهٔ اول' }
  })
  ;(window as unknown as { api: unknown }).api = {
    design: {
      list: vi.fn(async () => []),
      create: vi.fn(),
      get: vi.fn(async () => null),
      save: vi.fn(async (design: unknown) => design),
      remove: vi.fn(async () => true),
      build: vi.fn(),
      openPath: vi.fn(async () => ''),
      versions,
      version: vi.fn(async () => null),
      restore
    },
    settings: { setApprovalMode: vi.fn(async (mode: string) => ({ approvalMode: mode })) }
  }
  cleanup()
})

describe('versions panel (phase 4)', () => {
  it('lists the timeline newest first with who wrote it', async () => {
    seed()
    render(<DesignPanel />)

    fireEvent.click(screen.getByTestId('design-tab-versions'))

    await waitFor(() => expect(screen.getByTestId('design-version-2')).toBeTruthy())
    expect(within(screen.getByTestId('design-version-2')).getByText(i18n.t('design.current'))).toBeTruthy()
    expect(within(screen.getByTestId('design-version-2')).getByText('یک بخش ویرایش شد')).toBeTruthy()
    expect(screen.getByTestId('design-version-1').textContent).toContain(i18n.t('design.byWizard'))
    expect(versions).toHaveBeenCalledWith('d-1')
  })

  it('restores an old version and reloads the board with it', async () => {
    seed()
    render(<DesignPanel />)
    fireEvent.click(screen.getByTestId('design-tab-versions'))
    await waitFor(() => expect(screen.getByTestId('design-version-1')).toBeTruthy())

    fireEvent.click(
      within(screen.getByTestId('design-version-1')).getByRole('button', { name: i18n.t('design.restore') })
    )

    await waitFor(() => expect(restore).toHaveBeenCalledWith('d-1', 1))
    await waitFor(() => expect(useStore.getState().designDraft?.name).toBe('نسخهٔ اول'))
    expect(useStore.getState().designDirty).toBe(false)
  })

  it('does not offer to restore the version that is already current', async () => {
    seed()
    render(<DesignPanel />)
    fireEvent.click(screen.getByTestId('design-tab-versions'))
    await waitFor(() => expect(screen.getByTestId('design-version-2')).toBeTruthy())

    expect(within(screen.getByTestId('design-version-2')).queryByRole('button')).toBeNull()
  })
})
