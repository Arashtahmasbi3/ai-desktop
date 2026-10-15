/**
 * The single decision point for the chat composer's submit action (v2.5.4).
 *
 * `ChatPanel.submit` delegates here so the "preview before send" preference is
 * a pure, testable branch: `preview` is true only when the user enabled the
 * context preview, and `null` means there was nothing to send.
 *
 * v2.9.0: attachments are no longer joined into the body as `@<path>` text. That was the
 * whole bug — nothing in main or core ever parsed `@path`, so the model received an inert
 * string pointing at a file outside its workspace. The composer now sends integer-free
 * opaque **ids** alongside the text, and main resolves and stages them.
 */
export interface SendDecision {
  /** The user's own text, exactly as typed. */
  body: string
  /** Opaque attachment ids registered with main; empty when nothing was attached. */
  attachments: string[]
  /** Display names for the attachments, so the user's own bubble stays readable. */
  attachmentNames: string[]
  /** Whether a context preview dialog must be shown first. */
  preview: boolean
}

export interface PendingAttachment {
  id: string
  name: string
  /** v2.9.0: drives the chip icon and the "cannot see images" state. */
  kind?: 'text' | 'image'
  bytes?: number
}

export function decideSend(
  input: string,
  attached: ReadonlyArray<PendingAttachment>,
  showContextBeforeSend: boolean
): SendDecision | null {
  const body = input.trim()
  if (!body && attached.length === 0) return null
  return {
    body,
    attachments: attached.map((item) => item.id),
    attachmentNames: attached.map((item) => item.name),
    preview: showContextBeforeSend
  }
}
