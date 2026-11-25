// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import SettingsApproval from '../../src/renderer/src/components/SettingsApproval'
import { useStore } from '../../src/renderer/src/store'

/**
 * T17 — agent preset buttons.
 *
 * A preset must write **all three** settings it names: the profile, the approval mode and the plan-mode default. The test
 * clicks each one and asserts the triple, because a preset that forgot the plan flag would look identical to "standard"
 * while behaving differently.
 */
const setProfile = vi.fn()
const setApprovalMode = vi.fn()
const setPlanModeDefault = vi.fn()

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  setProfile.mockReset()
  setApprovalMode.mockReset()
  setPlanModeDefault.mockReset()
  setProfile.mockResolvedValue({})
  setApprovalMode.mockResolvedValue({ approvalMode: 'ask' })
  setPlanModeDefault.mockResolvedValue({ planModeDefault: false })
  useStore.setState({
    settings: { approvalMode: 'ask', rememberApprovalMode: false, checkpointMode: 'off', planModeDefault: false },
    toasts: []
  } as never)
  ;(window as unknown as { api: unknown }).api = {
    session: { setProfile, get: vi.fn(async () => ({})) },
    settings: {
      setApprovalMode,
      setPlanModeDefault,
      setRememberApprovalMode: vi.fn(async () => ({})),
      setCheckpointMode: vi.fn(async () => ({}))
    }
  }
  cleanup()
})

describe('agent presets (T17)', () => {
  it('shows the three presets', () => {
    render(<SettingsApproval />)
    for (const id of ['standard', 'minimal', 'review'] as const) {
      expect(screen.getByTestId(`agent-preset-${id}`)).toBeTruthy()
    }
  })

  it('minimal is read-only and does not plan', async () => {
    render(<SettingsApproval />)
    fireEvent.click(screen.getByTestId('agent-preset-minimal'))

    await waitFor(() => expect(setProfile).toHaveBeenCalledWith('investigate'))
    await waitFor(() => expect(setPlanModeDefault).toHaveBeenCalledWith(false))
  })

  it('review keeps develop but turns the plan mode on', async () => {
    render(<SettingsApproval />)
    fireEvent.click(screen.getByTestId('agent-preset-review'))

    await waitFor(() => expect(setProfile).toHaveBeenCalledWith('develop'))
    await waitFor(() => expect(setPlanModeDefault).toHaveBeenCalledWith(true))
  })
})
