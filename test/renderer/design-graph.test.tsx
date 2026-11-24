// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import DesignPanel from '../../src/renderer/src/components/design/DesignPanel'
import { useStore } from '../../src/renderer/src/store'
import { suggestDesign, validateDesign, type DesignProject } from '../../src/shared/design'

/**
 * Art Board phase 2 — the connections view.
 *
 * The page status list is the point: it answers "can a visitor reach this page?" with the same traversal the validator
 * uses, so a page the user added and forgot to connect is visible before the build rather than after it.
 */
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
    designProjects: [],
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

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    design: {
      list: vi.fn(async () => []),
      create: vi.fn(),
      get: vi.fn(async () => null),
      save: vi.fn(async (design: unknown) => design),
      remove: vi.fn(async () => true)
    },
    settings: { setApprovalMode: vi.fn(async (mode: string) => ({ approvalMode: mode })) }
  }
  cleanup()
})

describe('connections (phase 2)', () => {
  it('shows a page with no path as unreachable, and connecting it fixes the badge', () => {
    seed()
    useStore.getState().addDesignPage('صفحهٔ تازه')
    render(<DesignPanel />)

    fireEvent.click(screen.getByTestId('design-tab-graph'))
    const list = screen.getByTestId('design-reachability')
    const orphanRow = within(list)
      .getByText('صفحهٔ تازه')
      .closest('li') as HTMLElement
    expect(within(orphanRow).getByText(i18n.t('design.unreachable'))).toBeTruthy()

    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[1]!, { target: { value: 'page-6' } })
    fireEvent.click(screen.getByTestId('design-add-edge'))

    const fixedRow = within(screen.getByTestId('design-reachability'))
      .getByText('صفحهٔ تازه')
      .closest('li') as HTMLElement
    expect(within(fixedRow).getByText(i18n.t('design.reachable'))).toBeTruthy()
    expect(useStore.getState().designDraft?.edges.some((edge) => edge.from === 'home' && edge.to === 'page-6')).toBe(true)
  })

  it('adds an edge and renders it in the list, then removes it', () => {
    seed()
    render(<DesignPanel />)
    fireEvent.click(screen.getByTestId('design-tab-graph'))
    const before = useStore.getState().designDraft!.edges.length

    // home → about already exists as a click edge; a submit edge is a different connection.
    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[2]!, { target: { value: 'submit' } })
    fireEvent.click(screen.getByTestId('design-add-edge'))

    expect(useStore.getState().designDraft?.edges).toHaveLength(before + 1)
    expect(screen.getByTestId('design-edges')).toBeTruthy()

    const edges = screen.getByTestId('design-edges')
    fireEvent.click(within(edges).getAllByRole('button')[0]!)

    expect(useStore.getState().designDraft?.edges).toHaveLength(before)
  })

  it('keeps the saved document valid after a connection is added', () => {
    seed()
    render(<DesignPanel />)
    fireEvent.click(screen.getByTestId('design-tab-graph'))
    fireEvent.click(screen.getByTestId('design-add-edge'))

    const draft = useStore.getState().designDraft!
    expect(validateDesign(draft).ok).toBe(true)
  })
})
