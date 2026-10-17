// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import InlineTrace from '../../src/renderer/src/components/InlineTrace'
import PlanCard from '../../src/renderer/src/components/PlanCard'
import ToolResultCard from '../../src/renderer/src/components/ToolResultCard'
import { useStore } from '../../src/renderer/src/store'
import type { Plan } from '../../src/shared/plan'
import type { PlanRequest } from '../../src/shared/ui'
import type { TraceDecision } from '../../src/shared/trace'

/**
 * Item 8 — right-to-left text was mangled outside the message bubble.
 *
 * `MessageBubble` sets `dir="auto"` on its content, which is why Persian reads correctly there.
 * The trace rows, the plan card and the tool result card are LTR containers, so Persian inside
 * them got left-to-right punctuation and word order. The fix is per element, **not** `dir="rtl"`
 * on the app: the direction belongs to the text container that holds prose, while commands,
 * paths and ids keep an explicit `dir="ltr"` of their own.
 */
function decision(over: Partial<TraceDecision> = {}): TraceDecision {
  return {
    id: 'run-1:1',
    runId: 'run-1',
    phase: 'executing',
    intent: { summary: 'بررسی وضعیت سرور' },
    evidence: [],
    decision: 'read_file(a.ts)',
    outcome: 'ok',
    at: 1,
    ...over
  }
}

const plan: Plan = {
  id: 'plan-1',
  task: 'بررسی و انتقال پروژه',
  createdAt: 1,
  steps: [
    {
      id: 's1',
      actionId: 'a1',
      title: 'بررسی وضعیت سرور',
      tool: 'remote_shell',
      arguments: { command: 'pm2 list' }
    }
  ]
}

const request: PlanRequest = { id: 'req-1', runId: 'run-1', plan, warnings: [] }

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    agent: { respondPlan: () => Promise.resolve({ ok: true }), stopPlan: () => Promise.resolve() }
  }
  useStore.setState({
    decisions: [],
    messages: [],
    logs: [],
    changedFiles: [],
    reasoningByStep: {},
    pendingPlan: null,
    activePlan: null
  })
})

describe('Item 8 — Persian prose resolves its own direction', () => {
  it('1. every prose container in the trace is dir="auto"', () => {
    useStore.setState({
      decisions: [decision()],
      reasoningByStep: { 'run-1:1': 'بررسی فایل‌های پروژه' }
    })
    render(<InlineTrace />)

    /*
     * The section was already `auto`, and that is not enough: `dir="auto"` resolves once, from the
     * container's *own* first strong character — and the trace begins with the English label
     * "Execution trace", which pinned every Persian row inside it to LTR. Each row now decides.
     */
    expect(screen.getByTestId('inline-trace').getAttribute('dir')).toBe('auto')
    expect(screen.getByTestId('trace-latest').getAttribute('dir')).toBe('auto')
    expect(screen.getByTestId('trace-reasoning-text').getAttribute('dir')).toBe('auto')
    expect(screen.getByTestId('decision-summary').getAttribute('dir')).toBe('auto')
  })

  it('2. the plan step title is auto while its command block stays LTR', () => {
    useStore.setState({ pendingPlan: request })
    render(<PlanCard />)

    for (const title of screen.getAllByTestId('plan-step-title')) {
      expect(title.getAttribute('dir')).toBe('auto')
      expect(title.textContent).toContain('بررسی وضعیت سرور')
    }
    // The command is code: it must never take the prose's direction.
    for (const command of screen.getAllByTestId('plan-step-command')) {
      expect(command.getAttribute('dir')).toBe('ltr')
    }
  })

  it('3. the tool card body is auto while its commands and paths stay LTR', () => {
    render(
      <ToolResultCard
        name="remote_shell"
        ok={false}
        command="pm2 logs api --lines 100"
        cwd="/opt/demo-project"
        stdout="خطا: سرویس اجرا نشده است"
        exitCode={1}
      />
    )

    const body = screen.getByTestId('tool-card-body')
    expect(body.getAttribute('dir')).toBe('auto')
    expect(body.textContent).toContain('خطا: سرویس اجرا نشده است')

    // A command and a path are LTR wherever they appear — including inside the auto body.
    expect(screen.getByTestId('tool-card-raw-command').getAttribute('dir')).toBe('ltr')
    expect(screen.getByText('/opt/demo-project').getAttribute('dir')).toBe('ltr')

    /*
     * And the card itself is still an LTR container: the header is a command surface, not prose.
     * This is the difference between "the prose picks its direction" and "the app was flipped".
     */
    const header = screen.getByTestId('tool-card-header')
    expect(header.closest('[dir]')!.getAttribute('dir')).toBe('ltr')
    expect(document.documentElement.getAttribute('dir')).not.toBe('rtl')
  })
})
