/**
 * The single decision point for the chat composer's submit action (v2.5.4).
 *
 * `ChatPanel.submit` delegates here so the "preview before send" preference is
 * a pure, testable branch: `preview` is true only when the user enabled the
 * context preview, and `null` means there was nothing to send.
 */
export interface SendDecision {
  /** The exact body that will be sent (attachments joined as `@path`). */
  body: string
  /** Whether a context preview dialog must be shown first. */
  preview: boolean
}

export function decideSend(
  input: string,
  attached: string[],
  showContextBeforeSend: boolean
): SendDecision | null {
  const body = [input.trim(), ...attached.map((path) => `@${path}`)].filter(Boolean).join('\n')
  if (!body) return null
  return { body, preview: showContextBeforeSend }
}
