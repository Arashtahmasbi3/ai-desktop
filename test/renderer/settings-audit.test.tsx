// @vitest-environment jsdom
/**
 * v2.6.2 Topic 3, T3.3 - Settings → Advanced → Audit.
 *
 * `window.api` is the IPC boundary, so it is stubbed (as the real preload does);
 * the component's own state machine and rendering are exercised for real.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import SettingsAudit from '../../src/renderer/src/components/SettingsAudit'

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
    agent: {
      audit: {
        path: vi.fn().mockResolvedValue('/work/app/.ai-desktop/audit.log'),
        verify: vi.fn()
      }
    }
  }
})

afterEach(cleanup)

function auditApi(): { path: ReturnType<typeof vi.fn>; verify: ReturnType<typeof vi.fn> } {
  return (globalThis as unknown as { window: { api: { agent: { audit: never } } } }).window.api.agent
    .audit
}

describe('Settings → Audit', () => {
  it('shows the active project audit file', async () => {
    render(<SettingsAudit />)
    expect(await screen.findByText('/work/app/.ai-desktop/audit.log')).toBeTruthy()
  })

  it('reports an intact chain after Verify', async () => {
    auditApi().verify.mockResolvedValue({ ok: true, lines: 7 })
    render(<SettingsAudit />)
    await screen.findByText('/work/app/.ai-desktop/audit.log')

    fireEvent.click(screen.getByText('Verify audit'))
    expect(await screen.findByText('Audit chain intact (7 lines).')).toBeTruthy()
  })

  it('surfaces tampering with the broken line number', async () => {
    auditApi().verify.mockResolvedValue({ ok: false, brokenAt: 4, lines: 9, reason: 'hash mismatch' })
    render(<SettingsAudit />)
    await screen.findByText('/work/app/.ai-desktop/audit.log')

    fireEvent.click(screen.getByText('Verify audit'))
    expect(await screen.findByText('Tampering detected at line 5: hash mismatch')).toBeTruthy()
  })

  it('shows a no-project hint when there is no audit path', async () => {
    auditApi().path.mockResolvedValue(null)
    render(<SettingsAudit />)
    await waitFor(() => expect(screen.getByText('Select a project to see its audit file.')).toBeTruthy())
  })
})
