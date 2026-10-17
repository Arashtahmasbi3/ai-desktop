// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import SourcesOutputsPanel from '../../src/renderer/src/components/SourcesOutputsPanel'
import ChatPanel from '../../src/renderer/src/components/ChatPanel'
import WorkspacePanel from '../../src/renderer/src/components/WorkspacePanel'
import { useStore } from '../../src/renderer/src/store'

/**
 * v3.0 — the composer's Sources / Outputs panel.
 *
 * Three things are worth pinning: the two lists behave as declarations (add, list,
 * remove) with the attached files reusing the very same chips as the composer; the
 * "Add files"/"Add folder"/"View all" affordances call the *existing* flows instead
 * of a parallel picker or a second context preview; and the declared outputs reach
 * the agent as prompt text with no new IPC and no change to an ordinary send.
 */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/wD/AL0AAAAASUVORK5CYII='

/** Renders the panel with the composer's callbacks stubbed, and returns them. */
function renderPanel(overrides: Partial<Parameters<typeof SourcesOutputsPanel>[0]> = {}) {
  const mocks = {
    onRemoveAttachment: vi.fn<(id: string) => void>(),
    onAddFiles: vi.fn<() => void>(),
    onAddFolder: vi.fn<() => void>(),
    onViewAll: vi.fn<() => void>(),
    onClose: vi.fn<() => void>()
  }
  render(<SourcesOutputsPanel attached={[]} visionCapable {...mocks} {...overrides} />)
  return mocks
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  useStore.setState({ runOutputs: [], runSources: [] })
})

afterEach(cleanup)

describe('v3.0 — the Outputs section', () => {
  it('1. declares an output with a kind and an optional target, then clears the field', () => {
    renderPanel()

    fireEvent.click(screen.getByTestId('run-output-kind-site'))
    expect(screen.getByTestId('run-output-kind-site').getAttribute('aria-pressed')).toBe('true')
    fireEvent.change(screen.getByTestId('run-output-target'), { target: { value: 'landing/' } })
    fireEvent.click(screen.getByTestId('run-output-add'))

    const outputs = useStore.getState().runOutputs
    expect(outputs).toHaveLength(1)
    expect(outputs[0]).toMatchObject({ kind: 'site', target: 'landing/' })
    expect(screen.getByTestId(`run-output-${outputs[0]!.id}`).textContent).toContain('landing/')
    expect((screen.getByTestId('run-output-target') as HTMLInputElement).value).toBe('')
  })

  it('2. allows an output with no target, and removes it again', () => {
    renderPanel()
    fireEvent.click(screen.getByTestId('run-output-add'))

    const [output] = useStore.getState().runOutputs
    expect(output).toMatchObject({ kind: 'file' })
    expect(output!.target).toBeUndefined()

    fireEvent.click(
      within(screen.getByTestId(`run-output-${output!.id}`)).getByLabelText(
        i18n.t('runPanel.removeOutput')
      )
    )
    expect(useStore.getState().runOutputs).toEqual([])
    expect(screen.queryByTestId(`run-output-${output!.id}`)).toBeNull()
  })

  it('3. starts with no declared output', () => {
    renderPanel()
    expect(screen.getByText(i18n.t('runPanel.outputsEmpty'))).toBeTruthy()
  })
})

describe('v3.0 — the Sources section', () => {
  it('4. lists the attached files with the same chip the composer uses', () => {
    const { onRemoveAttachment } = renderPanel({
      attached: [{ id: 'a1', name: 'shot.png', kind: 'image', bytes: 2048, thumbnail: PNG }]
    })

    const chips = screen.getByTestId('run-sources-chips')
    const chip = within(chips).getByTestId('attachment-chip-shot.png')
    expect(chip.querySelector('img')!.getAttribute('src')).toBe(PNG)

    fireEvent.click(within(chip).getByLabelText(i18n.t('common.remove')))
    expect(onRemoveAttachment).toHaveBeenCalledWith('a1')
  })

  it('5. "+ Add files", "+ Add folder" and "View all" call the existing flows', () => {
    const props = renderPanel()

    fireEvent.click(screen.getByTestId('run-sources-add-files'))
    expect(props.onAddFiles).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('run-sources-add-folder'))
    expect(props.onAddFolder).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('run-sources-view-all'))
    expect(props.onViewAll).toHaveBeenCalledTimes(1)
  })

  it('6. renders a recorded folder source and can remove it', () => {
    // The picker itself lives in the composer; the panel only has to show and drop
    // what the store holds.
    renderPanel({ onAddFolder: () => useStore.getState().addRunSource('/srv/docs') })
    fireEvent.click(screen.getByTestId('run-sources-add-folder'))

    const [source] = useStore.getState().runSources
    expect(source).toMatchObject({ kind: 'folder', value: '/srv/docs' })
    expect(screen.getByText('/srv/docs')).toBeTruthy()

    fireEvent.click(
      within(screen.getByTestId(`run-source-${source!.id}`)).getByLabelText(
        i18n.t('runPanel.removeSource')
      )
    )
    expect(useStore.getState().runSources).toEqual([])
  })

  it('7. shows web search and a GitHub repo as disabled coming-soon entries', () => {
    renderPanel()

    for (const id of ['run-source-web-search', 'run-source-github']) {
      const button = screen.getByTestId(id) as HTMLButtonElement
      expect(button.disabled, `${id} must be visibly disabled`).toBe(true)
      // A disabled control cannot explain itself on hover, so the tooltip also sits
      // on the wrapping row.
      expect(button.getAttribute('title')).toBeTruthy()
    }
    expect(screen.getAllByText(i18n.t('runPanel.comingSoon'))).toHaveLength(2)

    // Clicking a disabled entry does nothing at all — web search is not implemented.
    fireEvent.click(screen.getByTestId('run-source-web-search'))
    expect(useStore.getState().runOutputs).toEqual([])
    expect(useStore.getState().runSources).toEqual([])
  })
})

describe('v4.1 — the right rail is the only way in', () => {
  beforeEach(() => {
    useStore.setState({
      messages: [],
      decisions: [],
      logs: [],
      running: false,
      settings: null,
      error: null,
      loopStop: null,
      warnings: [],
      showContextBeforeSend: false,
      workspacePanelOpen: true,
      workspacePanelTab: 'sources',
      sourcesPanelOpen: false
    })
  })

  it('8. the rail’s Sources tab opens it, and "+ Add files" uses the existing picker', async () => {
    const pickFile = vi.fn().mockResolvedValue(['C:\\Users\\me\\shot.png'])
    const register = vi.fn().mockResolvedValue([
      { id: 'att-1', name: 'shot.png', kind: 'image', bytes: 2048, thumbnail: PNG }
    ])
    ;(window as unknown as { api: unknown }).api = {
      agent: { explainStep: vi.fn().mockResolvedValue(null) },
      dialog: {
        pickDirectory: vi.fn().mockResolvedValue(null),
        pickFile
      },
      attachments: { register }
    }

    // v4.1 item 11: the composer's slider icon is gone, so the rail is mounted with the
    // chat — its Sources tab is the single entry point to the declared sources/outputs.
    render(
      <>
        <WorkspacePanel />
        <ChatPanel />
      </>
    )
    expect(screen.queryByTestId('composer-sources-toggle')).toBeNull()
    expect(screen.queryByTestId('sources-outputs-panel')).toBeNull()

    fireEvent.click(screen.getByTestId('rail-declare-sources'))
    expect(screen.getByTestId('sources-outputs-panel')).toBeTruthy()

    fireEvent.click(screen.getByTestId('run-sources-add-files'))
    await waitFor(() => expect(pickFile).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(register).toHaveBeenCalledWith(['C:\\Users\\me\\shot.png']))
    // The picked file lands in the composer's list and in the panel, from one chip.
    await waitFor(() => expect(screen.getAllByTestId('attachment-chip-shot.png')).toHaveLength(2))
  })
})

describe('v3.0 — the declared outputs reach the agent', () => {
  const seen: Array<Record<string, unknown>> = []
  const run = vi.fn(async (request: Record<string, unknown>) => {
    seen.push(request)
  })

  beforeEach(() => {
    seen.length = 0
    run.mockClear()
    ;(window as unknown as { api: unknown }).api = {
      agent: { run, onEvent: vi.fn(() => () => undefined) },
      chats: { save: vi.fn(async () => undefined) }
    }
    useStore.setState({
      messages: [],
      running: false,
      error: null,
      sessionId: 's1',
      activeChatId: 'c1',
      selection: { provider: 'google', model: 'gemini-2.5-flash' }
    })
  })

  it('9. appends the intent block to the task', async () => {
    useStore.setState({
      runOutputs: [{ id: 'o1', kind: 'site' }],
      runSources: [{ id: 's1', kind: 'folder', value: '/srv/docs' }]
    })

    await useStore.getState().send('build the landing page')

    expect(seen).toHaveLength(1)
    expect(String(seen[0]!.task).startsWith('build the landing page\n\nThis run should produce:')).toBe(true)
    expect(String(seen[0]!.task)).toContain('- a site')
    expect(String(seen[0]!.task)).toContain('`/srv/docs`')
    // No new IPC field and no extra channel: the outputs are text.
    expect(Object.keys(seen[0]!).sort()).not.toContain('outputs')
  })

  it('10. leaves an ordinary send exactly as it was', async () => {
    await useStore.getState().send('just text')

    expect(seen[0]?.task).toBe('just text')
  })

  it('11. keeps the machine block out of the user transcript', async () => {
    useStore.setState({ runOutputs: [{ id: 'o1', kind: 'file', target: 'a.md' }] })

    await useStore.getState().send('write it')

    expect(useStore.getState().messages.at(-1)?.content).toBe('write it')
  })

  it('12. drops the declarations when a new chat starts', () => {
    useStore.setState({
      runOutputs: [{ id: 'o1', kind: 'file' }],
      runSources: [{ id: 's1', kind: 'folder', value: '/srv/docs' }]
    })

    useStore.getState().newSession()

    expect(useStore.getState().runOutputs).toEqual([])
    expect(useStore.getState().runSources).toEqual([])
  })
})
