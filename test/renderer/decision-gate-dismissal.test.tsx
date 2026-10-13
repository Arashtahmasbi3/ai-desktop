// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import ApprovalDialog from '../../src/renderer/src/components/ApprovalDialog'
import PreflightOverrideDialog from '../../src/renderer/src/components/PreflightOverrideDialog'
import { useStore } from '../../src/renderer/src/store'
import type { ApprovalRequest } from '@shared/ui'
import type { PreflightRequestView } from '@shared/preflight'

/**
 * U-14: a security gate is answered only by its own buttons. A stray Escape or a
 * backdrop click used to deny the approval (the dialog's onClose denied) or
 * cancel a preflight override.
 */

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

const respondApproval = vi.fn().mockResolvedValue(true)
const respondPreflight = vi.fn().mockResolvedValue(true)

function approval(): ApprovalRequest {
  return {
    id: 'ap-1',
    runId: 'r1',
    tool: 'remote_shell',
    summary: 'rm -rf /srv/app',
    arguments: {},
    kind: 'write',
    preview: 'rm -rf /srv/app'
  }
}

function preflight(): PreflightRequestView {
  return {
    id: 'pf-1',
    runId: 'r1',
    tool: 'remote_write_file',
    tier: 'block',
    reason: 'Disk 95% full',
    checks: [{ name: 'disk', status: 'fail', message: 'Disk 95% full' }],
    options: [
      { id: 'proceed', labelKey: 'preflight.override', tone: 'danger' },
      { id: 'cancel', labelKey: 'common.cancel', tone: 'neutral' }
    ],
    timeoutMs: 5 * 60 * 1000
  }
}

beforeEach(() => {
  respondApproval.mockClear()
  respondPreflight.mockClear()
  ;(window as unknown as { api: unknown }).api = {
    agent: {
      respondApproval,
      respondPreflight,
      approvalHistory: vi.fn(async () => []),
      approvedCommands: vi.fn(async () => [])
    }
  }
})

afterEach(cleanup)

describe('decision gates are not dismissed by accident (U-14)', () => {
  it('an Escape key press does not deny the approval', () => {
    useStore.setState({ pendingApproval: approval() })
    render(<ApprovalDialog />)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(respondApproval).not.toHaveBeenCalled()
    expect(useStore.getState().pendingApproval).not.toBeNull()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('a backdrop click does not deny the approval', () => {
    useStore.setState({ pendingApproval: approval() })
    render(<ApprovalDialog />)

    fireEvent.mouseDown(screen.getByRole('dialog').parentElement as HTMLElement)

    expect(respondApproval).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('a backdrop click does not cancel the preflight gate either', () => {
    useStore.setState({ pendingPreflight: preflight() })
    render(<PreflightOverrideDialog />)

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement as HTMLElement)

    expect(respondPreflight).not.toHaveBeenCalled()
    expect(useStore.getState().pendingPreflight).not.toBeNull()
  })

  it('still denies from the explicit button', () => {
    useStore.setState({ pendingApproval: approval() })
    render(<ApprovalDialog />)

    const actions = screen.getByTestId('approval-actions')
    const deny = Array.from(actions.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Deny'
    ) as HTMLButtonElement
    fireEvent.click(deny)

    expect(respondApproval).toHaveBeenCalledWith('ap-1', false)
  })
})
