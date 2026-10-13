// @vitest-environment jsdom
/**
 * v2.6.3 Topic 1 T1.1 - the conversation is one centered column.
 *
 * jsdom cannot lay out pixels, so these assert the structure that produces the
 * centered measure: the message column and the composer share the same
 * `CHAT_MAX_WIDTH` cap, are centered with `mx-auto`, and both carry the `px-4`
 * gutter so neither hugs the panel edge on narrow windows.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import ChatPanel from '../../src/renderer/src/components/ChatPanel'
import { useStore } from '../../src/renderer/src/store'
import { CHAT_MAX_WIDTH } from '../../src/renderer/src/lib/layout'

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    agent: { explainStep: vi.fn().mockResolvedValue(null) },
    dialog: {
      pickDirectory: vi.fn().mockResolvedValue(null),
      pickFile: vi.fn().mockResolvedValue([])
    }
  }
  useStore.setState({
    messages: [],
    decisions: [],
    logs: [],
    running: false,
    settings: null,
    error: null,
    loopStop: null,
    warnings: []
  })
})

afterEach(cleanup)

describe('v2.6.3 T1.1 - centered chat column', () => {
  it('1. caps the message column and the composer at the same 820px measure', () => {
    render(<ChatPanel />)
    const measure = screen.getByTestId('chat-measure')
    const composer = screen.getByTestId('chat-composer')
    expect(measure.style.maxWidth).toBe(`${CHAT_MAX_WIDTH}px`)
    expect(composer.style.maxWidth).toBe(measure.style.maxWidth)
  })

  it('2. centers both columns with mx-auto so the chat stays in the middle', () => {
    render(<ChatPanel />)
    expect(screen.getByTestId('chat-measure').className).toContain('mx-auto')
    expect(screen.getByTestId('chat-composer').className).toContain('mx-auto')
  })

  it('3. gives both columns the px-4 gutter', () => {
    render(<ChatPanel />)
    expect(screen.getByTestId('chat-measure').className).toContain('px-4')
    expect(screen.getByTestId('chat-composer').className).toContain('px-4')
  })
})
