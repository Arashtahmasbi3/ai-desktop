// @vitest-environment jsdom
/**
 * X9 — a tool card must not look successful when the command failed.
 *
 * Proven in the user's session log: every remote command rendered as a green `ok` card, and a
 * `grep` that returned exit code 2 was one of them — the model then reasoned from output that had
 * actually failed. The card trusted `ok` alone, so a result carrying a failed exit still got the
 * success treatment.
 *
 * The four states pinned here (see `lib/tool-outcome.ts`) are:
 *
 *   ok       exit 0, quiet stderr           -> success treatment, no marker
 *   warning  exit 0, something on stderr    -> still "ok", plus a stderr marker
 *   failed   non-zero exit, or ok === false -> failed wording, reason on the collapsed row
 *   blocked  refused before it ran          -> "blocked", never "error" or "failed"
 *
 * The keys these surfaces need ship as `_research/i18n/toolcard-en.json` / `-fa.json` and are merged
 * into en.json/fa.json separately, so they are installed here first. Assertions read state from
 * `data-testid`s and compare against `i18n.t(...)`, so they survive a copy change.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import ToolResultCard from '../../src/renderer/src/components/ToolResultCard'
import InlineTrace from '../../src/renderer/src/components/InlineTrace'
import { useStore } from '../../src/renderer/src/store'
import {
  firstLineOf,
  isSuccessOutcome,
  toolOutcome
} from '../../src/renderer/src/lib/tool-outcome'
import toolcardEn from '../../../i18n/toolcard-en.json'
import toolcardFa from '../../../i18n/toolcard-fa.json'

beforeAll(async () => {
  i18n.addResourceBundle('en', 'translation', toolcardEn, true, true)
  i18n.addResourceBundle('fa', 'translation', toolcardFa, true, true)
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  useStore.setState({ decisions: [], messages: [] })
})

afterEach(() => cleanup())

/** The state word the card renders, read from its own test id, never from copy. */
function stateWord(): string {
  return screen.getByTestId('tool-card-state').textContent ?? ''
}

describe('X9 — the card tells the truth about the outcome', () => {
  it('1. exit 0 keeps the success treatment and shows no marker', () => {
    render(
      <ToolResultCard
        name="remote_shell"
        ok
        command="df -h /opt"
        serverId="srv-1"
        stdout="/dev/sda1  40G  12G  26G  32% /"
        exitCode={0}
        durationMs={900}
      />
    )

    expect(stateWord()).toBe(i18n.t('chat.toolOk'))
    expect(screen.getByTestId('tool-card-state').className).toContain('text-success')
    expect(screen.getByTestId('tool-card-exit').textContent).toContain('exit 0')
    expect(screen.queryByTestId('tool-card-stderr')).toBeNull()
    expect(screen.queryByTestId('tool-card-outcome')).toBeNull()
  })

  it('2. a failed exit says so on the collapsed row: the code and the stderr line', () => {
    render(
      <ToolResultCard
        name="remote_shell"
        ok={false}
        command="npm test"
        serverId="srv-1"
        stdout="1 test failed"
        stderr={'npm ERR! code ELIFECYCLE\nnpm ERR! errno 1'}
        exitCode={1}
        durationMs={1200}
      />
    )

    expect(stateWord()).toBe(i18n.t('chat.toolError'))
    expect(screen.getByTestId('tool-card-state').className).toContain('text-danger')
    expect(screen.getByTestId('tool-card-exit').textContent).toContain('exit 1')
    const outcome = screen.getByTestId('tool-card-outcome')
    expect(outcome.textContent).toContain('npm ERR! code ELIFECYCLE')
    // One line only: the second stderr line stays in the body.
    expect(outcome.textContent).not.toContain('errno 1')
    expect(screen.getByTestId('tool-card-header').textContent ?? '').not.toMatch(/\bok\b/)
  })

  it('3. the logged bug: ok with a failed exit is not a success card', () => {
    render(
      <ToolResultCard
        name="remote_shell"
        ok
        command="grep -rn SEARCH /opt/sepehr-motor"
        serverId="srv-1"
        stderr="grep: /opt/sepehr-motor: Permission denied"
        exitCode={2}
        durationMs={41500}
      />
    )

    expect(stateWord()).toBe(i18n.t('chat.toolError'))
    expect(screen.getByTestId('tool-card-state').className).toContain('text-danger')
    expect(screen.getByTestId('tool-card-outcome').textContent).toContain(
      'grep: /opt/sepehr-motor: Permission denied'
    )
    expect(screen.getByTestId('tool-card-header').textContent ?? '').not.toMatch(/\bok\b/)
  })

  it('4. exit 0 with stderr keeps ok and adds a stderr marker', () => {
    render(
      <ToolResultCard
        name="remote_shell"
        ok
        command="git add -A"
        serverId="srv-1"
        exitCode={0}
        stderr="warning: LF will be replaced by CRLF"
      />
    )

    expect(stateWord()).toBe(i18n.t('chat.toolOk'))
    expect(screen.getByTestId('tool-card-state').className).toContain('text-success')
    const marker = screen.getByTestId('tool-card-stderr')
    expect(marker.textContent).toContain(i18n.t('chat.toolStderr'))
    expect(marker.className).toContain('text-warning')
  })

  it('5. an approval refusal reads as blocked, never as a failure', () => {
    render(
      <ToolResultCard
        name="remote_shell"
        ok={false}
        code="blocked"
        command="rm -rf /opt/sepehr-motor/tmp"
        serverId="srv-1"
        error='Action "remote_shell" was not approved by the user.'
      />
    )

    expect(stateWord()).toBe(i18n.t('chat.toolBlocked'))
    expect(screen.getByTestId('tool-card-state').className).toContain('text-warning')
    const header = screen.getByTestId('tool-card-header')
    expect(header.textContent ?? '').not.toContain(i18n.t('chat.toolError'))
    expect(header.textContent ?? '').not.toMatch(/\bfailed\b/)
    // The refusal is still readable in the opened body.
    expect(screen.getByTestId('tool-card-body').textContent).toContain(
      'was not approved by the user'
    )
  })

  it('6. the compact chip in the trace is not a green check for a failed exit', () => {
    useStore.setState({
      decisions: [
        {
          id: 'run-1:1',
          runId: 'run-1',
          phase: 'executing',
          intent: { summary: 'Step 1: search the project' },
          evidence: [],
          decision: 'remote_shell(grep)',
          outcome: 'ok',
          at: 1
        }
      ],
      messages: [
        {
          id: 'm1',
          role: 'tool',
          content: 'remote_shell',
          at: 1,
          runId: 'run-1',
          toolCall: { name: 'remote_shell', ok: true, exitCode: 2, stderr: 'grep: nope', step: 1 }
        }
      ]
    })

    render(<InlineTrace />)
    const chip = screen.getByTestId('trace-tool-chip')
    expect(chip.className).toContain('border-danger/40')
    expect(chip.querySelector('svg')?.getAttribute('class') ?? '').toContain('text-danger')
  })
})

describe('X9 — toolOutcome, the single source of the four states', () => {
  it('7. exit 0 is ok, exit 1 is failed, exit 0 with stderr is a warning', () => {
    expect(toolOutcome({ ok: true, exitCode: 0 })).toBe('ok')
    expect(toolOutcome({ ok: false, exitCode: 1 })).toBe('failed')
    expect(toolOutcome({ ok: true, exitCode: 0, stderr: 'warning: x' })).toBe('warning')
  })

  it('8. a non-zero exit outranks a true ok flag', () => {
    expect(toolOutcome({ ok: true, exitCode: 2 })).toBe('failed')
    expect(isSuccessOutcome('failed')).toBe(false)
    expect(isSuccessOutcome('ok')).toBe(true)
    expect(isSuccessOutcome('warning')).toBe(true)
  })

  it('9. blocked outranks failed, and firstLineOf keeps one line', () => {
    expect(toolOutcome({ ok: false, code: 'blocked', exitCode: 126 })).toBe('blocked')
    expect(toolOutcome({ ok: false, code: 'exit_nonzero', stderr: 'boom' })).toBe('failed')
    expect(firstLineOf('\n\nfirst line\nsecond line')).toBe('first line')
    expect(firstLineOf('   ')).toBeUndefined()
    expect(firstLineOf(undefined)).toBeUndefined()
  })
})
