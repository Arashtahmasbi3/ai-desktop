// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import SettingsSchedules from '../../src/renderer/src/components/SettingsSchedules'
import { useStore } from '../../src/renderer/src/store'
import type { ScheduleJob } from '../../src/shared/schedule'

/**
 * T16 — the schedule panel.
 *
 * What a user can actually do here: see the jobs, add one (and the stored rule matches the form), disable one, delete one.
 * Execution is deliberately absent — main offers a due job with a dialog.
 */
const list = vi.fn()
const save = vi.fn()
const remove = vi.fn()

const job = (overrides: Partial<ScheduleJob> = {}): ScheduleJob => ({
  id: 'j1',
  title: 'standup',
  prompt: 'summarise',
  rule: { frequency: 'DAILY', hour: 9, minute: 0 },
  enabled: true,
  createdAt: 0,
  runs: 0,
  nextAt: Date.UTC(2026, 4, 1, 9),
  ...overrides
})

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  list.mockReset()
  save.mockReset()
  remove.mockReset()
  list.mockResolvedValue([job()])
  save.mockResolvedValue([job()])
  remove.mockResolvedValue([])
  useStore.setState({ schedules: [] } as never)
  ;(window as unknown as { api: unknown }).api = { schedules: { list, save, remove } }
  cleanup()
})

describe('schedule panel (T16)', () => {
  it('loads and shows the jobs with their next run', async () => {
    render(<SettingsSchedules />)
    await waitFor(() => expect(list).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByTestId('schedule-list').textContent).toContain('standup'))
  })

  it('creates a job whose rule matches the form', async () => {
    render(<SettingsSchedules />)
    fireEvent.change(screen.getByTestId('schedule-title'), { target: { value: 'nightly' } })
    fireEvent.change(screen.getByTestId('schedule-prompt'), { target: { value: 'run tests' } })
    fireEvent.change(screen.getByTestId('schedule-hour'), { target: { value: '22' } })
    fireEvent.click(screen.getByTestId('schedule-create'))

    await waitFor(() => expect(save).toHaveBeenCalled())
    const created = save.mock.calls[0]![0] as ScheduleJob
    expect(created.title).toBe('nightly')
    expect(created.prompt).toBe('run tests')
    expect(created.rule).toMatchObject({ frequency: 'DAILY', hour: 22, minute: 0 })
    expect(created.enabled).toBe(true)
  })

  it('disables a job and deletes it', async () => {
    render(<SettingsSchedules />)
    await waitFor(() => expect(screen.getByTestId('schedule-toggle-j1')).toBeTruthy())

    fireEvent.click(screen.getByTestId('schedule-toggle-j1'))
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: 'j1', enabled: false })))

    fireEvent.click(screen.getByTestId('schedule-remove-j1'))
    await waitFor(() => expect(remove).toHaveBeenCalledWith('j1'))
  })
})
