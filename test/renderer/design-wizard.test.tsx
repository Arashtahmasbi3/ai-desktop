// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import DesignWizard from '../../src/renderer/src/components/design/DesignWizard'
import { useStore } from '../../src/renderer/src/store'

/**
 * Art Board phase 0 — the wizard.
 *
 * The user this exists for has never built a site. The test walks the five steps the way they would: press next, keep
 * the defaults, type a name, press the final button — and asserts that the service received the answers the screens
 * showed, not a hand-built object that could drift from the UI.
 */
const created = vi.fn()

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  created.mockReset()
  ;(window as unknown as { api: unknown }).api = {
    design: {
      list: vi.fn(async () => []),
      create: created.mockImplementation(async () => ({
        id: 'd-1',
        name: 'Gol Shop',
        pages: [],
        edges: []
      })),
      get: vi.fn(async () => null),
      save: vi.fn(async (design: unknown) => design),
      remove: vi.fn(async () => true)
    },
    settings: { setApprovalMode: vi.fn(async (mode: string) => ({ approvalMode: mode })) }
  }
  useStore.setState({ designBusy: false, toasts: [] })
})

describe('DesignWizard (phase 0)', () => {
  it('walks five steps and sends the answers it displayed', async () => {
    const onDone = vi.fn()
    render(<DesignWizard onCancel={() => undefined} onDone={onDone} />)

    expect(screen.getByTestId('design-wizard')).toBeTruthy()
    // Step 1: default is "Website", press next.
    const next = (): void => {
      fireEvent.click(screen.getByRole('button', { name: i18n.t('design.next') }))
    }
    next()
    expect(screen.getByTestId('design-step-type')).toBeTruthy()
    // Step 2: choose "Corporate" explicitly (the labels are the product's own Persian copy).
    fireEvent.click(screen.getByRole('button', { name: 'شرکتی' }))
    next()
    expect(screen.getByTestId('design-step-needs')).toBeTruthy()
    // Contact is on by default; add the OTP login.
    fireEvent.click(screen.getByRole('checkbox', { name: /ورود با پیامک/ }))
    next()
    expect(screen.getByTestId('design-step-look')).toBeTruthy()
    next()
    expect(screen.getByTestId('design-step-name')).toBeTruthy()

    fireEvent.change(screen.getByLabelText(i18n.t('design.siteNameLabel')), {
      target: { value: 'Gol Shop' }
    })
    fireEvent.click(screen.getByTestId('design-finish'))

    await waitFor(() => expect(created).toHaveBeenCalledTimes(1))
    expect(created.mock.calls[0]?.[0]).toMatchObject({
      kind: 'website',
      type: 'corporate',
      siteName: 'Gol Shop',
      locale: 'fa',
      brand: 'blue',
      needs: ['contact', 'otp']
    })
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    cleanup()
  })

  it('cannot finish with an empty name', () => {
    render(<DesignWizard onCancel={() => undefined} onDone={() => undefined} />)
    const next = (): void => {
      fireEvent.click(screen.getByRole('button', { name: i18n.t('design.next') }))
    }
    next()
    next()
    next()
    next()

    expect((screen.getByTestId('design-finish') as HTMLButtonElement).disabled).toBe(true)
    cleanup()
  })
})
