/**
 * Chat transfer on project switch (v2.6.4, Fix D).
 *
 * A conversation carries its full history with it when the user opens another
 * project. The user chooses how the open chat relates to the new project:
 *
 *  - `link`  — bind the chat to the new project and keep it open, so the
 *              conversation continues with its whole context and now appears in
 *              the new project's chat list.
 *  - `move`  — bind the chat to the new project but start a fresh session, so
 *              the old thread is filed under the new project without staying
 *              active.
 *  - `new`   — leave the chat with its original project and start a fresh chat
 *              in the new project (the "auto-switch" behaviour).
 *
 * The choice is remembered until the user asks to be prompted again.
 */

export type ChatTransferChoice = 'link' | 'move' | 'new'
export type ChatTransferPreference = 'ask' | ChatTransferChoice

export const CHAT_TRANSFER_KEY = 'chat-transfer-preference'

/** True when there is a real conversation worth transferring. */
export function isConversationActive(
  messages: readonly { role: string; content: string }[]
): boolean {
  return messages.some((message) => message.role === 'user' && message.content.trim().length > 0)
}

/**
 * Read the saved preference.
 *
 * v2.8.0: the default is **`new`**, not `ask`. Reported: "I want to switch a
 * project from the chat screen to another project easily, without extra questions
 * and hoops." The dialog fires whenever the open chat has a single user message,
 * and its premise — that the chat would otherwise be orphaned — does not hold:
 * `persistChat` already files the open chat under its own project, so switching
 * away leaves it exactly where it belongs. The three-way choice is a preference,
 * not a safety gate, so it is opt-in ("Ask every time" in Settings) and the
 * `link`/`move` rebinds stay reachable without blocking a plain switch.
 */
export function readChatTransferPreference(): ChatTransferPreference {
  try {
    const raw = globalThis.localStorage?.getItem(CHAT_TRANSFER_KEY)
    return raw === 'link' || raw === 'move' || raw === 'new' || raw === 'ask' ? raw : 'new'
  } catch {
    return 'new'
  }
}

/** Persist a preference (best-effort; storage may be unavailable in tests). */
export function writeChatTransferPreference(preference: ChatTransferPreference): void {
  try {
    globalThis.localStorage?.setItem(CHAT_TRANSFER_KEY, preference)
  } catch {
    // Non-fatal: the dialog simply reappears next time.
  }
}

/** Forget the preference so the next switch prompts again. */
export function clearChatTransferPreference(): void {
  try {
    globalThis.localStorage?.removeItem(CHAT_TRANSFER_KEY)
  } catch {
    // Non-fatal.
  }
}

export type ChatTransferPlan =
  | { prompt: true }
  | { prompt: false; transfer: false }
  | { prompt: false; transfer: true; choice: ChatTransferChoice }

/**
 * Decide what a project switch should do with the open conversation.
 *
 * With nothing to transfer we switch silently. Otherwise we prompt unless the
 * user has already told us how to handle it.
 */
export function planChatTransfer(
  preference: ChatTransferPreference,
  hasActiveConversation: boolean
): ChatTransferPlan {
  if (!hasActiveConversation) return { prompt: false, transfer: false }
  if (preference === 'ask') return { prompt: true }
  return { prompt: false, transfer: true, choice: preference }
}
