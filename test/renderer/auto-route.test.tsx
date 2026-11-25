// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import SettingsApproval from '../../src/renderer/src/components/SettingsApproval'
import { useStore } from '../../src/renderer/src/store'

/**
 * T20 — the opt-in routing toggle.
 *
 * Routing is off by default, and the toggle is the only way it turns on: a model change the user did not ask for is a
 * price change they did not ask for.
 */
const setAutoRoute = vi.fn()

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  setAutoRoute.mockReset()
  setAutoRoute.mockResolvedValue({ autoRoute: true })
  useStore.setState({
    settings: { approvalMode: 'ask', rememberApprovalMode: false, checkpointMode: 'off', autoRoute: false },
    toasts: []
  } as never)
  ;(window as unknown as { api: unknown }).api = {
    session: { setProfile: vi.fn(async () => ({})), get: vi.fn(async () => ({})) },
    settings: {
      setAutoRoute,
      setApprovalMode: vi.fn(async () => ({})),
      setPlanModeDefault: vi.fn(async () => ({})),
      setRememberApprovalMode: vi.fn(async () => ({})),
      setCheckpointMode: vi.fn(async () => ({}))
    }
  }
  cleanup()
})

describe('auto route toggle (T20)', () => {
  it('is unchecked by default and turns routing on', async () => {
    render(<SettingsApproval />)
    const toggle = screen.getByTestId('auto-route') as HTMLInputElement
    expect(toggle.checked).toBe(false)

    fireEvent.click(toggle)

    await waitFor(() => expect(setAutoRoute).toHaveBeenCalledWith(true))
  })

  it('reflects the persisted setting', () => {
    useStore.setState({
      settings: { approvalMode: 'ask', autoRoute: true },
      toasts: []
    } as never)
    render(<SettingsApproval />)

    expect((screen.getByTestId('auto-route') as HTMLInputElement).checked).toBe(true)
  })
})
