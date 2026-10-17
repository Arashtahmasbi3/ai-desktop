// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import ChatPanel from '../../src/renderer/src/components/ChatPanel'
import ExecutionBar from '../../src/renderer/src/components/ExecutionBar'
import { useStore } from '../../src/renderer/src/store'

/**
 * v4.1, plan item 10 — one Stop control.
 *
 * The chat header grew a red Stop beside the composer's send/stop button, so a
 * running task offered two ways to kill it and only one of them sat next to the
 * input the user was looking at. The composer's button is the one that stays; these
 * cases pin that the header's is gone and that the surviving button still aborts.
 */
beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

const abort = vi.fn()

beforeEach(() => {
  abort.mockReset()
  ;(window as unknown as { api: unknown }).api = {
    agent: { abort, explainStep: vi.fn().mockResolvedValue(null) },
    dialog: {
      pickDirectory: vi.fn().mockResolvedValue(null),
      pickFile: vi.fn().mockResolvedValue([])
    },
    chats: { save: vi.fn().mockResolvedValue({ id: 'c1' }) }
  }
  useStore.setState({
    messages: [],
    decisions: [],
    logs: [],
    running: true,
    settings: null,
    error: null,
    loopStop: null,
    warnings: [],
    terminalOpen: false,
    jobs: [],
    jobsPanelOpen: false,
    activeChatId: 'c1',
    sessionId: 'c1',
    sourcesPanelOpen: false,
    showContextBeforeSend: false
  })
})

describe('v4.1 item 10 — a single Stop control', () => {
  it('1. the chat header renders no Stop, even while a run is in flight', () => {
    render(<ExecutionBar timelineOpen={false} onToggleTimeline={() => undefined} />)

    expect(screen.queryByTestId('exec-stop')).toBeNull()
    expect(screen.queryByRole('button', { name: /stop/i })).toBeNull()
  })

  it('2. the composer keeps the only Stop and it aborts the run', () => {
    render(<ChatPanel />)

    // Exactly one control in the whole panel says "stop".
    expect(screen.getAllByRole('button', { name: /stop/i })).toHaveLength(1)
    const stop = screen.getByTestId('composer-stop')
    expect(stop.getAttribute('aria-label')).toContain(i18n.t('chat.stop'))

    fireEvent.click(stop)
    expect(abort).toHaveBeenCalledTimes(1)
  })

  it('3. a finished run turns the same button back into Send', () => {
    useStore.setState({ running: false })
    render(<ChatPanel />)

    expect(screen.queryByTestId('composer-stop')).toBeNull()
    // The send control takes the same slot back, disabled with an empty composer.
    const send = screen.getByRole('button', { name: i18n.t('chat.send') })
    expect(send).toHaveProperty('disabled', true)
  })
})
