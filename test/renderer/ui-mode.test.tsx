// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import ExecutionBar from '../../src/renderer/src/components/ExecutionBar'
import InlineTrace from '../../src/renderer/src/components/InlineTrace'
import StatusBar from '../../src/renderer/src/components/StatusBar'
import { DEFAULT_UI_MODE, getUiMode, setUiMode } from '../../src/renderer/src/lib/ui-mode'
import { useStore } from '../../src/renderer/src/store'
import type { SettingsView } from '@shared/ui'
import type { TraceDecision } from '../../src/shared/trace'

/**
 * Checklist item 13 — simple mode by default.
 *
 * The complaint behind it is "the app is cluttered": the chat header offered a terminal and a
 * file-tree toggle on every run, and the trace printed the model's raw reasoning under every
 * step. Those are advanced instruments, not the first screen.
 *
 * Three things have to be true, and each is pinned here:
 *
 *  1. **The default is simple.** A fresh install, an absent preference, an unknown value and
 *     unreadable storage must all resolve to `simple`.
 *  2. **"Not offered" means not open either.** A pane that is open when the mode turns simple is
 *     closed (and its persisted flag cleared), and the store refuses to reopen it — so the
 *     keyboard shortcuts and the Settings → Connections button cannot route around the mode.
 *  3. **Advanced is one visible control away.** The status bar's overflow menu switches modes and
 *     the terminal/file-tree toggles come back; the trace's reasoning row returns too.
 */

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

/** The persisted keys (`prefs.ts` prefixes with `ai-desktop.`; the tree uses its own raw key). */
const MODE_KEY = 'ai-desktop.ui.mode'
const TREE_KEY = 'ai-desktop:chat-tree-open'

/**
 * Captured at module load, before any test can assign state: this is the store's real initial
 * value, i.e. the default a user actually starts with.
 */
const initialUiMode = useStore.getState().uiMode

const settings = {
  providers: {},
  projects: [
    {
      id: 'p1',
      name: 'demo',
      path: 'C:/projects/demo',
      createdAt: 1,
      updatedAt: 1,
      environment: 'development',
      exists: true
    }
  ],
  activeProjectId: 'p1'
} as unknown as SettingsView

function decision(): TraceDecision {
  return {
    id: 'run-1:1',
    runId: 'run-1',
    phase: 'executing',
    intent: { summary: 'checking the config' },
    evidence: [],
    decision: 'read_file(a.ts)',
    outcome: 'ok',
    at: 1
  }
}

/** The terminal and file-tree buttons are located by the accessible name they already carry. */
const treeToggle = (): HTMLElement | null => screen.queryByLabelText(i18n.t('chat.toggleTree'))
const terminalToggle = (): HTMLElement | null =>
  screen.queryByLabelText(i18n.t('chat.terminalTitle'))

const executionBar = (): JSX.Element => (
  <ExecutionBar timelineOpen={false} onToggleTimeline={() => undefined} />
)

beforeEach(() => {
  localStorage.clear()
  // A stubbed bridge is a boundary, not a mock of the code under test: `VpsSelector` refreshes the
  // server list on mount and none of these cases is about VPS state.
  ;(window as unknown as { api: unknown }).api = {
    vps: {
      list: () => Promise.resolve([]),
      status: () => Promise.resolve({ status: 'disconnected' }),
      connected: () => Promise.resolve([]),
      gitStatusParsed: () =>
        Promise.resolve({ branch: 'main', changes: 0, ahead: 0, behind: 0, clean: true })
    },
    agent: { abort: () => Promise.resolve() }
  }
  useStore.setState({
    settings,
    vpsServers: [],
    vpsStatus: { status: 'disconnected' },
    vpsConnected: [],
    running: false,
    ready: true,
    worker: null,
    chatTreeOpen: false,
    terminalOpen: false,
    uiMode: DEFAULT_UI_MODE,
    decisions: [],
    messages: [],
    logs: [],
    changedFiles: [],
    reasoningByStep: {}
  })
})

describe('checklist item 13 — simple is the default', () => {
  it('1. starts simple, and an absent, unknown or unreadable value cannot make it advanced', () => {
    expect(DEFAULT_UI_MODE).toBe('simple')
    // The store's initial value (captured before any test ran) is the default a user starts with.
    expect(initialUiMode).toBe('simple')
    expect(getUiMode()).toBe('simple')
    // Opening the app must not write a preference the user never made.
    expect(localStorage.getItem(MODE_KEY)).toBeNull()

    localStorage.setItem(MODE_KEY, JSON.stringify('turbo'))
    expect(getUiMode()).toBe('simple')

    localStorage.setItem(MODE_KEY, '{not json')
    expect(getUiMode()).toBe('simple')
  })

  it('2. remembers advanced once it is chosen', () => {
    act(() => setUiMode('advanced'))

    expect(getUiMode()).toBe('advanced')
    expect(localStorage.getItem(MODE_KEY)).toBe(JSON.stringify('advanced'))
  })
})

describe('checklist item 13 — simple mode does not offer the advanced panes', () => {
  it('1. renders no terminal toggle and no file-tree toggle', () => {
    render(executionBar())

    expect(treeToggle()).toBeNull()
    expect(terminalToggle()).toBeNull()
  })

  it('2. closes a pane that is open when the mode becomes simple, and clears its stored flag', () => {
    act(() => useStore.getState().setUiMode('advanced'))
    act(() => {
      useStore.getState().toggleChatTree()
      useStore.getState().toggleTerminal()
    })
    expect(useStore.getState().chatTreeOpen).toBe(true)
    expect(useStore.getState().terminalOpen).toBe(true)
    expect(localStorage.getItem(TREE_KEY)).toBe('1')

    act(() => useStore.getState().setUiMode('simple'))

    // Not merely hidden: really closed, so a restart cannot reopen what the mode hides.
    expect(useStore.getState().chatTreeOpen).toBe(false)
    expect(useStore.getState().terminalOpen).toBe(false)
    expect(localStorage.getItem(TREE_KEY)).toBe('0')
    expect(localStorage.getItem(MODE_KEY)).toBe(JSON.stringify('simple'))
  })

  it('3. refuses to open them while the mode is simple — shortcuts route through the store', () => {
    act(() => {
      useStore.getState().toggleChatTree()
      useStore.getState().toggleTerminal()
    })

    expect(useStore.getState().chatTreeOpen).toBe(false)
    expect(useStore.getState().terminalOpen).toBe(false)
  })
})

describe('checklist item 13 — the execution trace keeps the row and the verdict', () => {
  it('1. folds the raw reasoning away but keeps the row and the step verdict', () => {
    useStore.setState({
      decisions: [decision()],
      reasoningByStep: { 'run-1:1': 'I should read the config first.' }
    })
    render(<InlineTrace />)

    // The reasoning is folded away entirely: no disclosure to open, and no text either.
    expect(screen.queryByTestId('trace-reasoning')).toBeNull()
    expect(document.body.textContent ?? '').not.toContain('read the config first')

    // The row (its header, latest intent) and the decision card with its outcome stay.
    expect(screen.getByTestId('inline-trace-toggle')).toBeTruthy()
    expect(screen.getByTestId('trace-latest').textContent).toContain('checking the config')
    expect(screen.getByTestId('decision-card')).toBeTruthy()
    expect(screen.getByTestId('decision-summary').textContent).toContain('checking the config')
    expect(screen.getByTestId('decision-card').textContent).toContain(i18n.t('trace.outcomeOk'))
  })

  it('2. shows the same reasoning again in advanced mode', () => {
    useStore.setState({
      uiMode: 'advanced',
      decisions: [decision()],
      reasoningByStep: { 'run-1:1': 'I should read the config first.' }
    })
    render(<InlineTrace />)

    const row = screen.getByTestId('trace-reasoning')
    expect(row.textContent).toContain('read the config first')
    // Still collapsed by default — advanced offers it, it does not shout it.
    expect((row as HTMLDetailsElement).open).toBe(false)
  })
})

describe('U3-1 — the switch is visible in the status bar', () => {
  it('1. turns simple into advanced and brings the advanced toggles back', () => {
    render(
      <>
        <StatusBar />
        {executionBar()}
      </>
    )
    expect(treeToggle()).toBeNull()
    expect(terminalToggle()).toBeNull()

    /*
     * A segmented control in the bar itself, not a row in the right-click menu: the design guidelines say a
     * control that changes what the interface offers must be visible.
     */
    expect(screen.getByTestId('status-ui-mode-simple').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('status-ui-mode-advanced').getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(screen.getByTestId('status-ui-mode-advanced'))

    expect(useStore.getState().uiMode).toBe('advanced')
    expect(getUiMode()).toBe('advanced')
    expect(localStorage.getItem(MODE_KEY)).toBe(JSON.stringify('advanced'))
    expect(screen.getByTestId('status-ui-mode-advanced').getAttribute('aria-pressed')).toBe('true')
    expect(treeToggle()).toBeTruthy()
    expect(terminalToggle()).toBeTruthy()
  })

  it('2. goes back to simple and takes the toggles away again', () => {
    act(() => useStore.getState().setUiMode('advanced'))
    render(
      <>
        <StatusBar />
        {executionBar()}
      </>
    )
    expect(terminalToggle()).toBeTruthy()

    fireEvent.click(screen.getByTestId('status-ui-mode-simple'))

    expect(useStore.getState().uiMode).toBe('simple')
    expect(getUiMode()).toBe('simple')
    expect(treeToggle()).toBeNull()
    expect(terminalToggle()).toBeNull()
  })

  it('3. no longer hides a second copy of the switch in the overflow menu', () => {
    render(<StatusBar />)
    fireEvent.contextMenu(screen.getByTestId('status-bar'))

    // The menu still opens and still holds the other rows…
    expect(screen.getByTestId('status-menu')).toBeTruthy()
    expect(screen.getByTestId('status-menu-locale')).toBeTruthy()
    // …but the mode lives in exactly one place now.
    expect(screen.queryByTestId('status-menu-ui-mode')).toBeNull()
  })

  it('4. is labelled in Persian too', async () => {
    await i18n.changeLanguage('fa')
    try {
      render(<StatusBar />)
      expect(screen.getByTestId('status-ui-mode').getAttribute('aria-label')).toBe(
        i18n.t('statusBar.uiMode')
      )
      expect(screen.getByTestId('status-ui-mode-simple').textContent).toContain(
        i18n.t('statusBar.uiModeSimple')
      )
      expect(screen.getByTestId('status-ui-mode-advanced').textContent).toContain(
        i18n.t('statusBar.uiModeAdvanced')
      )
    } finally {
      await i18n.changeLanguage('en')
    }
  })
})
