// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import ApprovalDialog from '../../src/renderer/src/components/ApprovalDialog'
import PlanCard from '../../src/renderer/src/components/PlanCard'
import ContextPreviewCard from '../../src/renderer/src/components/ContextPreviewCard'
import { useStore } from '../../src/renderer/src/store'
import type { Plan } from '@shared/plan'
import type { ApprovalRequest, PlanRequest } from '@shared/ui'
import type { ContextPreview } from '@shared/context-preview'

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    agent: {
      approvalHistory: () => Promise.resolve([]),
      approvedCommands: () => Promise.resolve([]),
      respondApproval: () => Promise.resolve(true),
      respondPlan: vi.fn(),
      stopPlan: vi.fn()
    }
  }
  useStore.setState({ pendingApproval: null, pendingPlan: null, activePlan: null })
})

afterEach(cleanup)

/** The dialog's own scroll region (a direct child marked overflow-y-auto). */
function scrollRegion(): HTMLElement {
  const dialog = screen.getByRole('dialog')
  const region = dialog.querySelector<HTMLElement>(':scope > .overflow-y-auto')
  if (!region) throw new Error('no scroll region on the dialog')
  return region
}

const approval: ApprovalRequest = {
  id: 'req-1',
  runId: 'run-1',
  tool: 'remote_write_file',
  summary: 'write src/index.ts',
  arguments: { path: 'src/index.ts', content: 'x' },
  kind: 'write',
  preview: 'write src/index.ts',
  reason: 'write'
}

const plan: Plan = {
  id: 'plan-1',
  task: 'ship it',
  createdAt: 1,
  steps: [
    { id: 'step-1', actionId: 'a1', title: 'Install deps', tool: 'remote_shell', arguments: { command: 'npm install' } }
  ]
}
const planRequest: PlanRequest = { id: 'req-2', runId: 'run-1', plan, warnings: [] }

const preview: ContextPreview = {
  provider: 'deepseek',
  model: 'deepseek-chat',
  tokens: 120,
  included: [{ key: 'system', label: 'System prompt', tokens: 80 }],
  blockedFiles: [],
  excluded: ['Secrets and API keys']
}

/**
 * v2.6.0, A.3 - long content must scroll while the action buttons stay put.
 * Each migrated dialog exposes its body as a direct `overflow-y-auto` child;
 * the primary action must live outside it.
 */
describe('v2.6.0 A.3 - long content keeps the action buttons visible', () => {
  it('1. ApprovalDialog - Approve is outside the scroll region', () => {
    useStore.setState({ pendingApproval: approval })
    render(<ApprovalDialog />)

    const region = scrollRegion()
    expect(region.contains(screen.getByText('Approve'))).toBe(false)
    expect(region.contains(screen.getByText('Deny'))).toBe(false)
  })

  it('2. PlanCard - Approve plan is outside the scroll region', () => {
    useStore.setState({ pendingPlan: planRequest })
    render(<PlanCard />)

    const region = scrollRegion()
    expect(region.contains(screen.getByText('Approve plan'))).toBe(false)
    expect(region.contains(screen.getByText('Modify'))).toBe(false)
  })

  it('3. ContextPreviewCard - Send anyway is outside the scroll region', () => {
    render(<ContextPreviewCard preview={preview} onSend={() => undefined} onClose={() => undefined} />)

    const region = scrollRegion()
    expect(region.contains(screen.getByText('Send anyway'))).toBe(false)
    expect(region.contains(screen.getByText('Cancel'))).toBe(false)
  })

  it('4. the scroll region can grow independently of the panel', () => {
    useStore.setState({ pendingApproval: approval })
    render(<ApprovalDialog />)

    const region = scrollRegion()
    expect(region.className).toContain('flex-1')
    expect(region.className).toContain('min-h-0')
  })
})
