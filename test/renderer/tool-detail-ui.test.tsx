// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import ToolResultCard from '../../src/renderer/src/components/ToolResultCard'
import { useStore } from '../../src/renderer/src/store'
import type { ToolResultView } from '../../src/shared/ui'

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(() => cleanup())

beforeEach(() => {
  useStore.setState({ messages: [], logs: [] })
})

function view(overrides: Partial<ToolResultView> = {}): ToolResultView {
  return {
    actionId: 'a1',
    name: 'run_command',
    ok: true,
    durationMs: 1500,
    attempts: 1,
    ...overrides
  }
}

describe('P3 ToolResultCard rich detail', () => {
  it('1. shows the command preview and exit code without expanding', () => {
    render(<ToolResultCard name="run_command" ok command="npm run build" exitCode={0} durationMs={1500} />)
    expect(screen.getByText('run_command')).toBeDefined()
    expect(screen.getByText('npm run build')).toBeDefined()
    expect(screen.getByText('exit 0')).toBeDefined()
    expect(screen.getByText('1.50s')).toBeDefined()
  })

  it('2. auto-expands a failed card and collapses it on click', () => {
    render(
      <ToolResultCard
        name="run_command"
        ok={false}
        command="npm test"
        serverId="srv-1"
        cwd="/srv/app"
        stdout="2 tests failed"
        stderr="Error: boom"
        exitCode={1}
        recovery={{ decision: 'stop', attempts: 1, recovered: false }}
      />
    )
    // v2.6.3 T1.3: errors open by default.
    expect(screen.getByText('2 tests failed')).toBeDefined()
    expect(screen.getByText('Error: boom')).toBeDefined()
    expect(screen.getByText('srv-1')).toBeDefined()
    expect(screen.getByText('/srv/app')).toBeDefined()
    expect(screen.getByText(/No automatic retry/)).toBeDefined()
    fireEvent.click(screen.getByRole('button'))
    expect(screen.queryByText('2 tests failed')).toBeNull()
  })

  it('3. shows the technical cause and a retry outcome for a failed card', () => {
    render(
      <ToolResultCard
        name="remote_shell"
        ok={false}
        command="systemctl restart app"
        serverId="prod"
        error="connection reset"
        recovery={{ decision: 'retry', attempts: 3, recovered: false }}
      />
    )
    expect(screen.getByText('connection reset')).toBeDefined()
    expect(screen.getByText(/Failed after 3 attempts/)).toBeDefined()
  })

  it('4. still renders a legacy detail-only card', () => {
    render(<ToolResultCard name="worktree_create" ok detail="Created worktree /srv/apps/x" />)
    expect(screen.queryByText('Created worktree /srv/apps/x')).toBeNull()
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('Created worktree /srv/apps/x')).toBeDefined()
  })
})

describe('P3 store maps tool:result events', () => {
  it('5. appends a tool message carrying the structured detail', () => {
    useStore.getState().applyEvent({
      type: 'tool:result',
      runId: 'r1',
      at: 123,
      result: view({ command: 'git status', serverId: 'srv-1', stdout: 'clean', exitCode: 0 })
    })
    const messages = useStore.getState().messages
    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('tool')
    expect(messages[0].toolCall).toMatchObject({
      name: 'run_command',
      ok: true,
      command: 'git status',
      serverId: 'srv-1',
      stdout: 'clean',
      exitCode: 0
    })
  })

  it('6. keeps action logs out of the chat (separation of concerns)', () => {
    useStore.getState().applyEvent({
      type: 'log',
      entry: {
        ts: '2026-01-01T00:00:00.000Z',
        level: 'info',
        runId: 'r1',
        event: 'action.ok',
        tool: 'read_file',
        message: 'ok'
      }
    })
    expect(useStore.getState().logs).toHaveLength(1)
    expect(useStore.getState().messages).toHaveLength(0)
  })
})
