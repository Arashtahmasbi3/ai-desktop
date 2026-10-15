// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import MessageBubble from '../../src/renderer/src/components/MessageBubble'
import ToolResultCard from '../../src/renderer/src/components/ToolResultCard'
import type { ChatMessage } from '../../src/renderer/src/store'

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    shell: { exec: () => Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }) }
  }
})

afterEach(cleanup)

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return { id: 'm1', role: 'assistant', content: '', at: 1, ...overrides }
}

/**
 * v2.6.0, A.2 - bilingual RTL/LTR. Persian prose must flow RTL while commands,
 * paths and code stay LTR, regardless of the UI language.
 */
describe('v2.6.0 A.2 - RTL/LTR direction', () => {
  it('1. the markdown body resolves direction per message (dir=auto)', () => {
    render(<MessageBubble message={message({ content: 'سلام، این یک پیام فارسی است.' })} />)
    const body = document.querySelector('.chat-markdown') as HTMLElement
    expect(body.getAttribute('dir')).toBe('auto')
  })

  it('2. a Persian message containing a command keeps prose dir=auto', () => {
    render(
      <MessageBubble
        message={message({ content: 'این دستور را اجرا کن:\n\n```bash\nls -la /opt/app\n```\n' })}
      />
    )
    const body = document.querySelector('.chat-markdown') as HTMLElement
    expect(body.getAttribute('dir')).toBe('auto')
  })

  it('3. a fenced code block renders its code LTR', () => {
    render(<MessageBubble message={message({ content: '```bash\nls -la /opt/app\n```' })} />)
    const code = screen.getByText('ls -la /opt/app')
    expect(code.getAttribute('dir')).toBe('ltr')
  })

  it('4. a tool result card is LTR with an LTR command', () => {
    render(
      <ToolResultCard
        name="remote_shell"
        ok={false}
        command="pm2 logs api --lines 100"
        stdout=""
        stderr={'process "api" not found'}
        exitCode={1}
        serverId="my-server"
        cwd="/opt/demo-project"
      />
    )
    // v2.8.1: the command shows in both the header preview and the expanded body.
    const card = screen
      .getAllByText('pm2 logs api --lines 100')[0]
      .closest('[dir]') as HTMLElement
    expect(card.getAttribute('dir')).toBe('ltr')
  })
})
