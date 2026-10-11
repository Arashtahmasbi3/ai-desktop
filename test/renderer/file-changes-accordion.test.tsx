// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import FileChangesPanel from '../../src/renderer/src/components/FileChangesPanel'
import type { FileChangeView } from '@shared/ui'

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    fs: { applyFileChange: () => Promise.resolve(), rejectFileChange: () => Promise.resolve() }
  }
})

afterEach(cleanup)

function change(id: string, path: string): FileChangeView {
  return { id, runId: 'r1', path, before: 'const a = 1\n', after: 'const a = 2\n' }
}

/**
 * v2.6.0, C.4 - each changed file is a collapsed accordion; expanding it shows
 * the diff inline without opening a separate dialog, so long change lists stay
 * scannable.
 */
describe('v2.6.0 C.4 - per-file diff accordion', () => {
  it('1. files are collapsed by default', () => {
    render(<FileChangesPanel changes={[change('1', 'src/a.ts'), change('2', 'src/b.ts')]} />)
    const toggles = screen.getAllByRole('button', { name: /Toggle diff for/ })
    expect(toggles).toHaveLength(2)
    expect(toggles.every((button) => button.getAttribute('aria-expanded') === 'false')).toBe(true)
  })

  it('2. expanding one file reveals its diff without collapsing the list', () => {
    render(<FileChangesPanel changes={[change('1', 'src/a.ts')]} />)
    const toggle = screen.getByRole('button', { name: 'Toggle diff for src/a.ts' })
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('src/a.ts')).toBeTruthy()
  })

  it('3. the +added / -removed stat is shown per file', () => {
    render(<FileChangesPanel changes={[change('1', 'src/a.ts')]} />)
    expect(screen.getByText('+1')).toBeTruthy()
    expect(screen.getByText('-1')).toBeTruthy()
  })
})
