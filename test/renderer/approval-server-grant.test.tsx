// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import ApprovalDialog from '../../src/renderer/src/components/ApprovalDialog'
import { useStore } from '../../src/renderer/src/store'
import type { ApprovalRequest } from '../../src/shared/ui'

/**
 * v2.9.0 (A) — the scoped server grant's consent surface.
 *
 * The store, the gate and `ApprovalOutcome.grant` landed with tests, but nothing could mint
 * a grant from the UI: the branch for a non-rememberable tool (shell, writes) only said
 * "cannot be remembered", which is exactly the dead end the user hit — a dialog per command
 * on their own VPS, forever. The checkbox now appears *there*, and only there.
 */
beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

function request(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: 'ap-1',
    runId: 'run-1',
    tool: 'remote_shell',
    summary: 'npm run build',
    arguments: { command: 'npm run build' },
    kind: 'shell',
    preview: 'npm run build',
    dangerous: false,
    server: 'my-server',
    ...overrides
  } as ApprovalRequest
}

const respond = vi.fn(async () => true)

beforeEach(() => {
  respond.mockClear()
  ;(window as unknown as { api: unknown }).api = {
    agent: {
      respondApproval: respond,
      // The dialog reads its history and the learned-approval list on mount.
      approvalHistory: vi.fn(async () => []),
      approvedCommands: vi.fn(async () => [])
    }
  }
  useStore.setState({ pendingApproval: null, settings: null })
})

describe('ApprovalDialog: the scoped server grant (v2.9.0)', () => {
  it('offers the bounded grant for a shell command on a server', () => {
    useStore.setState({ pendingApproval: request() })
    render(<ApprovalDialog />)

    const grant = screen.getByTestId('approval-grant-server')
    expect(grant.textContent).toContain('my-server')
    expect(grant.textContent).toContain('30 minutes')
    // The promise it makes must be the promise the gate keeps.
    expect(grant.textContent).toMatch(/deny list still blocks/i)
  })

  it('sends grant: server with the approval when the box is ticked', async () => {
    useStore.setState({ pendingApproval: request() })
    render(<ApprovalDialog />)

    fireEvent.click(screen.getByRole('checkbox', { name: /Approve every command/i }))
    fireEvent.click(screen.getByRole('button', { name: i18n.t('chat.approve') }))

    await waitFor(() =>
      expect(respond).toHaveBeenCalledWith('ap-1', { approved: true, grant: 'server' })
    )
  })

  it('sends a plain approval when the box is left alone', async () => {
    useStore.setState({ pendingApproval: request() })
    render(<ApprovalDialog />)

    fireEvent.click(screen.getByRole('button', { name: i18n.t('chat.approve') }))

    await waitFor(() => expect(respond).toHaveBeenCalledWith('ap-1', { approved: true }))
  })

  it('does not offer the grant for a local action with no server', () => {
    useStore.setState({ pendingApproval: request({ server: undefined, tool: 'run_command' }) })
    render(<ApprovalDialog />)
    expect(screen.queryByTestId('approval-grant-server')).toBeNull()
  })

  it('does not offer the grant where a permanent remember is already offered', () => {
    // A read tool is rememberable, so the bounded form would be noise — and mixing the two
    // would make the permission story harder to read, not easier.
    useStore.setState({ pendingApproval: request({ tool: 'remote_read_file', kind: 'read' }) })
    render(<ApprovalDialog />)
    expect(screen.queryByTestId('approval-grant-server')).toBeNull()
  })
})
