// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import FileChangesPanel from '../../src/renderer/src/components/FileChangesPanel'
import { useStore } from '../../src/renderer/src/store'
import type { FileChangeView } from '@shared/ui'
import { installDisclosureResources } from '../helpers/disclosure-i18n'

/**
 * U3-2 — three display levels on the file-change surface.
 *
 *   inline      the headline with the totals, one row per file, no diff bytes;
 *   expanded    the diff of the selected file, in place;
 *   full screen the whole change set in a dialog, with previous/next navigation.
 *
 * The inline row is also held to "at most two actions, no destructive one": Reject all moved
 * into the full-screen view, where it is a deliberate act.
 */
beforeAll(async () => {
  installDisclosureResources()
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  useStore.setState({
    fileChanges: [],
    // Avoids the confirm() gate on the destructive paths; no test here applies anything.
    settings: { approvalMode: 'full', activeProjectId: 'p1', projects: [] } as never,
    toasts: []
  })
  ;(window as unknown as { api: unknown }).api = {
    fs: { applyFileChange: () => Promise.resolve(), rejectFileChange: () => Promise.resolve() }
  }
})

afterEach(cleanup)

function change(id: string, path: string, before: string, after: string): FileChangeView {
  return { id, runId: 'r1', path, before, after }
}

const CHANGES: FileChangeView[] = [
  change('c1', 'src/a.ts', 'const a = 1\n', 'const a = 2\n'),
  change('c2', 'src/b.ts', 'const b = 1\n', 'const b = 2\n'),
  change('c3', 'src/c.ts', 'one\n', 'two\n')
]

describe('U3-2 file change: inline', () => {
  it('1. leads with the headline and the totals, and renders no diff yet', () => {
    render(<FileChangesPanel changes={CHANGES} />)

    // "Proposed file changes (3)" with the summed diffstat.
    expect(screen.getByText('(3)')).toBeTruthy()
    const totals = screen.getByTestId('file-changes-totals')
    // Three one-line replacements, so the headline total is the sum of the rows: +3 and
    // 3 removed (each row is +1/−1).
    expect(totals.textContent).toContain('+3')
    expect(totals.textContent).toContain('−3')

    // One row per file, each with its own numbers.
    expect(screen.getByText('src/a.ts')).toBeTruthy()
    expect(screen.getByText('src/b.ts')).toBeTruthy()
    expect(screen.getByText('src/c.ts')).toBeTruthy()

    // The diff itself is level two: no `before`/`after` split header in the transcript.
    expect(screen.queryByText('before')).toBeNull()
    expect(screen.queryByText('after')).toBeNull()
  })

  it('2. keeps the inline row to two actions, neither of them destructive', () => {
    render(<FileChangesPanel changes={CHANGES} />)

    expect(screen.getByRole('button', { name: /Apply all/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Review all files/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Reject all' })).toBeNull()
  })
})

describe('U3-2 file change: expanded', () => {
  it('3. expanding one row shows that file diff in place, and only that one', () => {
    render(<FileChangesPanel changes={CHANGES} />)
    rowsHaveNoDiff()

    const toggle = screen.getByRole('button', { name: 'Toggle diff for src/a.ts' })
    fireEvent.click(toggle)

    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    // Exactly one diff viewer, with the split before/after header.
    expect(screen.getAllByText('before')).toHaveLength(1)
    // The diff is syntax-highlighted into token spans, so read the container's text.
    expect(document.body.textContent).toContain('const a = 1')
    // The other files stay folded.
    expect(
      screen.getByRole('button', { name: 'Toggle diff for src/b.ts' }).getAttribute('aria-expanded')
    ).toBe('false')
    // And the third level is offered from the expanded diff.
    expect(screen.getByTestId('file-change-fullscreen-src/a.ts')).toBeTruthy()
  })
})

describe('U3-2 file change: full screen', () => {
  function openFullScreen(): HTMLElement {
    render(<FileChangesPanel changes={CHANGES} />)
    fireEvent.click(screen.getByRole('button', { name: /Review all files/ }))
    return screen.getByRole('dialog')
  }

  it('4. is a dialog that opens on the first file, focused, with the whole change set', () => {
    const dialog = openFullScreen()

    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-label')).toBe('src/a.ts')
    expect(within(dialog).getByTestId('file-review-position').textContent).toBe('1 / 3')
    expect(within(dialog).getByTestId('file-review-diff').textContent).toContain('const a = 2')
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('5. navigates between files without leaving the dialog', () => {
    openFullScreen()

    fireEvent.click(screen.getByTestId('file-review-next'))
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('src/b.ts')
    expect(screen.getByTestId('file-review-position').textContent).toBe('2 / 3')
    expect(screen.getByTestId('file-review-diff').textContent).toContain('const b = 2')

    // Wrapping backwards from the first file lands on the last one.
    fireEvent.click(screen.getByTestId('file-review-previous'))
    fireEvent.click(screen.getByTestId('file-review-previous'))
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('src/c.ts')
    expect(screen.getByTestId('file-review-position').textContent).toBe('3 / 3')
  })

  it('6. holds the destructive action, which the inline row deliberately lacks', () => {
    openFullScreen()
    expect(screen.getByRole('button', { name: 'Reject all' })).toBeTruthy()
  })

  it('7. closes on Escape', () => {
    openFullScreen()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

/** Assert no diff viewer is mounted at level one. */
function rowsHaveNoDiff(): void {
  expect(screen.queryByText('before')).toBeNull()
}
