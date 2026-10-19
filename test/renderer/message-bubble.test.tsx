// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import MessageBubble from '../../src/renderer/src/components/MessageBubble'
import type { ChatMessage } from '../../src/renderer/src/store'

/**
 * The message bubble (v4.0).
 *
 * There was no test for this component, and the transcript is the most-used surface in the app — so
 * the v4.0 restyle skipped it entirely (it used no renamed classes, so nothing touched it) and the
 * gap only appeared when the rendered page was read.
 *
 * The first case exists because of a specific bug I introduced while fixing that: a JSX comment in
 * the **children** position must be written `{/* … *\/}`. A bare `/* … *\/` there is not a comment,
 * it is a text node — and the transcript literally rendered my own note above every message. No
 * assertion caught it; reading `document.body.innerText` did. This pins it shut.
 */
function message(over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm1',
    role: 'assistant',
    content: 'The health check passes on the wrong port.',
    at: Date.now(),
    ...over
  }
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

describe('MessageBubble (v4.0)', () => {
  it('renders the message and NOTHING else — no stray source note in the transcript', () => {
    const text = 'The health check passes on the wrong port.'
    render(<MessageBubble message={message({ content: text })} />)
    const body = document.body.textContent ?? ''

    expect(body).toContain(text)
    // The bug: a bare block comment rendered as content. Nothing from the source may leak here.
    expect(body).not.toContain('v4.0')
    expect(body).not.toContain('/*')
    expect(body).not.toContain('*/')
  })

  it('tells the speakers apart by a border, not by a soft fill alone', () => {
    /*
     * Targets the bubble itself. `getByText` matched the `<p>` markdown renders *inside* the bubble,
     * whose className is empty — which is how this assertion first read the wrong element.
     */
    const { unmount } = render(<MessageBubble message={message({ role: 'assistant' })} />)
    const assistantClass = screen.getByTestId('message-assistant').className
    unmount()

    render(<MessageBubble message={message({ role: 'user' })} />)
    const userClass = screen.getByTestId('message-user').className
    unmount()

    for (const className of [assistantClass, userClass]) {
      // The 6px radius step and a 1px hairline: the language the rest of the app speaks.
      expect(className).toContain('rounded-shape')
      expect(className.split(/\s+/)).toContain('border')
      expect(className).not.toContain('border-2')
    }
    // And the two are distinguishable without relying on the fill colour.
    expect(userClass).toContain('border-accent')
    expect(assistantClass).toContain('border-border-strong')
  })

  it('marks a system notice with its own border so it cannot be mistaken for a reply', () => {
    render(<MessageBubble message={message({ role: 'system', content: 'Run finished · 6 tools' })} />)
    expect(screen.getByTestId('message-system').className).toContain('border-warning')
  })

  it('keeps the model attribution monospace, as data rather than prose', () => {
    render(<MessageBubble message={message({ model: 'deepseek-v4-flash' })} />)
    expect(screen.getByText('deepseek-v4-flash').className).toContain('font-mono')
  })

  it('renders markdown instead of dumping the raw source', () => {
    render(<MessageBubble message={message({ content: '**bold** and `code`' })} />)
    expect(document.querySelector('strong')).toBeTruthy()
    expect(document.querySelector('code')).toBeTruthy()
    // The inline code chip is square and bordered like every other small surface.
    expect(document.querySelector('code')!.className).toContain('rounded-shape-sm')
  })

  it('leaves no console error behind while rendering', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<MessageBubble message={message()} />)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
