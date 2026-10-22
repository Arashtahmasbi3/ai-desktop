/**
 * Host and address spelling, in one place (S4.7).
 *
 * Three surfaces need three different spellings of the same address, and getting them mixed up is
 * silent: `ssh`/`rsync` require `root@[2001:db8::1]:/path`, bash's `/dev/tcp` requires the **bare**
 * literal (`/dev/tcp/2001:db8::1/22` — it splits the pseudo-path at the last slash), and a saved
 * server may store either form or a name. Before this module the app wrote `user@::1:/path`, which
 * rsync happens to parse but a bracketed host stored by the user then becomes `[[::1]]`.
 *
 * The validator is deliberately narrow. It is not a replacement for `net.isIP` (this file is shared
 * with the renderer, which has no Node built-ins); it is the *shell-safety* gate in front of a
 * command, so anything that is not `[0-9A-Fa-f:.]` is refused rather than escaped.
 */

/** An address with any stored brackets removed, trimmed. */
export function bareHost(host: string): string {
  return host.trim().replace(/^\[/, '').replace(/\]$/, '')
}

/**
 * Is `host` an IPv6 literal?
 *
 * Accepts at most one `::`, 1–4 hex digits per group, an optional dotted-quad tail, and both the
 * bracketed and bare spellings. Rejects zone ids (`%eth0`) on purpose: they are not portable in an
 * rsync destination and would need a second escaping rule.
 */
export function isIpv6Literal(host: string): boolean {
  const value = bareHost(host)
  if (!value.includes(':') || !/^[0-9A-Fa-f:.]+$/.test(value)) return false
  if (value.includes(':::')) return false
  if (value.startsWith(':') && !value.startsWith('::')) return false
  if (value.endsWith(':') && !value.endsWith('::')) return false
  const compressed = value.split('::')
  if (compressed.length > 2) return false
  const groups = value.split(':')
  let ipv4Tail = false
  const tail = groups[groups.length - 1] ?? ''
  if (tail.includes('.')) {
    if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(tail)) return false
    if (tail.split('.').some((part) => Number(part) > 255)) return false
    ipv4Tail = true
    groups.pop()
  }
  const hex = groups.filter((group) => group !== '')
  if (hex.some((group) => !/^[0-9A-Fa-f]{1,4}$/.test(group))) return false
  const count = hex.length + (ipv4Tail ? 2 : 0)
  return compressed.length === 2 ? count <= 7 : count === 8
}

/**
 * The address as `ssh` and `rsync` want it: `[2001:db8::1]` for a literal, unchanged otherwise.
 * A stored value that already carries brackets is never double-bracketed.
 */
export function sshHostSpec(host: string): string {
  const bare = bareHost(host)
  return bare.includes(':') ? `[${bare}]` : bare
}

/** `user@[2001:db8::1]` or `user@host` — the destination prefix of an ssh/rsync target. */
export function sshUserAtHost(user: string, host: string): string {
  return `${user}@${sshHostSpec(host)}`
}
