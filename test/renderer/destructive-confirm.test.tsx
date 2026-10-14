// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import i18n from '../../src/renderer/src/i18n'
import MessageBubble from '../../src/renderer/src/components/MessageBubble'
import TerminalPanel from '../../src/renderer/src/components/TerminalPanel'
import Titlebar from '../../src/renderer/src/components/Titlebar'
import { useStore } from '../../src/renderer/src/store'

/**
 * U-4: destructive actions ask first (the Sidebar's `window.confirm` pattern).
 * U-5: a failed clipboard write is surfaced instead of silently doing nothing.
 */

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

beforeEach(() => {
  useStore.setState({
    toasts: [],
    terminalLines: [{ id: 'l1', kind: 'command', text: '$ ls' }],
    messages: [{ id: 'm1', role: 'user', content: 'hello', at: 1 }],
    activeChatId: null,
    settings: { activeProjectId: 'p1', projects: [] } as never
  })
  ;(window as unknown as { api: unknown }).api = {
    window: {
      isMaximized: vi.fn(async () => false),
      toggleMaximize: vi.fn(async () => false)
    },
    events: { on: vi.fn(() => () => {}) }
  }
})

describe('destructive actions confirm first (U-4)', () => {
  it('wiping the terminal history needs confirmation', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<TerminalPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

    expect(confirm).toHaveBeenCalled()
    expect(useStore.getState().terminalLines).toHaveLength(1)

    confirm.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(useStore.getState().terminalLines).toHaveLength(0)
  })

  it('starting a new session from the titlebar needs confirmation', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<Titlebar />)

    fireEvent.click(screen.getByRole('button', { name: 'New chat' }))

    expect(confirm).toHaveBeenCalled()
    expect(useStore.getState().messages).toHaveLength(1)

    confirm.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }))
    expect(useStore.getState().messages).toHaveLength(0)
  })

  it('guards every destructive handler the audit flagged', () => {
    const flagged = [
      'MigrationDialog.tsx',
      'GoalPanel.tsx',
      'Vps/VpsPanel.tsx',
      'TerminalPanel.tsx',
      'ExecutionBar.tsx',
      'Titlebar.tsx'
    ]
    for (const name of flagged) {
      const source = readFileSync(
        join(process.cwd(), 'src/renderer/src/components', name),
        'utf8'
      )
      expect(source, `${name} must confirm before destroying state`).toContain('window.confirm(')
    }
  })
})

describe('a failed clipboard write is reported (U-5)', () => {
  function message(): Parameters<typeof MessageBubble>[0]['message'] {
    return { id: 'm1', role: 'assistant', content: 'hello', at: 1, model: 'deepseek-chat' }
  }

  it('toasts when the clipboard refuses the write', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(() => Promise.reject(new Error('denied'))) }
    })
    render(<MessageBubble message={message()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Export' }))

    await waitFor(() => expect(useStore.getState().toasts).toHaveLength(1))
    expect(useStore.getState().toasts[0].kind).toBe('error')
  })

  it('confirms a successful copy', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(() => Promise.resolve()) }
    })
    render(<MessageBubble message={message()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Export' }))

    await waitFor(() => expect(screen.getByText('Copied')).toBeTruthy())
    expect(useStore.getState().toasts).toHaveLength(0)
  })
})
