/**
 * X9 — what a tool card is allowed to claim.
 *
 * Found in the user's own session log: every remote command rendered as a green `ok` card, and a
 * `grep` that returned exit code 2 was one of them. The card trusted `ok`, so a result carrying a
 * *failed exit* still got the success treatment — and the model then reasoned from output that had
 * actually failed.
 *
 * Four states, because "it worked but complained" is neither success nor failure:
 *
 *   ok       nothing failed and stderr was silent;
 *   warning  exit 0 (or no exit at all) but the command wrote to stderr — succeeded with warnings;
 *   failed   a non-zero exit, or `ok: false`;
 *   blocked  policy, approval or the path guard refused the call before it ran.
 *
 * `blocked` outranks `failed` on purpose: an approval refusal never ran a command, so calling it a
 * failure would send the reader looking for a bug that is not there.
 */

/** The state of one finished tool call. */
export type ToolOutcome = 'ok' | 'warning' | 'failed' | 'blocked'

export interface ToolOutcomeInput {
  ok?: boolean
  /** The result's `ToolErrorCode`; only `blocked` changes the state here. */
  code?: string
  exitCode?: number
  stderr?: string
}

/** The first non-empty line of `text`, trimmed and capped so a row stays one line. */
export function firstLineOf(text: string | undefined, max = 120): string | undefined {
  if (typeof text !== 'string') return undefined
  const line = text
    .split('\n')
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.length > 0)
  if (line === undefined) return undefined
  return line.length > max ? `${line.slice(0, Math.max(max - 1, 0))}…` : line
}

/**
 * The state of a finished tool call, from the evidence the result carries — never from `ok`
 * alone, because a shell that exited 2 can still arrive flagged as ok.
 */
export function toolOutcome(input: ToolOutcomeInput): ToolOutcome {
  const exitFailed = typeof input.exitCode === 'number' && input.exitCode !== 0
  if (input.ok === false || exitFailed) {
    return input.code === 'blocked' ? 'blocked' : 'failed'
  }
  return firstLineOf(input.stderr) === undefined ? 'ok' : 'warning'
}

/** True for the two states that may be shown with the success treatment. */
export function isSuccessOutcome(outcome: ToolOutcome): boolean {
  return outcome === 'ok' || outcome === 'warning'
}
