import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentOrchestrator, type ProviderEntry } from '@core/agent-orchestrator'
import {
  ASK_USER_TOOL,
  MAX_QUESTION_OPTIONS,
  QUESTION_OPTION_RULE,
  parseQuestion
} from '@core/agent/question'
import { ScriptedAdapter, toolCall } from '../helpers/fake-adapter'
import { createLocalManager } from '../helpers/local-sandbox-manager'

/**
 * B2-5 — `ask_user` may carry 2–6 short suggested answers, which the card renders as
 * one-click buttons.
 *
 * The validation lives here, in core, not in the renderer: an option list that is too
 * long, blank or duplicated is refused with the reason *and the fix*, never silently
 * repaired. A silently trimmed list was worse than a visible error — the model would
 * read "the user picked X" for a set it had not designed, and the card would show fewer
 * buttons than the model believed it had offered.
 */

function entry(adapter: ScriptedAdapter): ProviderEntry {
  return {
    provider: adapter.provider,
    adapter,
    config: { apiKey: 'test-key', model: 'test-model' }
  }
}

function rejected(args: Record<string, unknown>): string {
  const parsed = parseQuestion(args)
  if (parsed.ok) throw new Error('expected ask_user to reject these arguments')
  return parsed.error
}

describe('parseQuestion — options (B2-5)', () => {
  it('accepts a closed set of options and trims each one', () => {
    expect(
      parseQuestion({ question: '  Which target?  ', options: [' staging ', 'production'] })
    ).toEqual({
      ok: true,
      question: { prompt: 'Which target?', options: ['staging', 'production'] }
    })
  })

  it('stays backward compatible: no options, undefined or an empty list are free text', () => {
    for (const args of [
      { question: 'Free text?' },
      { question: 'Free text?', options: undefined },
      { question: 'Free text?', options: null },
      { question: 'Free text?', options: [] }
    ]) {
      const parsed = parseQuestion(args as Record<string, unknown>)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) throw new Error('unreachable')
      expect(parsed.question).toEqual({ prompt: 'Free text?' })
    }
  })

  it('keeps `options` optional in the tool schema', () => {
    const parameters = ASK_USER_TOOL.parameters as {
      required: string[]
      properties: {
        question: { type: string }
        options: { type: string; items: { type: string }; maxItems: number; description: string }
      }
    }
    expect(parameters.required).toEqual(['question'])
    expect(parameters.properties.question.type).toBe('string')
    expect(parameters.properties.options.type).toBe('array')
    expect(parameters.properties.options.items.type).toBe('string')
    expect(parameters.properties.options.maxItems).toBe(MAX_QUESTION_OPTIONS)
    expect(parameters.properties.options.description).toMatch(/free-text/)
  })

  it('accepts exactly the maximum number of options', () => {
    const options = ['a', 'b', 'c', 'd', 'e', 'f']
    const parsed = parseQuestion({ question: 'Pick', options })
    expect(parsed).toEqual({ ok: true, question: { prompt: 'Pick', options } })
    expect(MAX_QUESTION_OPTIONS).toBe(6)
  })

  it('rejects more than the maximum instead of dropping the extras', () => {
    const error = rejected({
      question: 'Pick',
      options: ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    })
    expect(error).toMatch(/7 options/)
    expect(error).toMatch(/at most 6/)
    expect(error).toMatch(/free-text question/)
  })

  it('rejects an empty option instead of dropping it', () => {
    expect(rejected({ question: 'Pick', options: ['a', '   '] })).toMatch(
      /option 2 is empty/
    )
    expect(rejected({ question: 'Pick', options: [''] })).toMatch(/option 1 is empty/)
  })

  it('rejects a duplicated option and names it', () => {
    const error = rejected({ question: 'Pick', options: ['staging', 'staging'] })
    expect(error).toMatch(/repeats the option "staging"/)
    expect(error).toMatch(/unique/)
    expect(error).toMatch(/free-text question/)
  })

  it('rejects a non-string option instead of dropping it', () => {
    expect(rejected({ question: 'Pick', options: ['a', 3] })).toMatch(
      /option 2 is number, not a string/
    )
  })

  it('rejects options that are not an array', () => {
    expect(rejected({ question: 'Pick', options: 'a,b' })).toMatch(/must be an array/)
  })

  it('rejects a missing or blank question so the run never waits on nothing', () => {
    expect(rejected({})).toMatch(/non-empty "question"/)
    expect(rejected({ question: '   ' })).toMatch(/non-empty "question"/)
  })
})

describe('ask_user options in the run loop (B2-5)', () => {
  let base: string

  beforeEach(async () => {
    base = await fs.mkdtemp(join(tmpdir(), 'ask-user-options-'))
  })

  afterEach(async () => {
    await fs.rm(base, { recursive: true, force: true })
  })

  it('asks with the options and continues the SAME run with the answer', async () => {
    const manager = createLocalManager(base)
    const adapter = new ScriptedAdapter('deepseek', [
      {
        toolCalls: [
          toolCall('ask_user', {
            question: 'Which target?',
            options: ['staging', 'production']
          })
        ]
      },
      { content: 'deployed to staging' }
    ])
    const gate = vi.fn(async () => 'staging')
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      questionGate: gate
    })

    const result = await orchestrator.run('deploy')

    expect(gate).toHaveBeenCalledTimes(1)
    expect(gate).toHaveBeenCalledWith(
      { prompt: 'Which target?', options: ['staging', 'production'] },
      expect.objectContaining({ runId: expect.any(String) })
    )
    expect(JSON.stringify(adapter.calls[1]?.messages ?? [])).toContain(
      'The user answered: staging'
    )
    expect(result.status).toBe('completed')
    expect(result.steps).toHaveLength(2)
    await manager.dispose()
  })

  it('hands a malformed option list back to the model instead of asking, and keeps going', async () => {
    const manager = createLocalManager(base)
    const adapter = new ScriptedAdapter('deepseek', [
      {
        toolCalls: [
          toolCall('ask_user', {
            question: 'Which target?',
            options: ['staging', 'staging', 'production']
          })
        ]
      },
      { content: 'picked staging on my own' }
    ])
    const gate = vi.fn(async () => 'staging')
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      questionGate: gate
    })

    const result = await orchestrator.run('deploy')

    // The user never saw the broken card...
    expect(gate).not.toHaveBeenCalled()
    // ...the model heard exactly what was wrong and the way out...
    const secondCall = JSON.stringify(adapter.calls[1]?.messages ?? [])
    expect(secondCall).toContain('repeats the option')
    expect(secondCall).toContain('free-text question')
    expect(secondCall).toContain('invalid_arguments')
    // ...and the run carried on rather than ending or hanging.
    expect(result.status).toBe('completed')
    expect(result.steps).toHaveLength(2)
    await manager.dispose()
  })
})

describe('parseQuestion — an option is a button label, not an answer (X3)', () => {
  /**
   * The three options the model actually sent in the session behind the report, copied
   * verbatim from the stored session: 68, 83 and 48 characters, every one a full sentence
   * with an em dash. The chip truncated them mid-word and RTL reordering broke one into
   * fragments — which is why an option is now refused instead of squeezed into a chip.
   */
  const SESSION_OPTIONS = [
    "بله، در اپ دسکتاپ ترمینال yoserver را باز می‌کنم — دستور pull را بده",
    "می‌خواهم IP سرور مبدأ (91.107.174.210) را در پنل userver وایت‌لیست کنم — بعد تست کن",
    "دسکتاپم واقعاً وصل نیست، اشتباه شد — تیکت می‌زنم"
  ]

  it('refuses the three options the model actually sent, with the rule and the way out', () => {
    // The evidence, pinned: 48, 68 and 83 characters in the real session.
    expect(SESSION_OPTIONS.map((option) => option.length)).toEqual([68, 83, 48])
    for (const option of SESSION_OPTIONS) {
      const error = rejected({ question: 'Pick one', options: [option] })
      expect(error).toContain(QUESTION_OPTION_RULE)
      expect(error).toMatch(/button labels, not answers/)
      expect(error).toMatch(/\u22645 words and \u226432 characters/)
      expect(error).toContain("«وایت‌لیست می‌کنم»")
      expect(error).toMatch(/free-text question/)
    }
  })

  it('the rule names both limits and gives a real short example', () => {
    expect(QUESTION_OPTION_RULE).toMatch(/\u22645 words/)
    expect(QUESTION_OPTION_RULE).toMatch(/\u226432 characters/)
    expect(QUESTION_OPTION_RULE).toContain("«وایت‌لیست می‌کنم»")
  })

  it('names the rule that was broken: length, words, line break, dash', () => {
    expect(rejected({ question: 'q', options: ['this option is definitely much too long to fit'] })).toMatch(
      /is 46 characters long/
    )
    expect(rejected({ question: 'q', options: ['one two three four five six'] })).toMatch(/6 words/)
    expect(rejected({ question: 'q', options: ['line one\nline two'] })).toMatch(/line break/)
    expect(rejected({ question: 'q', options: ['do it \u2014 now'] })).toMatch(/em dash or en dash/)
    expect(rejected({ question: 'q', options: ['a \u2013 b'] })).toMatch(/em dash or en dash/)
  })

  it('still refuses a long session option when its em dash is taken out', () => {
    const withoutDash = SESSION_OPTIONS[1].replace(/\u2014/g, ',')
    const error = rejected({ question: 'Pick one', options: [withoutDash] })
    expect(error).toMatch(/characters long|5 words/)
  })

  it('accepts a set of short single-line labels', () => {
    const options = [
      "وایت‌لیست می‌کنم",
      "تیکت می‌زنم",
      "از کنسول pull",
      "بعداً ادامه بده"
    ]
    expect(parseQuestion({ question: '\u06a9\u062f\u0627\u0645\u061f', options })).toEqual({
      ok: true,
      question: { prompt: '\u06a9\u062f\u0627\u0645\u061f', options }
    })
  })

  it('counts characters, not UTF-16 code units, so the limit stays a label width', () => {
    // 17 emoji: 34 UTF-16 units but 17 characters on screen, so the label fits.
    const emoji = String.fromCodePoint(0x1f642).repeat(17)
    expect(parseQuestion({ question: 'q', options: [emoji] }).ok).toBe(true)
  })

  it('tells the model the rule in the schema, before it sends anything', () => {
    const parameters = ASK_USER_TOOL.parameters as {
      properties: { options: { description: string } }
    }
    const description = parameters.properties.options.description
    expect(description).toMatch(/at most 32 characters/)
    expect(description).toMatch(/at most 5 words/)
    expect(description).toMatch(/no em dash/)
  })
})
