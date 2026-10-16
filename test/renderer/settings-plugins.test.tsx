// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import SettingsPlugins from '../../src/renderer/src/components/SettingsPlugins'
import { CATALOG } from '../../src/renderer/src/lib/catalog'
import {
  isCapabilityEnabled,
  OPTIONAL_CAPABILITIES,
  setCapabilityEnabled,
  type CapabilityId
} from '../../src/renderer/src/lib/capabilities'
import { useStore } from '../../src/renderer/src/store'

/**
 * Settings → Plugins: the page must not report a state change that never happens (v4.0).
 *
 * The old page rendered a switch for all seven catalogue entries and persisted them under
 * `plugins.enabled` — a key nothing else in the codebase read. Two things have to be true for the
 * page to be honest, and both are pinned here:
 *
 *  1. **An optional surface's switch is the real thing.** Flipping Browser must be readable back
 *     through `capabilities.ts`, which is what `Sidebar`/`ChatPanel` consult. A switch whose state
 *     lives only in component state is the original bug in a new costume.
 *  2. **A non-optional entry renders no switch at all.** DeepSeek is a provider, SSH/VPS is a
 *     connection, GitHub is an integration, Git is an operation set — the row is informational
 *     plus a way to the tab that owns it. A toggle there was the lie.
 */

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

/** The catalogue entries that are genuinely optional — the only rows allowed to have a switch. */
const OPTIONAL: CapabilityId[] = CATALOG.filter((entry) => entry.optional).map(
  (entry) => entry.capability as CapabilityId
)
const NOT_OPTIONAL = CATALOG.filter((entry) => !entry.optional)

const switches = (): HTMLElement[] => screen.queryAllByRole('switch')

/** The switch of one capability, located by its accessible name (the pattern the a11y tree uses). */
const switchFor = (id: CapabilityId): HTMLElement => {
  const label = i18n.t(`capabilities.${id}`)
  const found = switches().find((element) => element.getAttribute('aria-label') === label)
  if (!found) throw new Error(`no switch rendered for capability "${id}"`)
  return found
}

beforeEach(() => {
  localStorage.clear()
  // The "hide the surface" path is exercised by the other half of this feature; here it is a
  // stubbed boundary so a click cannot call into the real main process.
  ;(window as unknown as { api: unknown }).api = {
    settings: { set: vi.fn(async () => undefined) }
  }
  useStore.setState({ settingsOpen: false })
})

describe('Settings → Plugins: switches that mean something', () => {
  it('1. gives a switch to exactly the optional surfaces and to nothing else', () => {
    render(<SettingsPlugins />)
    fireEvent.click(screen.getByRole('tab', { name: i18n.t('settings.appsTab') }))

    const rows = screen.getAllByTestId('capability-row')
    expect(rows.map((row) => row.getAttribute('data-capability'))).toEqual(['browser', 'terminal'])
    // No informational row in this tab, and no switch beyond the two real ones.
    expect(switches()).toHaveLength(2)
    expect(OPTIONAL).toHaveLength(OPTIONAL_CAPABILITIES.length)
  })

  it('2. shows a previously hidden surface as OFF, and turning it on persists through capabilities.ts', () => {
    // Opting out *before* the render is the case that matters: a stored state the row ignores
    // would be the original bug wearing a new name.
    setCapabilityEnabled('browser', false)
    render(<SettingsPlugins />)
    fireEvent.click(screen.getByRole('tab', { name: i18n.t('settings.appsTab') }))

    const browser = within(screen.getAllByTestId('capability-row')[0] as HTMLElement).getByRole('switch')
    expect(browser.getAttribute('aria-checked')).toBe('false')

    fireEvent.click(browser)

    expect(switchFor('browser').getAttribute('aria-checked')).toBe('true')
    // The persisted state — not the rendered attribute — is what the rest of the app sees.
    expect(isCapabilityEnabled('browser')).toBe(true)
    expect(JSON.parse(localStorage.getItem('ai-desktop.capabilities.enabled') as string)).toMatchObject(
      { browser: true }
    )
  })

  it('3. persists the OFF state and reads it back from a fresh mount', () => {
    const first = render(<SettingsPlugins />)
    fireEvent.click(screen.getByRole('tab', { name: i18n.t('settings.mcpsTab') }))
    fireEvent.click(screen.getByRole('switch'))

    expect(isCapabilityEnabled('filesystem')).toBe(false)

    // A remount is what a settings page reopened, or an app restarted, looks like.
    first.unmount()
    render(<SettingsPlugins />)
    fireEvent.click(screen.getByRole('tab', { name: i18n.t('settings.mcpsTab') }))

    const reopened = screen.getByRole('switch')
    expect(reopened.getAttribute('aria-checked')).toBe('false')
    expect(isCapabilityEnabled('filesystem')).toBe(false)
  })

  it('4. defaults every optional surface to ON, and writes no preference until one is used', () => {
    for (const id of OPTIONAL) {
      expect(isCapabilityEnabled(id)).toBe(true)
    }
    render(<SettingsPlugins />)
    fireEvent.click(screen.getByRole('tab', { name: i18n.t('settings.appsTab') }))

    for (const element of switches()) {
      expect(element.getAttribute('aria-checked')).toBe('true')
    }
    // A user who upgrades must not acquire a preference just by opening the page.
    expect(localStorage.getItem('ai-desktop.capabilities.enabled')).toBeNull()
  })

  it('5. renders NO switch for DeepSeek — a provider is not an on/off surface', () => {
    render(<SettingsPlugins />)

    const deepseek = screen
      .getAllByTestId('catalog-row')
      .find((row) => row.textContent?.includes('DeepSeek'))
    expect(deepseek).toBeTruthy()
    expect(within(deepseek as HTMLElement).queryByRole('switch')).toBeNull()
    // It says where the provider is configured instead of offering a fake toggle.
    expect(
      within(deepseek as HTMLElement).getByTestId('catalog-status').textContent
    ).toBe(i18n.t('settings.catalogProviderStatus'))
    expect(within(deepseek as HTMLElement).getByRole('button').textContent).toContain(
      i18n.t('settings.pluginsConfigure')
    )
  })

  it('6. gives none of the four configured-elsewhere entries a switch, in any tab', () => {
    expect(NOT_OPTIONAL.map((entry) => entry.id).sort()).toEqual(
      ['deepseek', 'github', 'git', 'vps'].sort()
    )

    render(<SettingsPlugins />)
    for (const [tabKey, kind] of [
      ['settings.pluginsTab', 'plugin'],
      ['settings.mcpsTab', 'mcp']
    ] as const) {
      fireEvent.click(screen.getByRole('tab', { name: i18n.t(tabKey) }))

      const expected = NOT_OPTIONAL.filter((entry) => entry.kind === kind)
      expect(expected.length).toBeGreaterThan(0)
      for (const notOptional of expected) {
        const row = screen
          .getAllByTestId('catalog-row')
          .find((candidate) => candidate.textContent?.includes(notOptional.name))
        expect(row).toBeTruthy()
        expect(within(row as HTMLElement).queryByRole('switch')).toBeNull()
      }
      // Filesystem is the only switch-bearing row in the MCP tab; the Plugins tab has none at all.
      if (kind === 'mcp') expect(switches()).toHaveLength(1)
      if (kind === 'plugin') expect(switches()).toHaveLength(0)
    }

    // And no preference is ever written for something that is not a capability.
    expect(localStorage.getItem('ai-desktop.capabilities.enabled')).toBeNull()
  })

  it('7. says the switches hide a surface rather than uninstalling anything', () => {
    render(<SettingsPlugins />)
    expect(screen.getByText(i18n.t('settings.pluginsHint'))).toBeTruthy()
  })

  it('8. keeps the tabs, the search and the density', () => {
    render(<SettingsPlugins />)

    expect(screen.getAllByRole('tab')).toHaveLength(3)
    fireEvent.click(screen.getByRole('tab', { name: i18n.t('settings.appsTab') }))
    expect(screen.getAllByTestId('capability-row')).toHaveLength(2)

    const search = screen.getByPlaceholderText(i18n.t('settings.searchDirectory'))
    fireEvent.change(search, { target: { value: 'zzz' } })
    expect(screen.getByText(i18n.t('settings.noMatches'))).toBeTruthy()

    fireEvent.change(search, { target: { value: 'terminal' } })
    expect(screen.getAllByTestId('capability-row')).toHaveLength(1)
    expect(screen.getByRole('switch').getAttribute('aria-label')).toBe(
      i18n.t('capabilities.terminal')
    )
  })

  it('9. a non-optional row takes you to the tab it names, without inventing a switch', () => {
    /*
     * Updated in v4.0. The row used to call `openSettings`, which opened Settings on whatever tab
     * happened to be last — so a label reading "Configure … in Settings → Connections" was a promise
     * the interface did not keep. `openSettingsTab` closes that gap, and this case now pins the
     * stronger behaviour: the row must name its destination.
     */
    const openSettings = vi.fn()
    const openSettingsTab = vi.fn()
    useStore.setState({ openSettings, openSettingsTab })
    render(<SettingsPlugins />)

    const github = screen
      .getAllByTestId('catalog-row')
      .find((row) => row.textContent?.includes('GitHub'))
    fireEvent.click(within(github as HTMLElement).getByRole('button'))

    expect(openSettingsTab).toHaveBeenCalledTimes(1)
    // The exact destination, so a catalogue entry cannot silently point at the wrong section.
    // (GitHub has its own settings tab; this assertion caught my own first guess of 'connections'.)
    expect(openSettingsTab).toHaveBeenCalledWith('github')
    expect(openSettings).not.toHaveBeenCalled()
    expect(within(github as HTMLElement).queryByRole('switch')).toBeNull()
  })

  it('10. is translated in Persian, with the same switch semantics', async () => {
    await i18n.changeLanguage('fa')
    try {
      render(<SettingsPlugins />)
      fireEvent.click(screen.getByRole('tab', { name: i18n.t('settings.appsTab') }))

      const browser = screen.getAllByTestId('capability-row')[0] as HTMLElement
      expect(within(browser).getByText(i18n.t('capabilities.browser'))).toBeTruthy()
      expect(browser.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true')
    } finally {
      await i18n.changeLanguage('en')
    }
  })
})

/** Guard against the helper above silently matching nothing: a real switch must be findable. */
describe('Settings → Plugins: test helper sanity', () => {
  it('11. finds a switch by its capability label', () => {
    render(<SettingsPlugins />)
    fireEvent.click(screen.getByRole('tab', { name: i18n.t('settings.appsTab') }))
    expect(switchFor('browser')).toBeTruthy()
    expect(() => switchFor('filesystem')).toThrow()
  })
})
