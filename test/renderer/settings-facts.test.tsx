// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import SettingsMemory from '../../src/renderer/src/components/SettingsMemory'
import { useStore } from '../../src/renderer/src/store'
import { factDate, type LearnResultView, type ProjectFact } from '../../src/shared/memory-facts'

/**
 * Settings → Memory: the project fact ledger (v3.1).
 *
 * The whole point of a *ledger* rather than a notes file is the validity window, so these tests
 * protect two things the design depends on:
 *
 *  1. **A superseded fact stays visible, and looks superseded.** It is de-emphasised and carries
 *     the date it stopped being true, because "what the app used to believe" is exactly what
 *     makes the memory auditable instead of spooky. Deleting it from the view would produce a
 *     UI that agrees with the store while hiding its history.
 *  2. **A learn attempt is reported honestly.** "Nothing was learned" has three different causes
 *     (an empty chat, a model that found nothing, a provider failure) and none of them may be
 *     rendered as a cheerful success.
 */
beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

const DAY = 86_400_000
const NOW = Date.now()

function fact(over: Partial<ProjectFact> & { id: string; text: string }): ProjectFact {
  return {
    projectId: 'p1',
    validAt: NOW - 2 * DAY,
    createdAt: NOW - 2 * DAY,
    ...over
  }
}

/** A superseded belief and the fact that replaced it. `list()` returns them oldest first. */
const SUPERSEDED = fact({
  id: 'f-old',
  text: 'Staging used port 3001',
  validAt: NOW - 3 * DAY,
  createdAt: NOW - 3 * DAY,
  invalidAt: NOW - DAY
})
const LIVE = fact({
  id: 'f-live',
  text: 'The project targets Node 20',
  validAt: NOW - DAY,
  createdAt: NOW - DAY
})

let ledger: ProjectFact[] = [SUPERSEDED, LIVE]
let learnResult: LearnResultView = { learned: 2, superseded: 1 }

const listApi = vi.fn()
const learnApi = vi.fn()
const forgetApi = vi.fn()
const clearApi = vi.fn()

function installApi(): void {
  ;(window as unknown as { api: unknown }).api = {
    facts: { list: listApi, learn: learnApi, forget: forgetApi, clear: clearApi }
  }
}

beforeEach(() => {
  ledger = [SUPERSEDED, LIVE]
  learnResult = { learned: 2, superseded: 1 }
  listApi.mockReset().mockImplementation(async () => ledger)
  learnApi.mockReset().mockImplementation(async () => learnResult)
  forgetApi.mockReset().mockResolvedValue(true)
  clearApi.mockReset().mockResolvedValue(undefined)
  installApi()
  useStore.setState({
    messages: [],
    settings: { activeProjectId: 'p1', projects: [] } as never,
    activeChatId: 'chat-1'
  })
})

const learnButton = (): HTMLElement =>
  screen.getByRole('button', { name: i18n.t('settings.factsLearn') })

describe('Settings → Memory: the fact ledger (v3.1)', () => {
  it('1. lists every fact newest first, with the date each was observed', async () => {
    render(<SettingsMemory />)

    const rows = await screen.findAllByTestId('fact-row')
    expect(rows).toHaveLength(2)
    // The store hands facts back oldest first; the ledger reads downward in time.
    expect(rows[0]!.textContent).toContain(LIVE.text)
    expect(rows[1]!.textContent).toContain(SUPERSEDED.text)
    expect(screen.getByText(i18n.t('settings.factsObserved', { date: factDate(LIVE.validAt) }))).toBeTruthy()
    expect(
      screen.getByText(i18n.t('settings.factsObserved', { date: factDate(SUPERSEDED.validAt) }))
    ).toBeTruthy()
  })

  it('2. counts what is remembered and what was superseded', async () => {
    render(<SettingsMemory />)
    await screen.findAllByTestId('fact-row')

    expect(
      screen.getByText(i18n.t('settings.factsCount', { live: 1, superseded: 1 }))
    ).toBeTruthy()
  })

  it('3. keeps a superseded fact visible but de-emphasised, with the date it stopped being true', async () => {
    render(<SettingsMemory />)
    const rows = await screen.findAllByTestId('fact-row')
    const [liveRow, pastRow] = rows as [HTMLElement, HTMLElement]

    // The live belief is normal text and carries no badge.
    expect(liveRow.getAttribute('data-status')).toBe('live')
    expect(screen.getByText(LIVE.text).className).not.toContain('line-through')
    expect(within(liveRow).queryByText(i18n.t('settings.factsSuperseded'))).toBeNull()

    // The superseded one is still readable — that is the audit trail — but struck through,
    // muted, badged, and dated: "until <when>".
    expect(pastRow.getAttribute('data-status')).toBe('superseded')
    expect(screen.getByText(SUPERSEDED.text).className).toContain('line-through')
    expect(screen.getByText(SUPERSEDED.text).className).toContain('text-fg-subtle')
    expect(within(pastRow).getByText(i18n.t('settings.factsSuperseded'))).toBeTruthy()
    expect(
      within(pastRow).getByText(
        i18n.t('settings.factsUntil', { date: factDate(SUPERSEDED.invalidAt!) })
      )
    ).toBeTruthy()
  })

  it('4. says so plainly when there is nothing in the ledger yet', async () => {
    ledger = []
    render(<SettingsMemory />)

    await waitFor(() => expect(screen.getByText(i18n.t('settings.factsEmpty'))).toBeTruthy())
    expect(screen.queryByTestId('fact-row')).toBeNull()
  })

  it('5. learns from the ACTIVE chat and reports the real counts, then refreshes the list', async () => {
    render(<SettingsMemory />)
    await screen.findAllByTestId('fact-row')
    expect(listApi).toHaveBeenCalledTimes(1)

    fireEvent.click(learnButton())

    await waitFor(() => expect(learnApi).toHaveBeenCalledWith('chat-1'))
    await waitFor(() =>
      expect(
        screen.getByText(i18n.t('settings.factsLearned', { learned: 2, superseded: 1 }))
      ).toBeTruthy()
    )
    // The ledger is re-read after every mutation, so a new fact appears without a reload.
    await waitFor(() => expect(listApi).toHaveBeenCalledTimes(2))
  })

  it('6. refuses to learn without an active chat instead of guessing a session', async () => {
    useStore.setState({ activeChatId: null })
    render(<SettingsMemory />)
    await screen.findAllByTestId('fact-row')

    expect(learnButton().hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(i18n.t('settings.factsNoChat'))).toBeTruthy()
    fireEvent.click(learnButton())
    expect(learnApi).not.toHaveBeenCalled()
  })

  const skips: Array<[NonNullable<LearnResultView['skipped']>, string]> = [
    ['no-transcript', 'settings.factsSkippedNoTranscript'],
    ['no-facts', 'settings.factsSkippedNoFacts'],
    ['model-error', 'settings.factsSkippedModelError']
  ]

  for (const [reason, key] of skips) {
    it(`7. names the reason nothing was learned (${reason}) and never claims success`, async () => {
      learnResult =
        reason === 'model-error'
          ? { learned: 0, superseded: 0, skipped: reason, error: 'ECONNREFUSED 127.0.0.1' }
          : { learned: 0, superseded: 0, skipped: reason }
      render(<SettingsMemory />)
      await screen.findAllByTestId('fact-row')

      fireEvent.click(learnButton())

      await waitFor(() => expect(screen.getByText(i18n.t(key))).toBeTruthy())
      // Nothing learned must never render as "Learned 0, superseded 0".
      expect(screen.queryByText(/^Learned /)).toBeNull()

      if (reason === 'model-error') {
        // The provider's own message is surfaced, not swallowed.
        expect(
          screen.getByText(
            i18n.t('settings.factsErrorDetail', { message: 'ECONNREFUSED 127.0.0.1' })
          )
        ).toBeTruthy()
      }
    })
  }

  it('8. does not dress up a zero-count outcome without a skip reason', async () => {
    learnResult = { learned: 0, superseded: 1 }
    render(<SettingsMemory />)
    await screen.findAllByTestId('fact-row')

    fireEvent.click(learnButton())

    await waitFor(() =>
      expect(screen.getByText(i18n.t('settings.factsLearnedNone', { superseded: 1 }))).toBeTruthy()
    )
    expect(screen.queryByText(/^Learned /)).toBeNull()
  })

  it('9. forgets a single fact and re-reads the ledger', async () => {
    render(<SettingsMemory />)
    await screen.findAllByTestId('fact-row')

    const trash = screen.getAllByRole('button', { name: i18n.t('settings.factsForgetOne') })
    expect(trash).toHaveLength(2)
    fireEvent.click(trash[0]!)

    await waitFor(() => expect(forgetApi).toHaveBeenCalledWith(LIVE.id))
    await waitFor(() => expect(listApi).toHaveBeenCalledTimes(2))
  })

  it('10. forgets everything only after a confirming second click', async () => {
    render(<SettingsMemory />)
    await screen.findAllByTestId('fact-row')

    const first = screen.getByRole('button', { name: i18n.t('settings.factsForgetAll') })
    fireEvent.click(first)
    expect(clearApi).not.toHaveBeenCalled()
    const confirm = screen.getByRole('button', { name: i18n.t('settings.factsClearConfirm') })

    ledger = []
    fireEvent.click(confirm)

    await waitFor(() => expect(clearApi).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(listApi).toHaveBeenCalledTimes(2))
    // A wiped ledger says it is empty rather than showing the stale rows.
    await waitFor(() => expect(screen.getByText(i18n.t('settings.factsEmpty'))).toBeTruthy())
    expect(screen.queryByTestId('fact-row')).toBeNull()
  })

  it('11. surfaces a failing ledger read instead of an empty, confident list', async () => {
    listApi.mockReset().mockRejectedValue(new Error('EACCES facts/p1.json'))
    render(<SettingsMemory />)

    await waitFor(() =>
      expect(
        screen.getByText(
          i18n.t('settings.factsLoadError', { message: 'EACCES facts/p1.json' })
        )
      ).toBeTruthy()
    )
  })
})
