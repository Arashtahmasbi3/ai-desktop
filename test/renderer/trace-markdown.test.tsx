// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import InlineTrace from '../../src/renderer/src/components/InlineTrace'
import DecisionCard from '../../src/renderer/src/components/DecisionCard'
import { useStore } from '../../src/renderer/src/store'
import type { TraceDecision } from '../../src/shared/trace'

/**
 * Item 7 — the execution trace printed the model's own reasoning as raw markdown.
 *
 * A real run's screenshot showed a trace row reading, literally:
 *
 *     ## وضعیت در Settings | 'yoserver-spmotor' = «نتایج | بررسی | شواهد: ❌ **متوقف شد** — انتقال مرحله ۱
 *
 * The trace rendered `thought`, `reflection` and `reasoning` as text nodes, so the markers were
 * displayed instead of being parsed. `MessageBubble` already had the pipeline (`react-markdown`
 * plus a component map); the trace now goes through the *same* map — see `components/Markdown.tsx`.
 *
 * Two rules are pinned here, because either one alone would be a half-fix:
 *  - the markers must be *parsed* (a real `<h2>` / `<strong>` exists, and no literal `##`/`**`
 *    is left in the document), and
 *  - the row must stay a row: the collapsed preview renders inline (`truncate` survives), while
 *    the expanded body and the reasoning block get the full block rendering.
 */
const PROSE = ['## وضعیت در Settings', '', '«yoserver-spmotor» = **متوقف شد** — انتقال مرحله ۱'].join(
  '\n'
)

function decision(over: Partial<TraceDecision> = {}): TraceDecision {
  return {
    id: 'run-1:1',
    runId: 'run-1',
    phase: 'executing',
    intent: { summary: 'checking' },
    evidence: [],
    decision: 'read_file(a.ts)',
    outcome: 'ok',
    at: 1,
    ...over
  }
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {}
  useStore.setState({
    decisions: [],
    messages: [],
    logs: [],
    changedFiles: [],
    reasoningByStep: {}
  })
})

describe('Item 7 — the trace renders model prose as markdown', () => {
  it('1. the reasoning block renders a heading and bold text, not their markers', () => {
    useStore.setState({
      decisions: [decision()],
      reasoningByStep: { 'run-1:1': PROSE }
    })
    render(<InlineTrace />)

    // The existing `trace-reasoning` row, which used to hold one plain-text `<p>`.
    const row = screen.getByTestId('trace-reasoning')
    // The prose is *parsed*: the words the model wrote exist as elements, not as punctuation.
    expect(row.querySelector('h2')).toBeTruthy()
    expect(row.querySelector('strong')).toBeTruthy()
    expect(row.textContent).toContain('متوقف شد')
    // And nothing on the page shows the source markup any more.
    const body = document.body.textContent ?? ''
    expect(body).not.toContain('##')
    expect(body).not.toContain('**')
  })

  it('2. the step row renders its own markers away and still stays a single clipped row', () => {
    useStore.setState({ decisions: [decision({ intent: { summary: '## بررسی **فایل**' } })] })
    render(<InlineTrace />)

    const card = screen.getByTestId('decision-card')
    expect(card.querySelector('h2')).toBeTruthy()
    expect(card.querySelector('strong')).toBeTruthy()

    const body = document.body.textContent ?? ''
    expect(body).not.toContain('##')
    expect(body).not.toContain('**')

    // Compact, not a document: the one-line previews are still one truncating line.
    expect(screen.getByTestId('decision-summary').className).toContain('truncate')
    expect(screen.getByTestId('trace-latest').className).toContain('truncate')
  })

  it('3. the expanded body renders its prose as markdown but leaves tool names plain', () => {
    const step = decision({
      intent: { summary: 'بررسی فایل', rationale: 'چون **پورت** عوض شد' },
      decision: 'read_file(a.ts)'
    })
    render(<DecisionCard decision={step} />)

    fireEvent.click(screen.getByText('بررسی فایل'))

    expect(document.querySelector('strong')).toBeTruthy()
    expect(document.body.textContent ?? '').not.toContain('**')
    expect(screen.getByTestId('decision-body').querySelector('strong')).toBeTruthy()

    /*
     * The decision line is data — tool ids and paths — so it must not be fed to the parser:
     * `read_file` inside a paragraph is one underscore away from rendering as emphasis.
     */
    const call = screen.getByText('read_file(a.ts)')
    expect(call.tagName).toBe('P')
    expect(call.querySelector('strong')).toBeNull()
    expect(call.querySelector('code')).toBeNull()
  })

  it('4. a trace without prose markers is unchanged text', () => {
    useStore.setState({
      decisions: [decision({ intent: { summary: 'inspect the config' } })],
      reasoningByStep: { 'run-1:1': 'I should read the config first.' }
    })
    render(<InlineTrace />)

    expect(screen.getByTestId('trace-reasoning-text').textContent).toContain(
      'I should read the config first.'
    )
    expect(screen.getByTestId('decision-summary').textContent).toContain('inspect the config')
  })
})
