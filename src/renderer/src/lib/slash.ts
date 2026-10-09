/** Slash-command parsing for the chat composer. Kept pure so it is testable. */

export interface SlashCommandLike {
  id: string
}

/**
 * Commands to show for the current composer input. The menu is only open while
 * the user is typing a bare command (no arguments / spaces yet); an empty or
 * non-slash draft yields nothing.
 */
export function filterSlashCommands<T extends SlashCommandLike>(
  commands: T[],
  input: string
): T[] {
  const value = input.trimStart().toLowerCase()
  if (!value.startsWith('/') || value.includes(' ')) return []
  return commands.filter((command) => `/${command.id}`.startsWith(value))
}

/** The exact command a submitted draft refers to, if any. */
export function resolveSlashCommand<T extends SlashCommandLike>(
  commands: T[],
  input: string
): T | undefined {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/') || trimmed.includes(' ')) return undefined
  return commands.find((command) => `/${command.id}` === trimmed.toLowerCase())
}
