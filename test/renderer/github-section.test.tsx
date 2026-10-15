// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import GitHubSection from '../../src/renderer/src/components/GitHubSection'
import type { GitHubAuthStatus, GitHubCliStatus, GitHubDeviceCode } from '../../src/shared/github'

/**
 * v2.8.1 — Settings → GitHub, the reported "I cannot connect to GitHub and it is very hard
 * to connect to it".
 *
 * Three of the four verified causes are visible only in this panel, so they are pinned here:
 *  - the `gh` CLI login (already present on the reporting machine) is offered as one click;
 *  - `status.error` — a stored token that cannot be decrypted — is rendered instead of the
 *    panel claiming "Connected as @user" while every API call 401s;
 *  - the device code and link have working copy buttons (the section had none at all).
 */
beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

const CLI: GitHubCliStatus = {
  available: true,
  login: 'Arashtahmasbi3',
  host: 'github.com',
  scopes: ['read:org', 'repo'],
  version: '2.102.0'
}

const NO_CLI: GitHubCliStatus = { available: false, reason: 'not installed' }

function status(overrides: Partial<GitHubAuthStatus> = {}): GitHubAuthStatus {
  return { connected: false, ...overrides }
}

const DEVICE: GitHubDeviceCode = {
  deviceCode: 'dev-code',
  userCode: 'ABCD-1234',
  verificationUri: 'https://github.com/login/device',
  expiresIn: 900,
  interval: 5
}

interface Api {
  status: ReturnType<typeof vi.fn>
  detectCli: ReturnType<typeof vi.fn>
  connectCli: ReturnType<typeof vi.fn>
  setToken: ReturnType<typeof vi.fn>
  setClientId: ReturnType<typeof vi.fn>
  startAuth: ReturnType<typeof vi.fn>
  pollAuth: ReturnType<typeof vi.fn>
  logout: ReturnType<typeof vi.fn>
}

function api(overrides: Partial<Api> = {}): Api {
  const base: Api = {
    status: vi.fn(async () => status()),
    detectCli: vi.fn(async () => NO_CLI),
    connectCli: vi.fn(async () =>
      status({ connected: true, user: { login: 'Arashtahmasbi3' }, source: 'gh-cli' })
    ),
    setToken: vi.fn(async () => status({ connected: true, user: { login: 'ada' }, source: 'pat' })),
    setClientId: vi.fn(async () => status()),
    startAuth: vi.fn(async () => DEVICE),
    pollAuth: vi.fn(async () => ({ status: 'pending' as const })),
    logout: vi.fn(async () => status())
  }
  const merged = { ...base, ...overrides }
  ;(window as unknown as { api: unknown }).api = { github: merged }
  return merged
}

beforeEach(() => {
  // jsdom ships no clipboard; the copy buttons must work against an injected one.
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } })
})

describe('Settings → GitHub: the one-click CLI path (v2.8.1)', () => {
  it('detects the CLI login on mount and offers it as a primary card', async () => {
    const github = api({ detectCli: vi.fn(async () => CLI) })

    render(<GitHubSection />)

    await waitFor(() => expect(screen.getByTestId('github-cli-card')).toBeTruthy())
    expect(screen.getByTestId('github-cli-title').textContent).toContain('@Arashtahmasbi3')
    // The user should be told *why* this is one click, and which scopes come with it.
    expect(screen.getByTestId('github-cli-card').textContent).toContain('read:org, repo')
    expect(github.detectCli).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('github-use-cli').textContent).toContain('Use my GitHub CLI login')
  })

  it('connects with one click and shows the connected account via GitHub CLI', async () => {
    const github = api({ detectCli: vi.fn(async () => CLI) })
    render(<GitHubSection />)
    await waitFor(() => expect(screen.getByTestId('github-use-cli')).toBeTruthy())

    fireEvent.click(screen.getByTestId('github-use-cli'))

    await waitFor(() => expect(github.connectCli).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByTestId('github-connected')).toBeTruthy())
    expect(screen.getByTestId('github-connected').textContent).toContain('@Arashtahmasbi3')
    expect(screen.getByTestId('github-source').textContent).toBe('via GitHub CLI')
    // The CLI card is gone once connected, and the manual paths with it.
    expect(screen.queryByTestId('github-cli-card')).toBeNull()
    expect(screen.queryByTestId('github-other-ways')).toBeNull()
  })

  it('shows the red error box when the one-click path fails, and stays disconnected', async () => {
    api({
      detectCli: vi.fn(async () => CLI),
      connectCli: vi.fn(async () => {
        throw new Error('Could not read a token from the GitHub CLI (not installed).')
      })
    })
    render(<GitHubSection />)
    await waitFor(() => expect(screen.getByTestId('github-use-cli')).toBeTruthy())

    fireEvent.click(screen.getByTestId('github-use-cli'))

    await waitFor(() => expect(screen.getByTestId('github-error')).toBeTruthy())
    expect(screen.getByTestId('github-error').textContent).toContain('Could not read a token')
    expect(screen.queryByTestId('github-connected')).toBeNull()
    // The manual paths stay available so a CLI failure is not a dead end.
    expect(screen.getByTestId('github-other-ways')).toBeTruthy()
  })

  it('says when no CLI login was found instead of hiding the path', async () => {
    api({ detectCli: vi.fn(async () => ({ available: false, reason: 'not logged in' })) })

    render(<GitHubSection />)

    await waitFor(() => expect(screen.getByTestId('github-cli-reason')).toBeTruthy())
    expect(screen.getByTestId('github-cli-missing').textContent).toContain('not logged in')
    expect(screen.getByTestId('github-cli-missing').textContent).toContain('gh auth login')
    expect(screen.queryByTestId('github-cli-card')).toBeNull()
  })
})

describe('Settings → GitHub: the invisible error (v2.8.1)', () => {
  it('renders status.error instead of pretending to be connected', async () => {
    api({
      status: vi.fn(async () =>
        status({
          connected: true,
          user: { login: 'ada' },
          error:
            'Stored GitHub token could not be decrypted (the OS keyring may have changed). Sign in again.'
        })
      )
    })

    render(<GitHubSection />)

    await waitFor(() => expect(screen.getByTestId('github-status-error')).toBeTruthy())
    expect(screen.getByTestId('github-status-error').textContent).toContain('could not be decrypted')
    // This is the bug: the panel used to show "Connected as @ada" above it.
    expect(screen.queryByTestId('github-connected')).toBeNull()
    expect(screen.getByTestId('github-signin-again')).toBeTruthy()
  })

  it('labels the source honestly and never invents a token expiry', async () => {
    api({
      status: vi.fn(async () =>
        status({ connected: true, user: { login: 'octocat' }, source: 'device' })
      )
    })

    render(<GitHubSection />)

    await waitFor(() => expect(screen.getByTestId('github-connected')).toBeTruthy())
    expect(screen.getByTestId('github-source').textContent).toBe('via device flow')
    // GitHub reports no expiry per token, so the row says so rather than guessing a date.
    expect(screen.getByTestId('github-expiry').textContent).toContain('not reported by GitHub')
  })

  it('explains which connection method to choose, with the CLI recommended first', async () => {
    api({ detectCli: vi.fn(async () => NO_CLI) })

    render(<GitHubSection />)

    await waitFor(() => expect(screen.getByTestId('github-which')).toBeTruthy())
    const which = screen.getByTestId('github-which').textContent ?? ''
    expect(which).toContain('Which one do I choose?')
    expect(which).toContain('GitHub CLI — recommended')
    expect(which).toContain('Access token')
    expect(which).toContain('most steps')
    // The two manual paths live under an explicit heading, not as the default.
    expect(screen.getByTestId('github-other-ways').textContent).toBe('Other ways to connect')
  })

  it('disconnects only AI Desktop, and says so', async () => {
    const github = api({
      status: vi.fn(async () =>
        status({ connected: true, user: { login: 'octocat' }, source: 'gh-cli' })
      )
    })
    render(<GitHubSection />)
    await waitFor(() => expect(screen.getByTestId('github-disconnect')).toBeTruthy())

    expect(screen.getByTestId('github-disconnect').getAttribute('title')).toContain(
      'Your gh CLI login is left untouched'
    )
    fireEvent.click(screen.getByTestId('github-disconnect'))

    await waitFor(() => expect(github.logout).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByTestId('github-connected')).toBeNull())
  })
})

describe('Settings → GitHub: device flow copy buttons (v2.8.1)', () => {
  /** The device flow is the *second* tab on purpose: it is the path with the most steps. */
  async function openDeviceTab(): Promise<void> {
    render(<GitHubSection />)
    await waitFor(() => expect(screen.getByTestId('github-other-ways')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Device flow/i }))
    await waitFor(() => expect(screen.getByTestId('github-connect-device')).toBeTruthy())
  }

  it('copies the device code with a working button', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    api({ detectCli: vi.fn(async () => NO_CLI) })
    await openDeviceTab()

    fireEvent.click(screen.getByTestId('github-connect-device'))

    await waitFor(() => expect(screen.getByTestId('github-device-code')).toBeTruthy())
    expect(screen.getByTestId('github-device-code').textContent).toBe('ABCD-1234')
    // `expiresIn` is already parsed; the user must be told when the code dies.
    expect(screen.getByTestId('github-code-expiry').textContent).toContain('15 minutes')

    fireEvent.click(screen.getByTestId('github-copy-code'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('ABCD-1234'))
    await waitFor(() => expect(screen.getByTestId('github-notice')).toBeTruthy())
  })

  it('copies the verification URL', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    api({ detectCli: vi.fn(async () => NO_CLI) })
    await openDeviceTab()
    fireEvent.click(screen.getByTestId('github-connect-device'))
    await waitFor(() => expect(screen.getByTestId('github-copy-link')).toBeTruthy())

    fireEvent.click(screen.getByTestId('github-copy-link'))

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('https://github.com/login/device')
    )
  })

  it('falls back to the existing copyFailed message when the clipboard refuses', async () => {
    const writeText = vi.fn(async () => {
      throw new Error('clipboard unavailable')
    })
    Object.assign(navigator, { clipboard: { writeText } })
    api({ detectCli: vi.fn(async () => NO_CLI) })
    await openDeviceTab()
    fireEvent.click(screen.getByTestId('github-connect-device'))
    await waitFor(() => expect(screen.getByTestId('github-copy-code')).toBeTruthy())

    fireEvent.click(screen.getByTestId('github-copy-code'))

    // `settings.copyFailed` already existed; a failed copy must not throw or stay silent.
    await waitFor(() =>
      expect(screen.getByTestId('github-error').textContent).toContain(
        'Could not copy to the clipboard'
      )
    )
  })
})
