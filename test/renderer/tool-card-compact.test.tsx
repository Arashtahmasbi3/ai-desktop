// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import ToolResultCard from '../../src/renderer/src/components/ToolResultCard'

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(() => cleanup())

/**
 * v2.6.0, C.1 - the tool card was "too busy" and its meta keys (exit code,
 * duration, status) disappeared on narrow widths. They now live in the single
 * header row: name + status on the left, truncating command in the middle, and
 * non-shrinking meta chips on the right.
 */
describe('v2.6.0 C.1 - compact tool card', () => {
  it('1. keeps name, status, command and all meta in one header row', () => {
    render(
      <ToolResultCard
        name="run_command"
        ok
        command="npm run build"
        exitCode={0}
        durationMs={1500}
      />
    )

    const header = screen.getByTestId('tool-card-header')
    expect(within(header).getByText('run_command')).toBeTruthy()
    expect(within(header).getByText('ok')).toBeTruthy()
    expect(within(header).getByText('npm run build')).toBeTruthy()
    expect(within(header).getByText('exit 0')).toBeTruthy()
    expect(within(header).getByText('1.50s')).toBeTruthy()
  })

  it('2. renders a single row while collapsed (no duplicated preview row)', () => {
    render(
      <ToolResultCard name="run_command" ok command="npm run build" stdout="built" exitCode={0} />
    )
    const card = screen.getByTestId('tool-card-header').parentElement!
    expect(card.children).toHaveLength(1)
  })

  it('3. truncates a long command instead of pushing meta off-screen', () => {
    const long = 'npm run a-very-long-task-name --with flags and more flags'
    render(<ToolResultCard name="run_command" ok command={long} exitCode={0} durationMs={10} />)

    const command = screen.getByText(long)
    expect(command.className).toContain('truncate')
    expect(command.getAttribute('title')).toBe(long)
    expect(command.className).toContain('flex-1')
    // The meta chips must not shrink away when the command is long.
    expect(screen.getByText('exit 0').className).toContain('shrink-0')
    expect(screen.getByText('0.01s').className).toContain('shrink-0')
  })

  it('4. expanding still reveals the raw output and keeps the header intact', () => {
    render(
      <ToolResultCard name="run_command" ok command="npm test" stdout="2 passed" stderr="" />
    )
    fireEvent.click(screen.getByTestId('tool-card-header'))
    expect(screen.getByText('2 passed')).toBeTruthy()
    expect(screen.getByText('npm test')).toBeTruthy()
    expect(screen.getByTestId('tool-card-header').getAttribute('aria-expanded')).toBe('true')
  })
})
