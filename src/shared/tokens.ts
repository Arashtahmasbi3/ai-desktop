/**
 * The app's rough token estimates: one heuristic, two measurements.
 *
 * Both use the same ratio (about four characters per token), but they read the
 * string differently on purpose, and the difference is user-visible:
 *
 * - `estimateRawTokens` counts the string exactly as it will be sent, padding
 *   included. The context preview (`context-preview.ts`) reports what a run
 *   will actually put in front of the model, so a string of spaces is one
 *   token, because it is one token on the wire.
 * - `estimateTrimmedTokens` trims first. The context budget (`memory.ts`) is
 *   about a message or a draft, so whitespace-only text is zero tokens and
 *   padding around a message is not billed.
 *
 * For padded or whitespace-only input the two disagree, which is the reason
 * they are two names instead of one shared helper: collapsing them would
 * silently move one of two numbers the user already sees. Code that needs
 * "just a quick estimate" should pick one of these names, never invent a third.
 */

/** Conservative characters-per-token ratio for the rough estimates below. */
export const CHARS_PER_TOKEN = 4

/** Rough token count for the text exactly as given (padding is counted). */
export function estimateRawTokens(text: string): number {
  return text ? Math.ceil(text.length / CHARS_PER_TOKEN) : 0
}

/** Rough token count after trimming, for a context-budget check. */
export function estimateTrimmedTokens(text: string): number {
  return Math.ceil(text.trim().length / CHARS_PER_TOKEN)
}
