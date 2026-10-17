// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import ChatPanel from '../../src/renderer/src/components/ChatPanel'
import ExecutionBar from '../../src/renderer/src/components/ExecutionBar'
import WorkspacePanel from '../../src/renderer/src/components/WorkspacePanel'
import { useStore } from '../../src/renderer/src/store'

/**
 * v4.1, plan item 11 — one entry point to Sources/Outputs.
 *
 * There were three: the composer's slider icon (a modal), the panel icon in the chat
 * header (the drawer) and the right rail's own Output | Sources tabs. The rail wins
 * because it is the surface that actually shows the data; the other two are gone, and
 * the rail can still be closed and reopened from its own chrome.
 */
beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    agent: { abort: vi.fn(), explainStep: vi.fn().mockResolvedValue(null) },
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
    running: false,
    settings: null,
    error: null,
    loopStop: null,
    warnings: [],
    terminalOpen: false,
    jobs: [],
    jobsPanelOpen: false,
    showContextBeforeSend: false,
    workspacePanelOpen: true,
    workspacePanelTab: 'output',
    sourcesPanelOpen: false
  })
})

describe('v4.1 item 11 — the right rail is the single entry point', () => {
  it('1. the composer no longer carries a Sources/Outputs icon', () => {
    render(<ChatPanel />)

    expect(screen.queryByTestId('composer-sources-toggle')).toBeNull()
    expect(
      screen.queryByRole('button', { name: i18n.t('runPanel.open') })
    ).toBeNull()
  })

  it('2. the chat header no longer carries a panel icon', () => {
    render(<ExecutionBar timelineOpen={false} onToggleTimeline={() => undefined} />)

    expect(screen.queryByRole('button', { name: i18n.t('workspace.open') })).toBeNull()
    // …while the rest of the header's controls are untouched.
    expect(screen.getByTestId('exec-project')).toBeTruthy()
  })

  it('3. the rail itself offers Output | Sources and opens the declared panel', () => {
    render(<WorkspacePanel />)

    const output = screen.getByRole('button', { name: i18n.t('workspace.output') })
    const sources = screen.getByRole('button', { name: i18n.t('workspace.sources') })
    expect(output.getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(sources)
    expect(useStore.getState().workspacePanelTab).toBe('sources')

    fireEvent.click(screen.getByTestId('rail-declare-sources'))
    expect(useStore.getState().sourcesPanelOpen).toBe(true)
  })

  it('4. the rail can be closed, and reopened from its own collapsed tab strip', () => {
    render(<WorkspacePanel />)

    // The collapse control is the rail's own, and it stays.
    fireEvent.click(screen.getByRole('button', { name: i18n.t('workspace.close') }))
    expect(useStore.getState().workspacePanelOpen).toBe(false)

    // Closed, the rail leaves a narrow strip of its own tabs — not a header button.
    expect(screen.getByTestId('workspace-rail-collapsed')).toBeTruthy()
    fireEvent.click(screen.getByTestId('workspace-rail-tab-sources'))
    expect(useStore.getState().workspacePanelOpen).toBe(true)
    expect(useStore.getState().workspacePanelTab).toBe('sources')

    // …and the explicit open control works too.
    fireEvent.click(screen.getByRole('button', { name: i18n.t('workspace.close') }))
    fireEvent.click(screen.getByTestId('workspace-rail-open'))
    expect(useStore.getState().workspacePanelOpen).toBe(true)
  })

  it('5. the declared Sources/Outputs editor only appears when the rail opens it', () => {
    render(
      <>
        <WorkspacePanel />
        <ChatPanel />
      </>
    )

    expect(screen.queryByTestId('sources-outputs-panel')).toBeNull()
    /*
     * The real path starts on the rail's Sources tab: the editor is reached from the rail, not from a shortcut
     * somewhere else in the window. (The first version of this case clicked a control that only exists on that
     * tab while the Output tab was selected, so it proved nothing and failed.)
     */
    fireEvent.click(screen.getByRole('button', { name: i18n.t('workspace.sources') }))
    fireEvent.click(screen.getByTestId('rail-declare-sources'))
    expect(screen.getByTestId('sources-outputs-panel')).toBeTruthy()

    // Closing it again leaves the rail, which is the surface that stays.
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.close') }))
    expect(useStore.getState().sourcesPanelOpen).toBe(false)
    expect(screen.queryByTestId('sources-outputs-panel')).toBeNull()
  })
})
