// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import ApprovalDialog from '../../src/renderer/src/components/ApprovalDialog'
import { useStore } from '../../src/renderer/src/store'
import type { ApprovalRequest } from '../../src/shared/ui'

beforeAll(async () => {
  /*
   * The two keys ship as i18n snippets and are merged into en.json/fa.json separately, so the test installs
   * them itself: what it pins is the wiring (target line + address), not the merge order.
   */
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      chat: {
        approvalNetworkTarget: 'Contacts {{target}}',
        approvalNetworkTargetUnknown: 'Target could not be read from the arguments'
      }
    },
    true,
    true
  )
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    agent: {
      approvalHistory: () => Promise.resolve([]),
      approvedCommands: () => Promise.resolve([]),
      respondApproval: () => Promise.resolve(true)
    }
  }
  useStore.setState({ pendingApproval: null })
})

afterEach(cleanup)

function request(overrides: Partial<ApprovalRequest>): ApprovalRequest {
  return {
    id: 'req-1',
    runId: 'run-1',
    tool: 'remote_shell',
    summary: 'Run: nc -z 10.0.0.5 22',
    arguments: { command: 'nc -z 10.0.0.5 22' },
    kind: 'shell',
    preview: 'nc -z 10.0.0.5 22',
    reason: 'network_action',
    ...overrides
  }
}

/**
 * B2-3: the reason says "network action"; the dialog also says *where*.
 *
 * `curl http://localhost:3000` is classified exactly like a probe of somebody else's machine, so the address is
 * what tells the two apart — it has to be on screen. The line is driven by the same pure detector the gate uses,
 * not by a second copy of the rules, so a command the policy asks about always has its target shown.
 */
describe('the approval dialog names where a network action goes (B2-3)', () => {
  it('renders a target line for a network action', () => {
    useStore.setState({ pendingApproval: request({}) })
    render(<ApprovalDialog />)
    const line = screen.getByTestId('approval-network-target')
    // The address itself is rendered next to the (translated) label.
    expect(line.textContent).toContain('10.0.0.5:22')
  })

  it('renders no target line for an ordinary command', () => {
    useStore.setState({
      pendingApproval: request({
        summary: 'Run: ls -la',
        arguments: { command: 'ls -la' },
        preview: 'ls -la',
        reason: 'not_whitelisted'
      })
    })
    render(<ApprovalDialog />)
    expect(screen.queryByTestId('approval-network-target')).toBeNull()
  })
})
