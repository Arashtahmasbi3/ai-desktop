// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import ExecutionBar from '../../src/renderer/src/components/ExecutionBar'
import InlineTrace from '../../src/renderer/src/components/InlineTrace'
import StatusBar from '../../src/renderer/src/components/StatusBar'
import Titlebar from '../../src/renderer/src/components/Titlebar'
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
 *  3. **Advanced is one visible control away.** The switch is a labelled two-option control on the
 *     title bar itself (R6 restored it from the `⋯` menu, which is what U3-1 exists to prevent),
 *     and the terminal/file-tree toggles come back with it, as does the trace's reasoning row.
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
  // server list on mount and none of these cases is about VPS state; the title bar asks the window
  // whether it is maximized.
  ;(window as unknown as { api: unknown }).api = {
    vps: {
      list: () => Promise.resolve([]),
      status: () => Promise.resolve({ status: 'disconnected' }),
      connected: () => Promise.resolve([]),
      gitStatusParsed: () =>
        Promise.resolve({ branch: 'main', changes: 0, ahead: 0, behind: 0, clean: true })
    },
    agent: { abort: () => Promise.resolve() },
    window: {
      isMaximized: () => Promise.resolve(false),
      minimize: () => Promise.resolve(),
      toggleMaximize: () => Promise.resolve(false),
      close: () => Promise.resolve()
    },
    events: { on: () => () => undefined },
    dialog: { pickDirectory: () => Promise.resolve(null) }
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

describe('R6 / U3-1 — the interface switch is a visible control on the title bar', () => {
  it('1. shows both options without opening a menu, then switches to advanced', () => {
    render(
      <>
        <Titlebar />
        {executionBar()}
      </>
    )
    expect(treeToggle()).toBeNull()
    expect(terminalToggle()).toBeNull()

    /*
     * U3-1: "prefer visible controls over menus". Hiding the switch in the `⋯` menu is exactly
     * the regression it exists to prevent, so the control is on the bar and needs no click to be
     * seen. Both options are labelled and the current one is `aria-pressed`.
     */
    const group = screen.getByTestId('titlebar-ui-mode')
    expect(group.getAttribute('aria-label')).toBe(i18n.t('statusBar.uiMode'))
    expect(screen.getByTestId('titlebar-ui-mode-simple').textContent).toBe(
      i18n.t('statusBar.uiModeSimple')
    )
    expect(screen.getByTestId('titlebar-ui-mode-advanced').textContent).toBe(
      i18n.t('statusBar.uiModeAdvanced')
    )
    expect(screen.getByTestId('titlebar-ui-mode-simple').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('titlebar-ui-mode-advanced').getAttribute('aria-pressed')).toBe(
      'false'
    )

    fireEvent.click(screen.getByTestId('titlebar-ui-mode-advanced'))

    expect(useStore.getState().uiMode).toBe('advanced')
    expect(getUiMode()).toBe('advanced')
    expect(localStorage.getItem(MODE_KEY)).toBe(JSON.stringify('advanced'))
    expect(screen.getByTestId('titlebar-ui-mode-advanced').getAttribute('aria-pressed')).toBe(
      'true'
    )
    expect(treeToggle()).toBeTruthy()
    expect(terminalToggle()).toBeTruthy()
  })

  it('2. goes back to simple and takes the toggles away again', () => {
    act(() => useStore.getState().setUiMode('advanced'))
    render(
      <>
        <Titlebar />
        {executionBar()}
      </>
    )
    expect(terminalToggle()).toBeTruthy()

    expect(screen.getByTestId('titlebar-ui-mode-advanced').getAttribute('aria-pressed')).toBe(
      'true'
    )
    fireEvent.click(screen.getByTestId('titlebar-ui-mode-simple'))

    expect(useStore.getState().uiMode).toBe('simple')
    expect(getUiMode()).toBe('simple')
    expect(treeToggle()).toBeNull()
    expect(terminalToggle()).toBeNull()
  })

  it('3. the status line keeps no switch and no menu, and the control exists exactly once', () => {
    render(
      <>
        <StatusBar />
        <Titlebar />
      </>
    )

    // The bar is one line: no mode switch and no overflow menu hidden behind a right-click.
    expect(screen.queryByTestId('status-ui-mode')).toBeNull()
    fireEvent.contextMenu(screen.getByTestId('status-bar'))
    expect(screen.queryByTestId('status-menu')).toBeNull()

    // …and there is one copy of the mode switch, on the title bar — not a second one in the menu.
    expect(screen.getAllByTestId('titlebar-ui-mode-simple')).toHaveLength(1)
    fireEvent.click(screen.getByTestId('titlebar-menu-button'))
    expect(screen.getAllByTestId('titlebar-ui-mode-simple')).toHaveLength(1)
    expect(screen.getAllByTestId('titlebar-ui-mode-advanced')).toHaveLength(1)
    expect(
      within(screen.getByTestId('titlebar-menu')).queryByTestId('titlebar-ui-mode-simple')
    ).toBeNull()
  })

  it('4. is labelled in Persian too', async () => {
    await i18n.changeLanguage('fa')
    try {
      render(<Titlebar />)
      expect(screen.getByTestId('titlebar-ui-mode').getAttribute('aria-label')).toBe(
        i18n.t('statusBar.uiMode')
      )
      expect(screen.getByTestId('titlebar-ui-mode-simple').textContent).toContain(
        i18n.t('statusBar.uiModeSimple')
      )
      expect(screen.getByTestId('titlebar-ui-mode-advanced').textContent).toContain(
        i18n.t('statusBar.uiModeAdvanced')
      )
    } finally {
      await i18n.changeLanguage('en')
    }
  })
})
