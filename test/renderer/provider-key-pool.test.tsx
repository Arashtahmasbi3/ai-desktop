// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import ProvidersSection from '../../src/renderer/src/components/ProvidersSection'
import { useStore } from '../../src/renderer/src/store'
import type { ProviderId, ProviderKeyHealthView } from '../../src/shared/types'
import type { ProviderSettingsView, SettingsView } from '../../src/shared/ui'

/**
 * Settings → Providers: several API keys per provider (v3.1).
 *
 * The feature exists so a provider that rate-limits the app is not retried on the same credential
 * until the run dies. Three things must hold in the UI, and each one is a way this could go wrong:
 *
 *  1. **No key material is ever rendered.** There is no IPC path that returns a key, so there must
 *     be no path that displays one — the add field is a fresh password input, and the pool lists
 *     ids only.
 *  2. **The removal index is the row's position.** `removeApiKeyAt(provider, index)` removes by
 *     position, so an off-by-one deletes a *different* credential than the one the user clicked.
 *     The tests below assert exact numbers for that reason.
 *  3. **A cooling key is not shown as ready.** `keyHealth()` is the only source of pool state, and
 *     an empty answer is normal (no run has built a pool yet) — it must render nothing rather than
 *     "0 keys".
 */
beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

const MINUTE = 60_000

/** One provider's entry in the redacted settings view. `keyCount` is what v3.1 added. */
type ProviderView = ProviderSettingsView & { keyCount: number }

function providerView(hasApiKey: boolean, keyCount: number): ProviderView {
  return { hasApiKey, keyCount, model: 'm1' }
}

/** The settings view `window.api.settings.get()` answers with; a test may rewrite it mid-test. */
let settingsState: SettingsView

/** The pool states `keyHealth()` answers with. Empty until a run has built a pool. */
let healthState: ProviderKeyHealthView[]

const getApi = vi.fn()
const keyHealthApi = vi.fn()
const addApi = vi.fn()
const removeAtApi = vi.fn()

/** A view holding exactly one provider's pool size, as the backend builds it. */
function viewWith(provider: ProviderId, keyCount: number): SettingsView {
  return {
    providers: { [provider]: providerView(keyCount > 0, keyCount) },
    projects: []
  } as SettingsView
}

function installApi(): void {
  ;(window as unknown as { api: unknown }).api = {
    settings: {
      get: getApi,
      keyHealth: keyHealthApi,
      addApiKey: addApi,
      removeApiKeyAt: removeAtApi
    }
  }
}

beforeEach(() => {
  settingsState = viewWith('deepseek', 2)
  healthState = [
    {
      provider: 'deepseek',
      keys: [
        { id: 'deepseek:1', state: 'ready', failures: 0 },
        { id: 'deepseek:2', state: 'ready', failures: 0 }
      ]
    }
  ]

  getApi.mockReset().mockImplementation(async () => settingsState)
  keyHealthApi.mockReset().mockImplementation(async () => healthState)
  addApi.mockReset().mockImplementation(async (provider: ProviderId, key: string) => {
    void key
    settingsState = viewWith(provider, 3)
    healthState = [
      {
        provider,
        keys: [
          { id: `${provider}:1`, state: 'ready', failures: 0 },
          { id: `${provider}:2`, state: 'ready', failures: 0 },
          { id: `${provider}:3`, state: 'ready', failures: 0 }
        ]
      }
    ]
    return settingsState
  })
  removeAtApi.mockReset().mockImplementation(async (provider: ProviderId, index: number) => {
    // Remove for real, so a wrong index is visible in the re-read pool as well as in the call.
    const entry = healthState.find((item) => item.provider === provider)
    if (entry) entry.keys = entry.keys.filter((_, position) => position !== index)
    settingsState = viewWith(provider, entry?.keys.length ?? 0)
    return settingsState
  })

  installApi()
  useStore.setState({ settings: settingsState, customProviders: [] })
})

/** The deepseek card. Every provider is rendered, so queries are scoped to one of them. */
const card = (): HTMLElement => {
  const node = document.querySelector('[data-provider="deepseek"]')
  if (!node) throw new Error('deepseek card is not rendered')
  return node as HTMLElement
}

const addField = (): HTMLInputElement =>
  within(card()).getByPlaceholderText(
    i18n.t('settings.keysAddPlaceholder')
  ) as HTMLInputElement

const addButton = (): HTMLElement =>
  within(card()).getByRole('button', { name: i18n.t('settings.keysAdd') })

/** The pool rows, in render order — which is the order `keyHealth()` returned. */
const poolRows = (): HTMLElement[] => within(card()).queryAllByTestId('key-row-deepseek')

/** Waits for the first health read (and the settings read that follows a mutation) to land. */
const findPoolRows = async (count: number): Promise<HTMLElement[]> =>
  waitFor(() => {
    const rows = poolRows()
    expect(rows).toHaveLength(count)
    return rows
  })

/** The per-row remove controls, which carry the key's id — never the top-level "Remove" button. */
const rowRemovers = (): HTMLElement[] =>
  within(card()).getAllByRole('button', { name: /^Remove key / })

describe('Settings → Providers: the key pool (v3.1)', () => {
  it('1. states the pool size only when a provider holds more than one key', async () => {
    render(<ProvidersSection />)

    const rows = await findPoolRows(2)
    // Two keys: the badge says so next to the key field, in the deepseek card only.
    expect(within(card()).getByText(i18n.t('settings.keysPoolSize', { count: 2 }))).toBeTruthy()
    // The pool is listed per key, by id, in the order keyHealth() returned it.
    expect(rows.map((row) => row.getAttribute('data-key-id'))).toEqual([
      'deepseek:1',
      'deepseek:2'
    ])
    expect(rows[0]!.textContent).toContain('deepseek:1')
    expect(rows[0]!.textContent).toContain(i18n.t('settings.keysReady'))
  })

  it('2. adds another key, calls addApiKey with the typed value, and clears the field', async () => {
    render(<ProvidersSection />)
    await findPoolRows(2)

    fireEvent.change(addField(), { target: { value: 'sk-second-key' } })
    expect(addField().value).toBe('sk-second-key')

    fireEvent.click(addButton())

    await waitFor(() => expect(addApi).toHaveBeenCalledWith('deepseek', 'sk-second-key'))
    // Cleared after a successful add.
    await waitFor(() => expect(addField().value).toBe(''))
    // Both the settings view and the pool state are re-read after the mutation: the fresh view
    // carries the new pool size, and the health list the new key's state.
    await waitFor(() => expect(keyHealthApi).toHaveBeenCalledTimes(2))
    await findPoolRows(3)
    expect(within(card()).getByText(i18n.t('settings.keysPoolSize', { count: 3 }))).toBeTruthy()
  })

  it('3. removes the clicked row by ITS index — the second key is index 1, not 0', async () => {
    render(<ProvidersSection />)
    await findPoolRows(2)

    const removers = rowRemovers()
    expect(removers).toHaveLength(2)
    // Row order is the pool order, so the second row is the second credential.
    expect(poolRows()[1]!.getAttribute('data-key-id')).toBe('deepseek:2')

    fireEvent.click(removers[1]!)

    // An off-by-one here removes the wrong credential, so the exact number is the test.
    await waitFor(() => expect(removeAtApi).toHaveBeenCalledWith('deepseek', 1))
    expect(removeAtApi).toHaveBeenCalledTimes(1)
    // And the pool is re-read, leaving the key that was not clicked.
    const remaining = await findPoolRows(1)
    expect(remaining[0]!.getAttribute('data-key-id')).toBe('deepseek:1')
  })

  it('4. removes the first key as index 0, and never sends a key to the UI', async () => {
    render(<ProvidersSection />)
    await findPoolRows(2)

    fireEvent.click(rowRemovers()[0]!)

    await waitFor(() => expect(removeAtApi).toHaveBeenCalledWith('deepseek', 0))
    const remaining = await findPoolRows(1)
    expect(remaining[0]!.getAttribute('data-key-id')).toBe('deepseek:2')
    // The pool never renders anything secret: ids and states only, and the drafted key is not
    // echoed back after the mutation that consumed it.
    expect(screen.queryByText(/sk-/)).toBeNull()
    expect(addField().value).toBe('')
  })

  it('5. shows a cooling key as parked, with roughly how long is left', async () => {
    healthState = [
      {
        provider: 'deepseek',
        keys: [
          { id: 'deepseek:1', state: 'ready', failures: 0 },
          {
            id: 'deepseek:2',
            state: 'cooling',
            failures: 2,
            cooldownUntil: Date.now() + 4 * MINUTE
          }
        ]
      }
    ]
    render(<ProvidersSection />)

    const rows = await findPoolRows(2)
    const cooling = rows[1]!
    expect(cooling.getAttribute('data-key-state')).toBe('cooling')
    // A 4-minute wait is reported in minutes; it must not claim the key is fine.
    expect(within(cooling).getByText(/^cooling down — about \d+ min left$/)).toBeTruthy()
    expect(within(cooling).queryByText(i18n.t('settings.keysReady'))).toBeNull()
    // The failures that parked it are the honest context for that state.
    expect(within(cooling).getByText(i18n.t('settings.keysFailures', { count: 2 }))).toBeTruthy()
    // The ready key is untouched by its neighbour's cooldown.
    expect(within(rows[0]!).getByText(i18n.t('settings.keysReady'))).toBeTruthy()
  })

  it('6. says "cooling down" without inventing a duration when cooldownUntil is absent', async () => {
    healthState = [
      { provider: 'deepseek', keys: [{ id: 'deepseek:1', state: 'cooling', failures: 1 }] }
    ]
    render(<ProvidersSection />)

    const rows = await findPoolRows(1)
    expect(within(rows[0]!).getByText(i18n.t('settings.keysCooling'))).toBeTruthy()
    expect(rows[0]!.textContent).not.toContain('min left')
  })

  it('7. leaves a single-key provider looking exactly as it did before', async () => {
    // The store's view at mount: one key — the ordinary case, which renders no pool chrome.
    settingsState = viewWith('deepseek', 1)
    useStore.setState({ settings: settingsState, customProviders: [] })
    healthState = [
      { provider: 'deepseek', keys: [{ id: 'deepseek:1', state: 'ready', failures: 0 }] }
    ]
    render(<ProvidersSection />)

    await waitFor(() => expect(poolRows()).toHaveLength(1))
    // No pool size, no pool listing, no extra chrome.
    expect(within(card()).queryByText(i18n.t('settings.keysPoolSize', { count: 1 }))).toBeNull()
    expect(within(card()).queryByText(i18n.t('settings.keysPoolSize', { count: 2 }))).toBeNull()
    expect(within(card()).queryByText(i18n.t('settings.keysPoolTitle'))).toBeNull()
    // The existing affordances are unchanged.
    expect(within(card()).getByText(i18n.t('settings.keySaved'))).toBeTruthy()
    expect(within(card()).getByPlaceholderText(i18n.t('settings.apiKeyPlaceholder'))).toBeTruthy()
  })

  it('8. shows no pool state at all when no run has built one yet', async () => {
    // An empty health list is the normal startup answer, not "this provider has no keys".
    healthState = []
    render(<ProvidersSection />)

    await waitFor(() => expect(keyHealthApi).toHaveBeenCalledTimes(1))
    // Nothing in the pool was read or changed on mount, so no settings view is fetched either.
    expect(getApi).not.toHaveBeenCalled()
    expect(poolRows()).toHaveLength(0)
    expect(within(card()).queryByText(i18n.t('settings.keysPoolTitle'))).toBeNull()
    expect(screen.queryByText(/0 keys?/)).toBeNull()
    // The add affordance is still there, so the pool can be grown before any run.
    expect(addButton()).toBeTruthy()
  })

  it('9. reports a failed add instead of silently clearing the field', async () => {
    addApi.mockReset().mockRejectedValue(new Error('safeStorage unavailable'))
    render(<ProvidersSection />)
    await findPoolRows(2)

    fireEvent.change(addField(), { target: { value: 'sk-second-key' } })
    fireEvent.click(addButton())

    await waitFor(() =>
      expect(
        within(card()).getByText(
          i18n.t('settings.keysError', { message: 'safeStorage unavailable' })
        )
      ).toBeTruthy()
    )
    // The typed key is kept so the attempt can be retried.
    expect(addField().value).toBe('sk-second-key')
    // Nothing succeeded, so no additional settings round trip was made.
    expect(getApi).not.toHaveBeenCalled()
  })
})
