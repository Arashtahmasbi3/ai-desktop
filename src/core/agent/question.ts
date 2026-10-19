import type { ToolDefinition } from '@shared/types'

/**
 * `ask_user` — let the model ask a question *during* a run (v2.8.0).
 *
 * Reported: "when working on a project, the assistant should ask me questions on the
 * spot like you do, and keep going — not stop completely."
 *
 * Before this, the model's only way to ask was to end its turn with no tool calls,
 * which finishes the run: the answer arrived as a brand-new run with a fresh step
 * budget and a destroyed sandbox. There was no question primitive at all —
 * `SANDBOX_TOOLS` was four file/shell tools and `AgentEvent` had no question member.
 *
 * The tool is handled by the orchestrator itself (never by a sandbox executor): it
 * awaits the renderer's answer, appends it as the tool's result, and continues the
 * same run — same sandbox, same loop budget, same context.
 */

/**
 * B2-5: the model may suggest answers, and the card renders them as buttons.
 *
 * Six is the most that stays a shortcut rather than a menu, and it is enforced in
 * {@link parseQuestion} — not in the renderer, because a silently trimmed list would
 * leave the model believing it offered a choice the user never saw.
 */
export const MAX_QUESTION_OPTIONS = 6

/**
 * X3: an option is a button label, not an answer.
 *
 * The three options the model sent in the session log behind the report were 68, 83 and
 * 48 characters — full sentences, each with an em dash. The chip truncated them mid-word
 * and RTL reordering turned one into fragments. A chip is a shortcut, so the shape is
 * enforced here, before the card ever sees it: one line, at most 32 characters and at most
 * 5 words, and no em/en dash (the tell-tale of a sentence squeezed into a chip).
 */
export const MAX_QUESTION_OPTION_CHARS = 32
export const MAX_QUESTION_OPTION_WORDS = 5

/**
 * The rule every option refusal ends with.
 *
 * It names the rule, both limits and a real short example, because a refusal is a
 * correction: the model has to be able to fix it on the next call without guessing.
 */
export const QUESTION_OPTION_RULE =
  'Options are button labels, not answers: use ≤5 words and ≤32 characters, e.g. «وایت‌لیست می‌کنم».'

export const ASK_USER_TOOL: ToolDefinition = {
  name: 'ask_user',
  description:
    'Ask the user a question and continue the same run with their answer. Use it when a ' +
    'choice genuinely changes what you do next: which of several matching targets to use, ' +
    'which approach to take, or a missing value only the user knows. Prefer asking once, ' +
    'with concrete options, over guessing. Do not use it to ask for permission to run a ' +
    'tool — the approval flow already handles that.',
  parameters: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'The question, in the language the user is writing in.'
      },
      options: {
        type: 'array',
        items: { type: 'string' },
        maxItems: MAX_QUESTION_OPTIONS,
        description:
          'Optional 2 to 6 suggested answers, when the choice is closed. Each one is a button ' +
          'label, not an answer: at most 32 characters, one line, at most 5 words, and no em ' +
          'dash (—) or en dash (–). They become one-click buttons, and the user may still type ' +
          'their own answer instead. Omit the field (or pass an empty list) to ask a free-text ' +
          'question. An option that breaks these limits is refused, never trimmed.'
      }
    },
    required: ['question'],
    additionalProperties: false
  }
}

/** What the orchestrator hands to its injected question gate. */
export interface AgentQuestion {
  prompt: string
  options?: string[]
}

/**
 * What the gate can report back (X2).
 *
 * `string` is the user's answer and `null` is an explicit "you decide" — both continue the
 * same run. `{ abandoned }` is the deadlock guard: nobody answered within the configured
 * ceiling (a closed window, a headless worker, a harness with no answerer), so the run
 * **ends** with that reason instead of parking forever. It is not a third kind of answer,
 * and it never lets a step run: no tool has executed while the question was open.
 */
export type AskUserAnswer = string | null | { abandoned: string }

/** True when the gate reported the deadlock guard rather than an answer. */
export function isAbandonedAnswer(answer: AskUserAnswer): answer is { abandoned: string } {
  return typeof answer === 'object' && answer !== null && 'abandoned' in answer
}

/**
 * The result of reading a tool call: a question to ask, or a correction for the model.
 *
 * B2-5: every malformed option list is refused with the reason and the fix, never
 * repaired behind the model's back. Dropping a blank entry or the seventh option
 * produced a card that showed fewer buttons than the model thought it had offered,
 * and the model then read "the user picked X" for a set it had not designed.
 */
export type ParsedQuestion = { ok: true; question: AgentQuestion } | { ok: false; error: string }

/** Appended to every option error, so the model always has the way out. */
const FREE_TEXT_HINT = 'Send no "options" (or an empty list) for a free-text question.'

function describeType(value: unknown): string {
  if (value === null) return 'null'
  return Array.isArray(value) ? 'an array' : typeof value
}

/**
 * X3: one refusal shape for every option-shape violation, so the model always gets the
 * reason, the rule and the example in the same order — and always the way out.
 */
function optionShapeError(index: number, detail: string): string {
  return (
    'ask_user option ' +
    (index + 1) +
    ' ' +
    detail +
    '. ' +
    QUESTION_OPTION_RULE +
    ' ' +
    FREE_TEXT_HINT
  )
}

/** Characters, not UTF-16 code units, so an emoji costs one character and not two. */
function optionLength(text: string): number {
  return Array.from(text).length
}

/** Whitespace-separated words; an RTL label splits on spaces exactly like an LTR one. */
function optionWordCount(text: string): number {
  return text.split(/\s+/).filter((word) => word !== '').length
}

/**
 * Read the question out of a tool call, validating the optional options list.
 *
 * `options` absent, `null` or `[]` means today's free-text question — behaviour that
 * must not change, so the field stays optional in the schema and in the payload.
 */
export function parseQuestion(args: Record<string, unknown>): ParsedQuestion {
  const prompt = typeof args.question === 'string' ? args.question.trim() : ''
  if (!prompt) {
    return {
      ok: false,
      error:
        'ask_user needs a non-empty "question" string, written in the language the user is using.'
    }
  }

  const raw = args.options
  if (raw === undefined || raw === null) return { ok: true, question: { prompt } }
  if (!Array.isArray(raw)) {
    return {
      ok: false,
      error:
        '"options" must be an array of short strings, but it was ' +
        describeType(raw) +
        '. ' +
        FREE_TEXT_HINT
    }
  }
  if (raw.length === 0) return { ok: true, question: { prompt } }
  if (raw.length > MAX_QUESTION_OPTIONS) {
    return {
      ok: false,
      error:
        'ask_user got ' +
        raw.length +
        ' options; at most ' +
        MAX_QUESTION_OPTIONS +
        ' fit on the card. Keep the ' +
        MAX_QUESTION_OPTIONS +
        ' most likely answers, or ask a free-text question. ' +
        FREE_TEXT_HINT
    }
  }

  const options: string[] = []
  const seen = new Set<string>()
  for (let index = 0; index < raw.length; index += 1) {
    const value: unknown = raw[index]
    if (typeof value !== 'string') {
      return {
        ok: false,
        error:
          'ask_user option ' +
          (index + 1) +
          ' is ' +
          describeType(value) +
          ', not a string. Every option must be a short string. ' +
          FREE_TEXT_HINT
      }
    }
    const text = value.trim()
    if (text === '') {
      return {
        ok: false,
        error:
          'ask_user option ' +
          (index + 1) +
          ' is empty. Every option must be a non-empty short string. ' +
          FREE_TEXT_HINT
      }
    }
    /*
     * X3: an option is a button label. Shape comes before uniqueness — a duplicated
     * 83-character sentence is first of all too long, and that is the correction the model
     * needs to hear. Every refusal names the broken rule and the fix.
     */
    if (text.includes('\n') || text.includes('\r')) {
      return {
        ok: false,
        error: optionShapeError(index, 'contains a line break; a button label is one line')
      }
    }
    if (text.includes('\u2014') || text.includes('\u2013')) {
      return {
        ok: false,
        error: optionShapeError(
          index,
          'contains an em dash or en dash (\u2014 or \u2013); that is how a whole sentence gets ' +
            'squeezed into a chip'
        )
      }
    }
    if (optionLength(text) > MAX_QUESTION_OPTION_CHARS) {
      return {
        ok: false,
        error: optionShapeError(
          index,
          'is ' +
            optionLength(text) +
            ' characters long, and the limit is ' +
            MAX_QUESTION_OPTION_CHARS
        )
      }
    }
    if (optionWordCount(text) > MAX_QUESTION_OPTION_WORDS) {
      return {
        ok: false,
        error: optionShapeError(
          index,
          'has ' +
            optionWordCount(text) +
            ' words, and the limit is ' +
            MAX_QUESTION_OPTION_WORDS
        )
      }
    }
    // Compared after trimming, case-sensitively: the labels are buttons, so two
    // byte-identical entries are indistinguishable, while "Start" and "start" are
    // different answers the user can tell apart.
    if (seen.has(text)) {
      return {
        ok: false,
        error:
          'ask_user repeats the option "' +
          text +
          '". Options render as buttons, so two identical labels cannot be told apart — ' +
          'make every option unique. ' +
          FREE_TEXT_HINT
      }
    }
    seen.add(text)
    options.push(text)
  }

  return { ok: true, question: { prompt, options } }
}

/**
 * The answer the model receives.
 *
 * X2: `null` only ever means the user **explicitly** declined to answer — they pressed
 * "You decide" / "Resume with my best assumption", or the run was stopped. A deadline no
 * longer settles the gate at all, so this must not claim a timeout happened; the old
 * wording told the model the question had timed out even when the user had answered
 * "you decide", and told the same lie while the card was still open.
 */
export function formatQuestionAnswer(answer: string | null): string {
  if (answer === null) {
    return (
      'The user did not answer and chose to let you continue. ' +
      'Proceed with your best judgement and state the assumption you made.'
    )
  }
  return 'The user answered: ' + answer
}
