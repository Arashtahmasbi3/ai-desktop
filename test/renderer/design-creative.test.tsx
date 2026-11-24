// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import DesignPanel from '../../src/renderer/src/components/design/DesignPanel'
import { useStore } from '../../src/renderer/src/store'
import { suggestDesign, type DesignProject } from '../../src/shared/design'
import type { DesignRecipe } from '../../src/shared/design-recipe'

/**
 * Art Board phase 6 — the creative tab.
 *
 * The user writes one sentence, gets three arrangements, adds one, and can cycle its layout afterwards. The section that
 * lands in the document must be a validated `custom_section`, because that is what the builder knows how to render.
 */
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
    designMemory: { version: 1, records: [] },
    designBusy: false,
    toasts: []
  })
  return design
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
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
      memory: vi.fn(async () => ({ version: 1, records: [] })),
      remember: vi.fn(),
      forget: vi.fn()
    },
    settings: { setApprovalMode: vi.fn(async (mode: string) => ({ approvalMode: mode })) }
  }
  cleanup()
})

describe('creative tab (phase 6)', () => {
  it('turns one sentence into three arrangements and adds the chosen one', async () => {
    seed()
    render(<DesignPanel />)

    fireEvent.click(screen.getByTestId('design-tab-creative'))
    fireEvent.change(screen.getByTestId('design-creative-input'), {
      target: { value: 'بخش معرفی تیم با چهار عضو' }
    })
    fireEvent.click(screen.getByTestId('design-creative-make'))

    const suggestions = screen.getByTestId('design-creative-suggestions')
    expect(within(suggestions).getAllByRole('listitem')).toHaveLength(3)

    const before = useStore.getState().designDraft!.pages[0]!.modules.length
    fireEvent.click(within(screen.getByTestId('design-suggestion-0')).getByRole('button'))

    const modules = useStore.getState().designDraft!.pages[0]!.modules
    expect(modules).toHaveLength(before + 1)
    const added = modules.at(-1)!
    expect(added.type).toBe('custom_section')
    expect((added.props.recipe as DesignRecipe).layout).toBe('stack')
    expect(useStore.getState().designDirty).toBe(true)
  })

  it('cycles the layout of a custom section from the inspector', async () => {
    seed()
    useStore.getState().addDesignRecipe(
      'home',
      {
        layout: 'stack',
        gap: 'md',
        items: [{ primitive: 'heading', props: { text: 'عنوان' } }]
      },
      'بخش من'
    )
    render(<DesignPanel />)

    await waitFor(() => expect(document.querySelector('[data-module="custom_section"]')).toBeTruthy())
    fireEvent.click(document.querySelector('[data-module="custom_section"]') as HTMLElement)

    const inspector = screen.getByTestId('module-inspector')
    fireEvent.click(within(inspector).getByTestId('design-vary'))

    const modules = useStore.getState().designDraft!.pages[0]!.modules
    const custom = modules.find((module) => module.type === 'custom_section')!
    expect((custom.props.recipe as DesignRecipe).layout).toBe('grid-2')
  })
})
