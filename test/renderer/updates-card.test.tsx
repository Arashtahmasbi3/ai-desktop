// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import UpdatesCard from '../../src/renderer/src/components/UpdatesCard'
import type { UpdateCheckResult, UpdateDownloadResult } from '../../src/shared/update'

/**
 * Settings → Developer: the update card (v3.0).
 *
 * The user's report was simply "no auto-update", and the app genuinely had no update path.
 * What these tests protect is the **honesty** of the states: an updater that answers "you are
 * up to date" when it could not reach the feed, or that offers an unverified binary without
 * saying so, is worse than one that does nothing.
 */
beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

const calls: string[] = []
let checkResult: UpdateCheckResult = {
  current: '3.0.0',
  latest: null,
  available: false
}
let downloadResult: UpdateDownloadResult = { ok: true, path: 'C:\\tmp\\setup.exe', verified: true }

function stub(): void {
  calls.length = 0
  ;(window as unknown as { api: unknown }).api = {
    updates: {
      check: vi.fn(async () => {
        calls.push('check')
        return checkResult
      }),
      download: vi.fn(async () => {
        calls.push('download')
        return downloadResult
      }),
      install: vi.fn(async () => {
        calls.push('install')
        return { ok: true }
      })
    }
  }
}

beforeEach(() => {
  stub()
})

describe('UpdatesCard (v3.0)', () => {
  it('says it has not checked yet, and fetches nothing on its own', () => {
    render(<UpdatesCard />)
    expect(screen.getByText(i18n.t('settings.updateNeverChecked'))).toBeTruthy()
    // The whole design is "nothing happens without a click".
    expect(calls).toEqual([])
  })

  it('reports being up to date when the feed answers with the current version', async () => {
    checkResult = { current: '3.0.0', latest: '3.0.0', available: false }
    render(<UpdatesCard />)

    fireEvent.click(screen.getByRole('button', { name: i18n.t('settings.updateCheck') }))

    await waitFor(() => expect(screen.getByText(/up to date/i)).toBeTruthy())
    // No download button for a version you already have.
    expect(screen.queryByRole('button', { name: /Download/ })).toBeNull()
  })

  it('offers the download when a newer version exists', async () => {
    checkResult = {
      current: '3.0.0',
      latest: '3.1.0',
      available: true,
      manifest: {
        version: '3.1.0',
        url: 'https://example.test/setup.exe',
        size: 112519897,
        notes: 'what changed',
        assets: []
      }
    }
    render(<UpdatesCard />)

    fireEvent.click(screen.getByRole('button', { name: i18n.t('settings.updateCheck') }))

    const download = await screen.findByRole('button', { name: /Download/ })
    expect(download.textContent).toContain('107 MB')
    expect(screen.getByText('what changed')).toBeTruthy()
  })

  it('explains an unreachable or private feed instead of claiming to be up to date', async () => {
    checkResult = {
      current: '3.0.0',
      latest: null,
      available: false,
      reason: 'no-release',
      message: 'The update feed has no published release yet (a private repository returns 404).'
    }
    render(<UpdatesCard />)

    fireEvent.click(screen.getByRole('button', { name: i18n.t('settings.updateCheck') }))

    await waitFor(() => expect(screen.getByText(/private repository returns 404/)).toBeTruthy())
  })

  it('shows the downloaded installer, then installs it', async () => {
    checkResult = {
      current: '3.0.0',
      latest: '3.1.0',
      available: true,
      manifest: { version: '3.1.0', url: 'https://example.test/setup.exe', assets: [] }
    }
    render(<UpdatesCard />)

    fireEvent.click(screen.getByRole('button', { name: i18n.t('settings.updateCheck') }))
    fireEvent.click(await screen.findByRole('button', { name: /Download/ }))

    await waitFor(() => expect(screen.getByText(i18n.t('settings.updateVerified'))).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: i18n.t('settings.updateInstall') }))
    await waitFor(() => expect(calls).toContain('install'))
  })

  it('says plainly when a download could not be verified', async () => {
    // A release that predates SHA256SUMS.txt is still offered, but never as "verified".
    downloadResult = { ok: true, path: 'C:\\tmp\\setup.exe', verified: false }
    checkResult = {
      current: '3.0.0',
      latest: '3.1.0',
      available: true,
      manifest: { version: '3.1.0', url: 'https://example.test/setup.exe', assets: [] }
    }
    render(<UpdatesCard />)

    fireEvent.click(screen.getByRole('button', { name: i18n.t('settings.updateCheck') }))
    fireEvent.click(await screen.findByRole('button', { name: /Download/ }))

    await waitFor(() => expect(screen.getByText(i18n.t('settings.updateUnverified'))).toBeTruthy())
  })

  it('surfaces a failed download instead of silently doing nothing', async () => {
    downloadResult = { ok: false, error: 'Checksum mismatch: expected abc, got def' }
    checkResult = {
      current: '3.0.0',
      latest: '3.1.0',
      available: true,
      manifest: { version: '3.1.0', url: 'https://example.test/setup.exe', assets: [] }
    }
    render(<UpdatesCard />)

    fireEvent.click(screen.getByRole('button', { name: i18n.t('settings.updateCheck') }))
    fireEvent.click(await screen.findByRole('button', { name: /Download/ }))

    await waitFor(() => expect(screen.getByText(/Checksum mismatch/)).toBeTruthy())
    expect(screen.queryByRole('button', { name: i18n.t('settings.updateInstall') })).toBeNull()
  })
})
