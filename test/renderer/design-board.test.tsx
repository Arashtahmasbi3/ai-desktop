// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import DesignPanel from '../../src/renderer/src/components/design/DesignPanel'
import { useStore } from '../../src/renderer/src/store'
import { suggestDesign, type DesignProject } from '../../src/shared/design'

/**
 * Art Board phase 1 — the board.
 *
 * This is where a non-technical user actually works, so the tests walk the gestures they have: add a section from the
 * palette, undo it, redo it, edit its title and note, remove it, drop one on the canvas, add a page, and save. Every
 * edit goes through the draft, so the saved document is only touched by Save.
 */
const save = vi.fn()

function seed(): DesignProject {
  const design = suggestDesign(
    {
      kind: 'website',
      type: 'corporate',
      needs: ['contact'],
      brand: 'blue',
      locale: 'fa',
      siteName: 'شرکت نمونه'
    },
    { id: 'd-1', now: 1_000 }
  )
  useStore.setState({
    designProjects: [
      { id: 'd-1', name: design.name, kind: 'website', type: 'corporate', pages: design.pages.length, updatedAt: 1_000 }
    ],
    activeDesign: design,
    designDraft: structuredClone(design),
    designPast: [],
    designFuture: [],
    designDirty: false,
    designBusy: false,
    toasts: []
  })
  return design
}

function homeModuleCount(): number {
  return useStore.getState().designDraft?.pages[0]?.modules.length ?? 0
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  save.mockReset()
  save.mockImplementation(async (design: unknown) => design)
  ;(window as unknown as { api: unknown }).api = {
    design: {
      list: vi.fn(async () => []),
      create: vi.fn(),
      get: vi.fn(async () => null),
      save,
      remove: vi.fn(async () => true)
    },
    settings: { setApprovalMode: vi.fn(async (mode: string) => ({ approvalMode: mode })) }
  }
  cleanup()
})

describe('the board (phase 1)', () => {
  it('adds a section from the palette, undoes it, and redoes it', () => {
    seed()
    render(<DesignPanel />)
    const before = homeModuleCount()

    const heroRow = screen.getByTestId('palette-hero')
    fireEvent.click(within(heroRow).getByRole('button', { name: /Add/ }))

    expect(homeModuleCount()).toBe(before + 1)
    expect(useStore.getState().designDirty).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: i18n.t('design.undo') }))
    expect(homeModuleCount()).toBe(before)

    fireEvent.click(screen.getByRole('button', { name: i18n.t('design.redo') }))
    expect(homeModuleCount()).toBe(before + 1)
  })

  it('edits the selected section title and note, and removes it', () => {
    const design = seed()
    render(<DesignPanel />)

    const firstId = design.pages[0]!.modules[0]!.id
    fireEvent.click(screen.getByTestId(`canvas-module-${firstId}`))
    const inspector = screen.getByTestId('module-inspector')

    fireEvent.change(within(inspector).getByLabelText(i18n.t('design.fieldTitle')), {
      target: { value: 'عنوان تازه' }
    })
    fireEvent.change(within(inspector).getByLabelText(i18n.t('design.fieldNotes')), {
      target: { value: 'دکمهٔ تماس همیشه بماند' }
    })

    const draft = useStore.getState().designDraft!
    expect(draft.pages[0]!.modules[0]!.props.title).toBe('عنوان تازه')
    expect(draft.pages[0]!.modules[0]!.notes).toBe('دکمهٔ تماس همیشه بماند')

    const before = homeModuleCount()
    fireEvent.click(within(inspector).getByRole('button', { name: i18n.t('design.removeModule') }))
    expect(homeModuleCount()).toBe(before - 1)
  })

  it('accepts a dropped section on the canvas', () => {
    seed()
    render(<DesignPanel />)
    const before = homeModuleCount()

    fireEvent.drop(screen.getByTestId('design-canvas'), {
      dataTransfer: { getData: () => 'footer' }
    })

    expect(homeModuleCount()).toBe(before + 1)
  })

  it('adds a page from the sidebar', () => {
    const design = seed()
    render(<DesignPanel />)
    const before = design.pages.length

    fireEvent.change(screen.getByPlaceholderText(i18n.t('design.pageNamePlaceholder')), {
      target: { value: 'سوالات' }
    })
    fireEvent.click(within(screen.getByTestId('design-pages')).getByRole('button', { name: i18n.t('design.add') }))

    const pages = useStore.getState().designDraft!.pages
    expect(pages).toHaveLength(before + 1)
    expect(pages.at(-1)?.name).toBe('سوالات')
  })

  it('saves the draft only when the user asks, and clears the dirty flag', async () => {
    seed()
    render(<DesignPanel />)

    fireEvent.click(within(screen.getByTestId('palette-hero')).getByRole('button', { name: /Add/ }))
    expect(save).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('design-save'))

    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(useStore.getState().designDirty).toBe(false)
  })

  it('refuses to save a document the builder would reject', async () => {
    seed()
    const broken = useStore.getState().designDraft!
    broken.pages[0]!.modules.push({ id: 'bad', type: 'not_a_module', props: {} })
    useStore.setState({ designDraft: broken, designDirty: true })
    render(<DesignPanel />)

    fireEvent.click(screen.getByTestId('design-save'))

    await vi.waitFor(() => expect(useStore.getState().toasts.some((toast) => toast.kind === 'error')).toBe(true))
    expect(save).not.toHaveBeenCalled()
  })
})
