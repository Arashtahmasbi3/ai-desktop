// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import ApprovalDialog from '../../src/renderer/src/components/ApprovalDialog'
import { useStore } from '../../src/renderer/src/store'
import type { ApprovalRequest } from '../../src/shared/ui'

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    agent: {
      approvalHistory: () => Promise.resolve([]),
      approvedCommands: () => Promise.resolve([]),
      respondApproval: () => Promise.resolve(true),
      revokeApprovedCommand: () => Promise.resolve()
    }
  }
  useStore.setState({ pendingApproval: null })
})

afterEach(cleanup)

function request(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: 'req-1',
    runId: 'run-1',
    tool: 'remote_shell',
    summary: 'npm install',
    arguments: { command: 'npm install' },
    kind: 'shell',
    preview: 'npm install && chmod 777 /opt/sepehr-motor',
    reason: 'write',
    server: 'spmotor',
    workingDirectory: '/opt/sepehr-motor',
    ...overrides
  }
}

/**
 * v2.6.0, C.2 - the action bar must stay visible and reachable on the common
 * laptop/desktop resolutions. jsdom cannot lay out pixels, so the real
 * regression (a nowrap action row wider than the panel being clipped by the
 * modal's `overflow-hidden`) is asserted structurally:
 *   - the actions row wraps instead of overflowing horizontally,
 *   - each button refuses to wrap its own label,
 *   - the footer is a non-shrinking sibling of the scroll body.
 */
const VIEWPORTS = [
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1280x720', width: 1280, height: 720 },
  { name: '1920x1080', width: 1920, height: 1080 }
]

describe('v2.6.0 C.2 - approval actions stay visible on every viewport', () => {
  for (const viewport of VIEWPORTS) {
    it(`${viewport.name} - the three actions render inside the non-shrinking footer`, () => {
      const originalWidth = window.innerWidth
      const originalHeight = window.innerHeight
      window.innerWidth = viewport.width
      window.innerHeight = viewport.height

      useStore.setState({ pendingApproval: request() })
      render(<ApprovalDialog />)

      const footer = screen.getByTestId('approval-footer')
      // The footer is a sibling of the scroll body, not inside it.
      const dialog = screen.getByRole('dialog')
      const body = dialog.querySelector<HTMLElement>(':scope > .overflow-y-auto')
      expect(body).toBeTruthy()
      expect(body!.contains(footer)).toBe(false)
      expect(footer.className).toContain('shrink-0')

      for (const label of ['Deny', 'Deny & explain', 'Approve']) {
        expect(screen.getByText(label)).toBeTruthy()
      }

      window.innerWidth = originalWidth
      window.innerHeight = originalHeight
    })
  }

  it('4. the actions row wraps rather than overflowing the panel', () => {
    useStore.setState({ pendingApproval: request() })
    render(<ApprovalDialog />)

    const actions = screen.getByTestId('approval-actions')
    expect(actions.className).toContain('flex-wrap')

    for (const label of ['Deny', 'Deny & explain', 'Approve']) {
      expect(screen.getByText(label).className).toContain('whitespace-nowrap')
    }
  })

  it('5. Deny resolves the approval as not approved', () => {
    let outcome: unknown
    ;(window as unknown as { api: unknown }).api = {
      agent: {
        approvalHistory: () => Promise.resolve([]),
        approvedCommands: () => Promise.resolve([]),
        respondApproval: (_id: string, value: unknown) => {
          outcome = value
          return Promise.resolve(true)
        }
      }
    }
    useStore.setState({ pendingApproval: request() })
    render(<ApprovalDialog />)

    fireEvent.click(screen.getByText('Deny'))
    expect(outcome).toBe(false)
  })

  it('6. the sticky header always shows tool, server and working directory', () => {
    useStore.setState({ pendingApproval: request() })
    render(<ApprovalDialog />)

    const dialog = screen.getByRole('dialog')
    const body = dialog.querySelector<HTMLElement>(':scope > .overflow-y-auto')!
    const summary = screen.getByTestId('approval-summary')
    // Identity lives in the header so it stays visible while the body scrolls.
    expect(within(summary).getByText('remote_shell')).toBeTruthy()
    expect(within(summary).getByText('spmotor')).toBeTruthy()
    expect(within(summary).getByText('/opt/sepehr-motor')).toBeTruthy()
    expect(body.contains(summary)).toBe(false)
  })
})
