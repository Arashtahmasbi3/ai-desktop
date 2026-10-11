// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import ApprovalDialog from '../../src/renderer/src/components/ApprovalDialog'
import { createApprovalGate } from '../../src/main/approval-gate'
import { useStore } from '../../src/renderer/src/store'
import type { AgentAction } from '../../src/shared/agent'
import type { ApprovalRequest } from '../../src/shared/ui'
import type { ApprovalOutcome } from '../../src/shared/approval'

beforeAll(async () => {
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

function action(name: string, args: Record<string, unknown>): AgentAction {
  return {
    id: 'a1',
    name,
    arguments: args,
    rawArguments: JSON.stringify(args),
    valid: true,
    signature: `${name}:${JSON.stringify(args)}`
  }
}

function request(overrides: Partial<ApprovalRequest>): ApprovalRequest {
  return {
    id: 'req-1',
    runId: 'run-1',
    tool: 'remote_write_file',
    summary: 'write src/index.ts',
    arguments: { path: 'src/index.ts', content: 'x' },
    kind: 'write',
    preview: 'write src/index.ts',
    ...overrides
  }
}

/**
 * Task 2.3 - the approval dialog explains *why* it appeared and *what* will run.
 * Scenario 1 asserts the real gate suppresses the prompt for a whitelisted
 * read-only command (Task 2.1); scenarios 2-3 assert the dialog renders the
 * reason, tool, target and category badge.
 */
describe('Task 2.3 - clearer approval dialog', () => {
  it('1. a whitelisted read-only command never opens the dialog', async () => {
    const asked = vi.fn<(a: AgentAction) => Promise<ApprovalOutcome>>()
    const gate = createApprovalGate({ mode: 'ask', requestApproval: asked })

    const allowed = await gate(action('remote_shell', { command: 'ls -la /opt/app' }))

    expect(allowed).toBe(true)
    expect(asked).not.toHaveBeenCalled()
    expect(screen.queryByText('Approve agent action?')).toBeNull()
  })

  it('2. a write action shows the reason, tool, target and a Write badge', () => {
    useStore.setState({
      pendingApproval: request({
        reason: 'write',
        server: 'spmotor',
        workingDirectory: '/opt/sepehr-motor'
      })
    })
    render(<ApprovalDialog />)

    expect(screen.getByText('Write operation')).toBeTruthy()
    expect(screen.getByText('remote_write_file')).toBeTruthy()
    expect(screen.getByText('spmotor')).toBeTruthy()
    expect(screen.getByText('/opt/sepehr-motor')).toBeTruthy()
    expect(screen.getByText('Write')).toBeTruthy()
  })

  it('3. a dangerous command shows the destructive warning and badge', () => {
    useStore.setState({
      pendingApproval: request({
        tool: 'remote_shell',
        kind: 'shell',
        dangerous: true,
        reason: 'dangerous',
        summary: 'rm -rf /',
        preview: 'rm -rf /'
      })
    })
    render(<ApprovalDialog />)

    expect(screen.getByText(/deny list/)).toBeTruthy()
    expect(screen.getByText('Destructive')).toBeTruthy()
    expect(screen.getByText('Dangerous command')).toBeTruthy()
  })
})

/**
 * Task 2.4 - a clearer "cannot be remembered" message plus a no-undo warning on
 * anything that can mutate the server.
 */
describe('Task 2.4 - clearer safety messaging', () => {
  it('1. a non-whitelisted read tool explains why it cannot be remembered', () => {
    useStore.setState({
      pendingApproval: request({
        tool: 'remote_custom_inspect',
        kind: 'read',
        summary: 'inspect something',
        preview: 'inspect something',
        reason: 'not_whitelisted'
      })
    })
    render(<ApprovalDialog />)

    expect(screen.getByText(/cannot be remembered because it can modify the system/)).toBeTruthy()
    expect(screen.queryByText(/No undo available/)).toBeNull()
  })

  it('2. a write tool adds the "changes applied directly / no undo" warning', () => {
    useStore.setState({
      pendingApproval: request({ tool: 'remote_write_file', kind: 'write', reason: 'write' })
    })
    render(<ApprovalDialog />)

    expect(screen.getByText(/cannot be remembered because it can modify the system/)).toBeTruthy()
    expect(screen.getByText(/No undo available/)).toBeTruthy()
  })
})

/**
 * v2.5.8 - the dialog must be centred in the viewport.
 *
 * It used `absolute inset-0`, which anchored it to the ChatPanel section (and
 * could drift when the panel scrolled). It now mirrors the other modals with a
 * `fixed inset-0 ... items-center justify-center` backdrop.
 */
describe('v2.5.8 - dialog centring', () => {
  it('1. the backdrop is fixed to the viewport and centres its panel', () => {
    useStore.setState({ pendingApproval: request({ reason: 'write' }) })
    render(<ApprovalDialog />)

    // v2.6.0 renders the dialog through a portal into document.body, so the
    // panel's parent (the backdrop) is found from the dialog role itself.
    const panel = screen.getByRole('dialog')
    const backdrop = panel.parentElement as HTMLElement
    expect(backdrop.classList.contains('fixed')).toBe(true)
    expect(backdrop.classList.contains('inset-0')).toBe(true)
    expect(backdrop.classList.contains('items-center')).toBe(true)
    expect(backdrop.classList.contains('justify-center')).toBe(true)
  })
})
