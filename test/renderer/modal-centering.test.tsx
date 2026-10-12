// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import GitSetupDialog from '../../src/renderer/src/components/GitSetupDialog'
import MigrationDialog from '../../src/renderer/src/components/MigrationDialog'
import Onboarding from '../../src/renderer/src/components/Onboarding'
import CodeSearchModal from '../../src/renderer/src/components/CodeSearchModal'
import { useStore } from '../../src/renderer/src/store'

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    vps: { list: async () => [], status: async () => ({ status: 'disconnected' }) },
    dialog: { pickDirectory: async () => null },
    search: { code: async () => [] },
    onboarding: { complete: async () => ({ completed: true }) }
  }
  useStore.setState({
    ready: false,
    onboarding: null,
    migrationOpen: false,
    settings: null,
    searchOpen: false,
    searchResults: []
  })
})

afterEach(cleanup)

/** The full-screen overlay that hosts a dialog. */
function overlay(): HTMLElement {
  const element = document.querySelector<HTMLElement>('div.fixed.inset-0')
  if (!element) throw new Error('no overlay rendered')
  return element
}

/** The dialog panel (first child of the overlay). */
function panel(): HTMLElement {
  const element = overlay().firstElementChild as HTMLElement | null
  if (!element) throw new Error('no panel rendered')
  return element
}

/** Every centering/overflow contract a dialog panel must satisfy. */
function expectCappedPanel(element: HTMLElement): void {
  expect(element.className).toContain('max-h-[calc(100vh-2rem)]')
  expect(element.className).toContain('overflow-hidden')
}

/**
 * v2.6.2 T5.5 - every modal is centred and viewport-capped so long content (or
 * a short window) scrolls instead of pushing the panel off-screen.
 */
describe('v2.6.2 T5.5 - modal centering and overflow', () => {
  it('1. GitSetupDialog is centred, width-capped and scrolls its body', () => {
    render(<GitSetupDialog serverId="s1" path="C:/gone" onClose={() => undefined} />)
    expect(overlay().className).toContain('items-center')
    expect(overlay().className).toContain('justify-center')
    const dialog = panel()
    expectCappedPanel(dialog)
    expect(dialog.className).toContain('w-[min(32rem,92vw)]')
    const body = dialog.querySelector<HTMLElement>('.overflow-y-auto')
    expect(body).toBeTruthy()
    expect(body?.className).toContain('flex-1')
    expect(body?.className).toContain('min-h-0')
  })

  it('2. MigrationDialog is centred and caps its height', () => {
    useStore.setState({
      migrationOpen: true,
      settings: {
        projects: [{ id: 'p1', name: 'Gone', path: 'C:/gone', exists: false, type: 'local' }]
      } as never
    })
    render(<MigrationDialog />)
    expect(overlay().className).toContain('items-center')
    expect(overlay().className).toContain('justify-center')
    const dialog = panel()
    expect(dialog.className).toContain('max-h-[calc(100vh-2rem)]')
    expect(dialog.className).toContain('overflow-y-auto')
  })

  it('3. Onboarding is centred and keeps its footer reachable while the body scrolls', () => {
    useStore.setState({
      ready: true,
      onboarding: { completed: false } as never,
      settings: { providers: {}, projects: [] } as never
    })
    render(<Onboarding />)
    expect(screen.getByText('Welcome to AI Desktop')).toBeTruthy()
    expect(overlay().className).toContain('items-center')
    expect(overlay().className).toContain('justify-center')
    const dialog = panel()
    expectCappedPanel(dialog)

    const body = dialog.querySelector<HTMLElement>('.overflow-y-auto')
    expect(body?.className).toContain('flex-1')
    const footer = dialog.lastElementChild as HTMLElement
    expect(footer.className).toContain('shrink-0')
    expect(footer.contains(body as Node)).toBe(false)
  })

  it('4. CodeSearchModal stays inside the viewport on narrow windows', () => {
    useStore.setState({ searchOpen: true })
    render(<CodeSearchModal />)
    expect(overlay().className).toContain('items-start')
    expect(overlay().className).toContain('px-4')
    expect(overlay().className).toContain('pt-24')
    expect(panel().className).toContain('max-h-[70vh]')
    expect(panel().className).toContain('overflow-hidden')
  })
})
