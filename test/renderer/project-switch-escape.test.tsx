// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import ProjectSwitchDialog from '../../src/renderer/src/components/ProjectSwitchDialog'
import { useStore } from '../../src/renderer/src/store'

/*
 * Two things this asserts, and one it deliberately does not.
 *
 * Asserts: the dialog role and aria-modal sit on the PANEL rather than the backdrop (the first fix claimed to move them
 * and did not - the render test is what caught the false claim), and focus returns to the opener when the dialog goes.
 *
 * Does not assert: that Escape cancels. The handler is in the component and the keyboard path works in the app, but two
 * attempts to observe it from this environment failed - dispatching on the document did not reach the spy, and rather
 * than weaken the assertion into something that passes for the wrong reason, the test says so. A render test that reaches
 * the handler is open work, not a claim.
 */
function seed(): void {
  useStore.setState({
    settings: {
      activeProjectId: 'a',
      projects: [
        { id: 'a', name: 'Alpha', path: '/a', type: 'local' },
        { id: 'b', name: 'Bravo', path: '/b', type: 'local' }
      ]
    } as never,
    messages: [{ id: 'm1', role: 'user', content: 'hello', at: 1 }],
    activeChatId: 'chat-1',
    sessionId: 'chat-1',
    pendingProjectSwitch: null
  })
}

describe('the project-switch dialog', () => {
  beforeEach(() => {
    // RTL does not clean up on its own here, and a leftover dialog from the previous test makes the next query ambiguous.
    cleanup()
    seed()
  })

  it('puts the dialog role on the panel, not on the backdrop', () => {
    useStore.setState({ pendingProjectSwitch: 'b' })
    render(<ProjectSwitchDialog />)
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('data-testid')).toBe(null)
    expect(screen.getByTestId('project-switch-dialog').getAttribute('role')).toBe(null)
  })

  it('gives focus back to whatever asked for the switch', () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    expect(document.activeElement).toBe(opener)
    act(() => {
      useStore.setState({ pendingProjectSwitch: 'b' })
    })
    const { unmount } = render(<ProjectSwitchDialog />)
    unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
  it('removes the dialog from the DOM on Escape', async () => {
    // The behaviour a user sees, with the API a real window provides: cancelProjectSwitch reads the store and may touch
    // the bridge, so a test without one fails for the wrong reason - which is exactly what the first attempt did.
    ;(window as unknown as { api: unknown }).api = {
      projects: { open: async () => null },
      chats: { save: async () => ({ id: 'chat-1' }), linkProject: async () => null, list: async () => [] },
      fs: { list: async () => [] },
      agent: { goal: { list: async () => [], resolution: async () => null } }
    }
    useStore.setState({ pendingProjectSwitch: 'b' })
    render(<ProjectSwitchDialog />)
    expect(screen.getByTestId('project-switch-dialog')).toBeTruthy()
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      // The store action may be asynchronous; give its promise a turn before asserting the DOM.
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.queryByTestId('project-switch-dialog')).toBe(null)
  })
})