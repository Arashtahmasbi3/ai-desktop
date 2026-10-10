// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import PolicyWarningBanner from '../../src/renderer/src/components/PolicyWarningBanner'
import { evaluateProjectCommandWarning } from '../../src/renderer/src/lib/policy-warning'
import { defaultHostPolicy } from '@core/remote/host-policy'

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

describe('Chat policy warning (v2.3.2, C.2.2)', () => {
  it('stays silent for commands covered by the project policy', () => {
    const policy = defaultHostPolicy('srv-1', 'staging')
    expect(evaluateProjectCommandWarning(undefined, 'ls -la')).toBeNull()
    expect(evaluateProjectCommandWarning(policy, 'ls -la')).toBeNull()
    expect(evaluateProjectCommandWarning(policy, 'git status')).toBeNull()
  })

  it('flags a command outside policy with the current mode and reason', () => {
    const policy = defaultHostPolicy('srv-1', 'staging')
    const warning = evaluateProjectCommandWarning(policy, 'rm -rf /')
    expect(warning).not.toBeNull()
    expect(warning?.mode).toBe('staging')
    expect(warning?.reason).toMatch(/deny/i)

    // Fail-closed: an unrecognised command is "outside" the explicit policy.
    expect(evaluateProjectCommandWarning(policy, 'frobnicate --now')?.mode).toBe('staging')
  })

  it('renders the banner and wires Proceed / Cancel to the approval flow', () => {
    const onProceed = vi.fn()
    const onCancel = vi.fn()
    render(
      <PolicyWarningBanner
        warning={{ mode: 'staging', reason: 'Blocked by this host policy (deny rule).' }}
        onProceed={onProceed}
        onCancel={onCancel}
      />
    )

    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByText('This command is outside the project policy')).toBeTruthy()
    expect(screen.getByText('Current policy: Staging')).toBeTruthy()
    expect(screen.getByText('Blocked by this host policy (deny rule).')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Proceed anyway' }))
    expect(onProceed).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
