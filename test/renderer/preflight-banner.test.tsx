// @vitest-environment jsdom
/**
 * v2.6.3 Topic 3.1 - preflight results must reach the UI, tiered.
 *
 * The orchestrator already logged preflight outcomes, but nothing rendered them and
 * `PreflightBanner` was dead code. These tests pin the tier mapping, the banner's
 * tier-aware presentation, and the end-to-end store -> ChatPanel wiring.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import PreflightBanner from '../../src/renderer/src/components/PreflightBanner'
import ChatPanel from '../../src/renderer/src/components/ChatPanel'
import { useStore } from '../../src/renderer/src/store'
import type { PreflightCheck, PreflightTier } from '@core/agent/preflight'

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    agent: { explainStep: vi.fn().mockResolvedValue(null) },
    dialog: { pickDirectory: vi.fn().mockResolvedValue(null), pickFile: vi.fn().mockResolvedValue([]) }
  }
  useStore.setState({
    messages: [],
    logs: [],
    decisions: [],
    running: false,
    preflightNotice: null,
    settings: null,
    error: null,
    loopStop: null,
    warnings: []
  })
})

afterEach(cleanup)

function check(name: string, status: PreflightCheck['status'], message: string): PreflightCheck {
  return { name, status, message }
}

function emitPreflight(tier: PreflightTier, blocked: boolean): void {
  useStore.getState().applyEvent({
    type: 'log',
    entry: {
      ts: new Date().toISOString(),
      level: tier === 'warn' ? 'warn' : 'error',
      event: 'preflight',
      runId: 'run-1',
      tool: 'remote_write_file',
      step: 2,
      tier,
      blocked,
      checks: [check('git-clean', 'warn', '3 uncommitted file(s)')]
    }
  })
}

describe('PreflightBanner', () => {
  it('renders nothing for a clean result', () => {
    const { container } = render(<PreflightBanner checks={[check('disk', 'pass', '50% used')]} />)
    expect(container.firstChild).toBeNull()
  })

  it('offers an override only for warnings', () => {
    const onProceed = vi.fn()
    render(
      <PreflightBanner
        checks={[check('git-clean', 'warn', '3 uncommitted file(s)')]}
        tier="warn"
        onProceed={onProceed}
      />
    )
    const banner = screen.getByTestId('preflight-banner')
    expect(banner.dataset.tier).toBe('warn')
    fireEvent.click(screen.getByRole('button', { name: /Proceed anyway/i }))
    expect(onProceed).toHaveBeenCalledOnce()
  })

  it.each(['block', 'critical'] as const)('hides the override for a %s tier', (tier) => {
    const onProceed = vi.fn()
    render(
      <PreflightBanner
        checks={[check('disk', 'fail', 'Disk 95% full')]}
        tier={tier}
        onProceed={onProceed}
      />
    )
    expect(screen.getByTestId('preflight-banner').dataset.tier).toBe(tier)
    expect(screen.queryByRole('button', { name: /Proceed anyway/i })).toBeNull()
  })
})

describe('ChatPanel preflight wiring', () => {
  it('shows the banner when the orchestrator reports a warning', () => {
    emitPreflight('warn', false)
    render(<ChatPanel />)
    expect(screen.getByTestId('preflight-banner').textContent).toContain('3 uncommitted')
  })

  it('dismisses the banner without touching the log history', () => {
    emitPreflight('warn', false)
    render(<ChatPanel />)
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }))

    expect(useStore.getState().preflightNotice).toBeNull()
    expect(useStore.getState().logs).toHaveLength(1)
  })

  it('clears the banner when a new run starts', () => {
    emitPreflight('block', true)
    expect(useStore.getState().preflightNotice?.blocked).toBe(true)

    useStore.getState().applyEvent({ type: 'run:start', runId: 'run-2', task: 'next', at: 1 })
    expect(useStore.getState().preflightNotice).toBeNull()
  })
})
