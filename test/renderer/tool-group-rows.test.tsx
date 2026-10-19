// @vitest-environment jsdom
/**
 * v4.3 — consecutive calls to the same tool collapse into one row.
 *
 * The complaint behind it: a run of four remote commands produced four almost identical cards,
 * each with its own "ok", exit chip and duration — a screen of output that said one thing four
 * times. The row now says it once (`4 commands on spmotor · 12.3s · all ok`) and expands to the
 * individual cards.
 *
 * The rule that matters most is the negative one: **a failed or blocked call is never folded into
 * an "all ok" group.** It stays its own row and ends the run, because a summary that hides a
 * failure is worse than the duplication it replaced.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import ChatPanel from '../../src/renderer/src/components/ChatPanel'
import ToolGroupRow from '../../src/renderer/src/components/ToolGroupRow'
import { useStore, type ChatMessage } from '../../src/renderer/src/store'
import { groupToolRows } from '../../src/renderer/src/lib/tool-rows'
import type { ToolCallView } from '@shared/ui'

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

function toolMessage(id: string, call: ToolCallView): ChatMessage {
  return { id, role: 'tool', content: call.name ?? 'tool', at: 1, toolCall: call }
}

function shellCall(over: Partial<ToolCallView> = {}): ToolCallView {
  return { name: 'remote_shell', ok: true, command: 'df -h', exitCode: 0, durationMs: 1000, ...over }
}

function textMessage(id: string, content = 'Done.'): ChatMessage {
  return { id, role: 'assistant', content, at: 1 }
}

describe('groupToolRows (the pure decision)', () => {
  it('1. collapses consecutive calls to the same tool, summing their measured time', () => {
    const rows = groupToolRows([
      toolMessage('a', shellCall({ command: 'port scan', durationMs: 4900 })),
      toolMessage('b', shellCall({ command: 'ip -6 addr', durationMs: 27800 })),
      toolMessage('c', shellCall({ command: 'grep', durationMs: 41500 })),
      toolMessage('d', shellCall({ command: 'ss -lntp', durationMs: 1200 }))
    ])

    expect(rows).toHaveLength(1)
    const row = rows[0]!
    expect(row.kind).toBe('group')
    if (row.kind !== 'group') return
    expect(row.tool).toBe('remote_shell')
    expect(row.messages).toHaveLength(4)
    expect(row.durationMs).toBe(75_400)
    expect(row.outcome).toBe('ok')
  })

  it('2. NEVER folds a failed call into the group — it keeps its own row', () => {
    const rows = groupToolRows([
      toolMessage('a', shellCall()),
      toolMessage('b', shellCall()),
      toolMessage('bad', shellCall({ ok: false, exitCode: 2, stderr: 'grep: Permission denied' })),
      toolMessage('c', shellCall()),
      toolMessage('d', shellCall())
    ])

    // ok, ok … failed … ok, ok: the failure splits the run into two groups and one own row.
    expect(rows.map((row) => row.kind)).toEqual(['group', 'message', 'group'])
    const failure = rows[1]!
    expect(failure.kind === 'message' && failure.message.id).toBe('bad')
    for (const row of rows) {
      if (row.kind === 'group') expect(row.outcome).toBe('ok')
    }
  })

  it('3. treats a blocked call the same way — a refusal is read, not counted', () => {
    const rows = groupToolRows([
      toolMessage('a', shellCall()),
      toolMessage('b', shellCall()),
      toolMessage('blocked', shellCall({ ok: false, code: 'blocked' }))
    ])
    expect(rows.map((row) => row.kind)).toEqual(['group', 'message'])
    expect(rows[1]!.kind === 'message' && rows[1]!.message.id).toBe('blocked')
  })

  it('4. a different tool, or a reply, breaks the run', () => {
    const rows = groupToolRows([
      toolMessage('a', shellCall()),
      toolMessage('b', shellCall()),
      toolMessage('read', { name: 'read_file', ok: true, path: '/tmp/a' }),
      textMessage('reply'),
      toolMessage('c', shellCall()),
      toolMessage('d', shellCall())
    ])
    expect(rows.map((row) => row.kind)).toEqual(['group', 'message', 'message', 'group'])
  })

  it('5. a single call stays an ordinary row — the card is not replaced by a summary of one', () => {
    const rows = groupToolRows([toolMessage('only', shellCall())])
    expect(rows).toHaveLength(1)
    expect(rows[0]!.kind).toBe('message')
  })

  it('6. marks a group as a warning when a call succeeded but wrote to stderr', () => {
    const rows = groupToolRows([
      toolMessage('a', shellCall()),
      toolMessage('b', shellCall({ stderr: 'warning: LF will be replaced by CRLF' }))
    ])
    expect(rows[0]!.kind).toBe('group')
    expect(rows[0]!.kind === 'group' && rows[0]!.outcome).toBe('warning')
  })
})

describe('ToolGroupRow (the row itself)', () => {
  it('7. is one collapsed line that expands to the individual cards', () => {
    const messages = [
      toolMessage('a', shellCall({ command: 'port scan' })),
      toolMessage('b', shellCall({ command: 'ip -6 addr' })),
      toolMessage('c', shellCall({ command: 'ls /opt' }))
    ]
    render(
      <ToolGroupRow tool="remote_shell" messages={messages} outcome="ok" durationMs={12_300} serverName="spmotor" />
    )

    const row = screen.getByTestId('tool-group-row')
    expect(row.getAttribute('data-count')).toBe('3')
    expect(row.getAttribute('data-outcome')).toBe('ok')
    // Collapsed: the summary only, no individual cards.
    expect(screen.queryByTestId('tool-card-header')).toBeNull()
    expect(screen.getByTestId('tool-group-duration').textContent).toContain('12.3s')
    expect(row.textContent).toContain('spmotor')

    const toggle = screen.getByTestId('tool-group-toggle')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)

    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByTestId('tool-group-list')).toBeTruthy()
    expect(screen.getAllByTestId('tool-card-header')).toHaveLength(3)
  })
})

describe('the transcript (ChatPanel)', () => {
  beforeEach(() => {
    ;(window as unknown as { api: unknown }).api = {
      agent: { explainStep: vi.fn().mockResolvedValue(null) },
      dialog: {
        pickDirectory: vi.fn().mockResolvedValue(null),
        pickFile: vi.fn().mockResolvedValue([])
      }
    }
    useStore.setState({
      messages: [],
      decisions: [],
      logs: [],
      running: false,
      settings: null,
      error: null,
      loopStop: null,
      warnings: [],
      showRawToolRows: false,
      vpsServers: []
    })
  })

  it('8. renders four consecutive commands as ONE row, not four cards', () => {
    useStore.setState({
      messages: [
        textMessage('reply', 'Running the checks.'),
        toolMessage('a', shellCall({ command: 'port scan' })),
        toolMessage('b', shellCall({ command: 'ip -6 addr' })),
        toolMessage('c', shellCall({ command: 'grep' })),
        toolMessage('d', shellCall({ command: 'ss -lntp' }))
      ]
    })
    render(<ChatPanel />)

    expect(screen.getAllByTestId('tool-group-row')).toHaveLength(1)
    expect(screen.getByTestId('tool-group-row').getAttribute('data-count')).toBe('4')
    expect(screen.queryAllByTestId('tool-card-header')).toHaveLength(0)
  })

  it('9. a run containing a failure shows the failure as its own row', () => {
    useStore.setState({
      messages: [
        toolMessage('a', shellCall()),
        toolMessage('b', shellCall()),
        toolMessage('bad', shellCall({ ok: false, exitCode: 2, stderr: 'boom' })),
        toolMessage('c', shellCall()),
        toolMessage('d', shellCall())
      ]
    })
    render(<ChatPanel />)

    // Two "all ok" groups and the failed card between them, opened by default so it is visible.
    expect(screen.getAllByTestId('tool-group-row')).toHaveLength(2)
    const failure = screen.getByTestId('tool-card-header')
    expect(failure.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByTestId('tool-card-state').textContent).toBe(i18n.t('chat.toolError'))
    // No group claims "all ok" while sitting next to an invisible failure.
    for (const row of screen.getAllByTestId('tool-group-row')) {
      expect(row.getAttribute('data-outcome')).toBe('ok')
    }
  })
})
