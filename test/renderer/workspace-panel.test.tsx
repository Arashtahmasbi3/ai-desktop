// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import WorkspacePanel from '../../src/renderer/src/components/WorkspacePanel'
import { useStore } from '../../src/renderer/src/store'

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  useStore.setState({ workspacePanelOpen: true, workspacePanelTab: 'output' })
})

afterEach(cleanup)

/**
 * v2.6.0, B.1 - the right workspace column is tabbed (Output/Sources) and its
 * visibility is owned by the store so the chat header can toggle it.
 */
describe('v2.6.0 B.1 - workspace panel', () => {
  it('1. defaults to the Output tab and switches to Sources', () => {
    render(<WorkspacePanel />)
    expect(screen.getByRole('button', { name: 'Output' }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Sources' }))
    expect(useStore.getState().workspacePanelTab).toBe('sources')
    expect(screen.getByRole('button', { name: 'Sources' }).getAttribute('aria-pressed')).toBe(
      'true'
    )
    expect(useStore.getState().workspacePanelOpen).toBe(true)
  })

  it('2. the close button hides the panel', () => {
    render(<WorkspacePanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Hide panel' }))
    expect(useStore.getState().workspacePanelOpen).toBe(false)
  })

  it('3. selecting a tab re-opens a closed panel', () => {
    useStore.setState({ workspacePanelOpen: false })
    useStore.getState().setWorkspacePanelTab('sources')
    expect(useStore.getState().workspacePanelOpen).toBe(true)
  })

  it('4. the panel body is the scroll region, header stays fixed', () => {
    render(<WorkspacePanel />)
    const panel = screen.getByLabelText('Workspace')
    const body = panel.querySelector<HTMLElement>(':scope > .overflow-y-auto')
    expect(body).toBeTruthy()
    expect(body!.className).toContain('flex-1')
  })
})
