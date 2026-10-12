// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import JobsPanel from '../../src/renderer/src/components/JobsPanel'
import Sidebar from '../../src/renderer/src/components/Sidebar'
import { useStore } from '../../src/renderer/src/store'
import type { Job } from '@shared/jobs'

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    command: 'npm run build',
    vpsId: 'srv-1',
    status: 'running',
    strategy: 'tmux',
    startedAt: Date.now(),
    output: '',
    ...overrides
  }
}

function installApi(refresh: () => Promise<Job[]>): void {
  ;(window as unknown as { api: unknown }).api = {
    vps: { list: async () => [], status: async () => ({ status: 'disconnected' }) },
    chats: { list: async () => [] },
    jobs: { refresh, kill: vi.fn().mockResolvedValue(true) }
  }
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  installApi(async () => [])
  useStore.setState({
    jobs: [],
    jobsPanelOpen: false,
    showJobsPanelAlways: false,
    chats: [],
    worker: null,
    settings: null,
    sidebarCollapsed: false,
    view: 'chat'
  })
})

afterEach(cleanup)

/**
 * v2.6.2 T5.2 - the background jobs panel is collapsed by default and only
 * announces itself through a sidebar badge while a job is actually running.
 */
describe('v2.6.2 T5.2 - background jobs collapse', () => {
  it('1. stays hidden while idle, with no sidebar badge', () => {
    const panel = render(<JobsPanel />)
    expect(panel.queryByTestId('jobs-panel')).toBeNull()

    render(<Sidebar />)
    expect(screen.queryByTestId('sidebar-jobs-badge')).toBeNull()
  })

  it('2. shows a numeric badge for running jobs and opens the panel on click', () => {
    useStore.setState({ jobs: [job({ id: 'a' }), job({ id: 'b', status: 'pending' })] })
    render(<Sidebar />)

    const badge = screen.getByTestId('sidebar-jobs-badge')
    expect(badge.textContent).toBe('2')

    fireEvent.click(screen.getByTestId('sidebar-jobs-button'))
    expect(useStore.getState().jobsPanelOpen).toBe(true)
    expect(useStore.getState().view).toBe('chat')

    render(<JobsPanel />)
    expect(screen.getByTestId('jobs-panel')).toBeTruthy()
  })

  it('3. drops the badge once every job has finished', () => {
    useStore.setState({ jobs: [job({ id: 'done', status: 'completed' })] })
    render(<Sidebar />)
    expect(screen.queryByTestId('sidebar-jobs-badge')).toBeNull()
  })

  it('4. the always-on preference renders the panel even with no jobs', () => {
    useStore.setState({ showJobsPanelAlways: true })
    render(<JobsPanel />)
    expect(screen.getByTestId('jobs-panel')).toBeTruthy()
    expect(screen.getByText(/no background jobs/i)).toBeTruthy()
  })

  it('5. refreshJobs moves jobs into the store and toasts a completion once', async () => {
    installApi(async () => [job({ id: 'poll-1', status: 'running' })])
    await useStore.getState().refreshJobs()
    expect(useStore.getState().jobs).toHaveLength(1)

    installApi(async () => [job({ id: 'poll-1', status: 'completed' })])
    await useStore.getState().refreshJobs()
    const toasts = useStore.getState().toasts
    expect(toasts.at(-1)?.kind).toBe('success')

    // A second poll with the same status must not toast again.
    const before = useStore.getState().toasts.length
    await useStore.getState().refreshJobs()
    expect(useStore.getState().toasts.length).toBe(before)
  })
})
