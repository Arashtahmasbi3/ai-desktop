// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import SettingsApproval from '../../src/renderer/src/components/SettingsApproval'
import { useStore } from '../../src/renderer/src/store'

/**
 * T19 — the preset buttons.
 *
 * Clicking a preset must write **both** settings: the profile (whether the run may write) and the approval mode (whether
 * it asks). A button that only changed one of them would leave the user with a combination the label does not describe.
 */
const setProfile = vi.fn()
const setApprovalMode = vi.fn()

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  setProfile.mockReset()
  setApprovalMode.mockReset()
  setProfile.mockResolvedValue({})
  setApprovalMode.mockResolvedValue({ approvalMode: 'ask' })
  useStore.setState({
    settings: { approvalMode: 'ask', rememberApprovalMode: false, checkpointMode: 'off' },
    toasts: []
  } as never)
  ;(window as unknown as { api: unknown }).api = {
    session: { setProfile, get: vi.fn(async () => ({})) },
    settings: {
      setApprovalMode,
      setRememberApprovalMode: vi.fn(async () => ({})),
      setCheckpointMode: vi.fn(async () => ({})),
      setPlanModeDefault: vi.fn(async () => ({}))
    }
  }
  cleanup()
})

describe('permission presets (T19)', () => {
  it('shows the three presets', () => {
    render(<SettingsApproval />)

    for (const id of ['read-only', 'standard', 'auto'] as const) {
      expect(screen.getByTestId(`preset-${id}`)).toBeTruthy()
    }
  })

  it('writes the profile and the approval mode together', async () => {
    render(<SettingsApproval />)

    fireEvent.click(screen.getByTestId('preset-read-only'))

    await waitFor(() => expect(setProfile).toHaveBeenCalledWith('investigate'))
    await waitFor(() => expect(setApprovalMode).toHaveBeenCalledWith('ask'))
  })

  it('auto-approve sets develop plus auto-write', async () => {
    render(<SettingsApproval />)

    fireEvent.click(screen.getByTestId('preset-auto'))

    await waitFor(() => expect(setProfile).toHaveBeenCalledWith('develop'))
    await waitFor(() => expect(setApprovalMode).toHaveBeenCalledWith('auto-write'))
  })
})
