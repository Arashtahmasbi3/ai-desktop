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
        description:
          'Short suggested answers, when the choice is closed. The user may still type their own.'
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

/** Read the question out of a tool call, tolerating a malformed payload. */
export function parseQuestion(args: Record<string, unknown>): AgentQuestion | undefined {
  const prompt = typeof args.question === 'string' ? args.question.trim() : ''
  if (!prompt) return undefined
  const raw = Array.isArray(args.options) ? args.options : []
  const options = raw
    .filter((option): option is string => typeof option === 'string')
    .map((option) => option.trim())
    .filter((option) => option.length > 0)
    .slice(0, 6)
  return options.length > 0 ? { prompt, options } : { prompt }
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
