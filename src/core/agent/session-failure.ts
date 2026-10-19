/**
 * "The session to that server is already gone" — the infrastructure-failure concept (R4).
 *
 * A tool card that says `Not connected` is not an answer about the task. It is the app reporting that
 * the command never reached the host: the SSH session was dropped (or never opened) before anything
 * ran. The session this item comes from recorded five of those in 0.00–0.01 s, went on to the third
 * failure, and then the drift guard concluded that the run "re-ran probes whose answers it already
 * had". The probes never ran, so there were no answers to have.
 *
 * **One matcher, one phrase list.** The list lives in `verdict.ts` (`SESSION_DROPPED_PHRASES`),
 * because that is where the `session-dropped` verdict row reads it, and R2 exports
 * `matchesSessionDropped` for exactly this reuse. This module is the R4-facing name for the same
 * question — `isInfrastructureFailure` — so the loop detector does not have to import the whole
 * verdict table to ask it, and so a phrase can never be recognised by one caller and missed by the
 * other. Do not add a second list here.
 *
 * What R4 does with it: a step whose result matches is flagged by `informationOfStep`
 * (`StepInformation.infrastructure`) and the loop detector **stops the run on the first one**, with
 * `session_dropped` as the reason. It is neither progress nor "no new information" — there is
 * nothing to progress on and nothing to repeat.
 */
import { matchesSessionDropped } from './verdict'

/**
 * True when a tool result's text is the app reporting a dead session rather than an answer.
 *
 * Deliberately total: `undefined`, an empty string and ordinary output all return false, so a caller
 * can hand it anything it has without a guard of its own. Case-insensitive and ANSI-tolerant, since
 * it delegates to the verdict table's own matcher.
 */
export function isInfrastructureFailure(text: string | undefined | null): boolean {
  const value = String(text ?? '')
  if (value.trim() === '') return false
  return matchesSessionDropped(value)
}
