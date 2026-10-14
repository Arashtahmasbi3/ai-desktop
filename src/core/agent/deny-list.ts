/**
 * Commands a remote (or local) shell must never run. Matching is deliberately
 * text-based and over-eager: a false positive only asks the user to rephrase,
 * while a false negative can destroy a server.
 */
export interface DenyRule {
  /** Stable id used in audit logs. */
  id: string
  /** Human-readable reason shown to the user. */
  reason: string
  pattern: RegExp
}

export const DENY_RULES: DenyRule[] = [
  {
    id: 'rm-rf-root',
    reason: 'Recursively deleting the filesystem root is never allowed.',
    pattern: /\brm\s+(?=[^\n;&|]*-\S*r)(?=[^\n;&|]*-\S*f)[^\n;&|]*?\s\/\*?(?:\s|$|;|&|\|)/i
  },
  { id: 'mkfs', reason: 'Formatting a filesystem destroys data.', pattern: /\bmkfs(\.[a-z0-9]+)?\b/i },
  { id: 'dd-to-device', reason: 'Writing raw data to a block device destroys it.', pattern: /\bdd\b[^\n]*\bof=\/dev\//i },
  {
    id: 'power',
    reason: 'Powering off or rebooting the host is not allowed from the agent.',
    // v2.6.5: the keyword must sit in *command position* — at the start, after a
    // command separator, or right after a privilege/init wrapper. The previous
    // pattern only matched a bare `reboot`, so `sudo reboot`, `systemctl poweroff`
    // and `/sbin/reboot` all slipped through, and in `full` approval mode the
    // deny list is the only guard left.
    pattern:
      /(?:^|[;&|]\s*|\b(?:sudo|doas|systemctl|service|init|busctl|nsenter)\s+(?:-\S+\s+)*)(?:\S*\/)?(?:shutdown|reboot|halt|poweroff)\b/i
  },
  { id: 'fork-bomb', reason: 'Fork bombs hang the machine.', pattern: /:\s*\(\s*\)\s*\{[^}]*:[^}]*\}/ },
  { id: 'chmod-root', reason: 'Changing permissions of / recursively is unsafe.', pattern: /chmod\s+(-[a-zA-Z]*\s+)*777\s+\/(\s|$|\*)/i },
  { id: 'chown-root', reason: 'Changing ownership of / recursively is unsafe.', pattern: /chown\s+-R\s+\S+\s+\/(\s|$)/i },
  { id: 'overwrite-device', reason: 'Redirecting output onto a block device destroys it.', pattern: />\s*\/dev\/sd[a-z]/i },
  { id: 'mv-to-null', reason: 'Moving the whole filesystem to /dev/null destroys it.', pattern: /mv\s+\/\*\s+\/dev\/null/i },
  { id: 'wipefs', reason: 'Wiping filesystem signatures destroys data.', pattern: /\bwipefs\b/i },
  { id: 'shred-device', reason: 'Shredding a block device destroys data.', pattern: /\bshred\b[^\n|;&]*\/dev\//i },
  {
    id: 'pipe-to-shell',
    reason: 'Piping a download straight into a shell executes untrusted code.',
    // v2.6.5: also catch an absolute interpreter path (`| /bin/bash`) and the
    // command-substitution form (`bash -c "$(curl …)"`).
    pattern:
      /\b(curl|wget)\b[^|;&\n]*\|\s*(?:sudo\s+)?(?:\S*\/)?(?:bash|sh|zsh|dash|ksh)\b|\b(?:bash|sh|zsh|dash|ksh)\s+-c\s+["']?\$\(\s*(?:sudo\s+)?(?:curl|wget)\b/i
  }
]

export interface DenyResult {
  blocked: boolean
  ruleId?: string
  reason?: string
  command: string
}

/** Collapse whitespace so `rm  -rf  /` is matched the same as `rm -rf /`. */
export function normalizeCommand(command: string): string {
  return command.replace(/\s+/g, ' ').trim()
}

/** Returns whether `command` matches the deny list, with the reason. */
export function checkDenyList(command: string): DenyResult {
  const normalized = normalizeCommand(command)
  for (const rule of DENY_RULES) {
    if (rule.pattern.test(normalized)) {
      return { blocked: true, ruleId: rule.id, reason: rule.reason, command: normalized }
    }
  }
  return { blocked: false, command: normalized }
}

/** Convenience boolean used by guard clauses. */
export function isCommandBlocked(command: string): boolean {
  return checkDenyList(command).blocked
}
