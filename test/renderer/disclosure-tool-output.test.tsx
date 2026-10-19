// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import ToolResultCard from '../../src/renderer/src/components/ToolResultCard'
import { useStore } from '../../src/renderer/src/store'
import { installDisclosureResources } from '../helpers/disclosure-i18n'

/**
 * U3-2 — three display levels on a long tool output.
 *
 *   inline      the first lines plus "N more lines" (the transcript stays scannable);
 *   expanded    the whole output, in place;
 *   full screen a dialog with its own scroll, a copy action, and Esc to close.
 *
 * The third level exists only for a long output — a one-line result is already whole at
 * level two, and a button that revealed nothing new would be an interface for a capability
 * that does not exist.
 */
const LONG_OUTPUT = Array.from({ length: 8 }, (_, index) => `line ${index + 1}`).join('\n')

beforeAll(async () => {
  installDisclosureResources()
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  useStore.setState({ toasts: [] })
})

afterEach(() => {
  cleanup()
  // The clipboard stub is per-test state; leaving it behind would change the next case.
  delete (navigator as unknown as Record<string, unknown>).clipboard
})

function stubClipboard(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true
  })
}

function renderLongCard(): void {
  render(
    <ToolResultCard
      name="run_command"
      ok
      command="npm run build"
      stdout={LONG_OUTPUT}
      exitCode={0}
      durationMs={2400}
    />
  )
}

describe('U3-2 tool output: inline', () => {
  it('1. shows the first lines and how many are left, without the whole output', () => {
    renderLongCard()

    const preview = screen.getByTestId('tool-card-output-preview')
    expect(preview.textContent).toContain('line 1')
    expect(preview.textContent).toContain('line 3')
    expect(preview.textContent).not.toContain('line 4')
    // 8 lines, 3 shown.
    expect(screen.getByTestId('tool-card-more-lines').textContent).toBe('5 more lines')

    // Still the collapsed card: no body, and the tail of the output is not in the DOM.
    expect(screen.getByTestId('tool-card-header').getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByTestId('tool-card-body')).toBeNull()
    expect(document.body.textContent).not.toContain('line 8')
  })

  it('2. a short output is already whole inline: no preview and no third level', () => {
    render(<ToolResultCard name="run_command" ok command="git status" stdout="clean" />)

    expect(screen.queryByTestId('tool-card-output-preview')).toBeNull()
    // Expanding is still the second level, but there is nothing to hide behind it.
    fireEvent.click(screen.getByTestId('tool-card-header'))
    expect(screen.getByTestId('tool-card-body')).toBeTruthy()
    expect(screen.queryByTestId('tool-card-fullscreen')).toBeNull()
  })
})

describe('U3-2 tool output: expanded', () => {
  it('3. expanding shows the whole output in place and retires the preview', () => {
    renderLongCard()
    fireEvent.click(screen.getByTestId('tool-card-header'))

    expect(screen.getByTestId('tool-card-body').textContent).toContain('line 8')
    expect(screen.queryByTestId('tool-card-output-preview')).toBeNull()
    expect(screen.getByTestId('tool-card-fullscreen')).toBeTruthy()
  })
})

describe('U3-2 tool output: full screen', () => {
  function openDialog(): HTMLElement {
    renderLongCard()
    fireEvent.click(screen.getByTestId('tool-card-header'))
    fireEvent.click(screen.getByTestId('tool-card-fullscreen'))
    return screen.getByRole('dialog')
  }

  it('4. is a dialog, named, holding the whole output, and focused on open', () => {
    const dialog = openDialog()

    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-label')).toContain('Output')
    expect(screen.getByTestId('tool-output-text').textContent).toContain('line 8')
    // Focus moved into the dialog, so the keyboard is not still in the transcript.
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('5. closes on Escape', () => {
    openDialog()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('6. copies the whole output, not the preview', async () => {
    const writeText = vi.fn(async () => undefined)
    stubClipboard(writeText)
    openDialog()

    fireEvent.click(screen.getByTestId('tool-output-copy'))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(LONG_OUTPUT))
    // The label confirms the copy instead of looking identical before and after.
    await waitFor(() => expect(screen.getByTestId('tool-output-copy').textContent).toContain('Copied'))
  })

  it('7. a clipboard that is unavailable is reported, never silently ignored', async () => {
    openDialog()
    fireEvent.click(screen.getByTestId('tool-output-copy'))

    await waitFor(() => expect(useStore.getState().toasts).toHaveLength(1))
    expect(useStore.getState().toasts[0]?.message).toBe('Could not copy to the clipboard.')
  })
})
