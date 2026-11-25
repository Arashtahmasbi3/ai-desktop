// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import SettingsApproval from '../../src/renderer/src/components/SettingsApproval'
import { useStore } from '../../src/renderer/src/store'

/**
 * T21 — the local-diagnostics selector.
 *
 * Off is the default, and turning it on asks for the **local** mode only: there is no upload, so the control's options are
 * the entire story of what the switch can do.
 */
const setTelemetry = vi.fn()

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  setTelemetry.mockReset()
  setTelemetry.mockResolvedValue({ telemetry: 'local' })
  useStore.setState({
    settings: { approvalMode: 'ask', rememberApprovalMode: false, checkpointMode: 'off' },
    toasts: []
  } as never)
  ;(window as unknown as { api: unknown }).api = {
    session: { setProfile: vi.fn(async () => ({})), get: vi.fn(async () => ({})) },
    settings: {
      setTelemetry,
      setAutoRoute: vi.fn(async () => ({})),
      setApprovalMode: vi.fn(async () => ({})),
      setPlanModeDefault: vi.fn(async () => ({})),
      setRememberApprovalMode: vi.fn(async () => ({})),
      setCheckpointMode: vi.fn(async () => ({}))
    }
  }
  cleanup()
})

describe('diagnostics selector (T21)', () => {
  it('defaults to off and offers only off or a local file', () => {
    render(<SettingsApproval />)
    const select = screen.getByTestId('telemetry') as HTMLSelectElement

    expect(select.value).toBe('off')
    expect(Array.from(select.options).map((option) => option.value)).toEqual(['off', 'local'])
  })

  it('switching to local asks for the local mode', async () => {
    render(<SettingsApproval />)
    fireEvent.change(screen.getByTestId('telemetry'), { target: { value: 'local' } })

    await waitFor(() => expect(setTelemetry).toHaveBeenCalledWith('local'))
  })
})
