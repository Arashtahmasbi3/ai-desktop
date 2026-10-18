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
          'Optional 2 to 6 short suggested answers, when the choice is closed. They become ' +
          'one-click buttons, and the user may still type their own answer instead. Omit the ' +
          'field (or pass an empty list) to ask a free-text question.'
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
 * The answer the model receives. A closed question with no answer (timeout, abort)
 * must say so plainly, so the model falls back to its own judgement instead of
 * inventing a user decision.
 */
export function formatQuestionAnswer(answer: string | null): string {
  if (answer === null) {
    return (
      'The user did not answer (the question timed out or the run was stopped). ' +
      'Proceed with your best judgement and state the assumption you made.'
    )
  }
  return `The user answered: ${answer}`
}
