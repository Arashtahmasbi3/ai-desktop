// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import JobCard, { relativeTime } from '../../src/renderer/src/components/JobCard'
import type { Job } from '@shared/jobs'

const baseJob: Job = {
  id: 'abcdef1234567890',
  command: 'npm install',
  vpsId: 'vps1',
  status: 'running',
  strategy: 'tmux',
  startedAt: 1_000,
  output: '',
  sessionName: 'aidesk-abcdef12'
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

describe('JobCard', () => {
  it('renders the job id, command and status', () => {
    render(<JobCard job={baseJob} now={1_000} />)
    expect(screen.getByTestId('job-card-abcdef1234567890')).toBeTruthy()
    expect(screen.getByText(/\$ npm install/)).toBeTruthy()
    expect(screen.getByText(/#abcdef12/)).toBeTruthy()
  })

  it('toggles the log output', () => {
    render(<JobCard job={{ ...baseJob, output: 'line one' }} now={1_000} />)
    fireEvent.click(screen.getByRole('button', { name: /View log/ }))
    expect(screen.getByText('line one')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Hide log/ }))
    expect(screen.queryByText('line one')).toBeNull()
  })

  it('offers Kill while running and hides it once finished', () => {
    const { rerender } = render(<JobCard job={baseJob} now={1_000} onKill={() => undefined} />)
    expect(screen.getByRole('button', { name: /Kill/ })).toBeTruthy()
    rerender(<JobCard job={{ ...baseJob, status: 'completed' }} now={1_000} onKill={() => undefined} />)
    expect(screen.queryByRole('button', { name: /Kill/ })).toBeNull()
  })

  it('formats relative times', () => {
    const now = 10_000_000
    expect(relativeTime(now - 5_000, now)).toBe('5s')
    expect(relativeTime(now - 120_000, now)).toBe('2m')
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3h')
    expect(relativeTime(now + 5_000, now)).toBe('0s')
  })
})
