/**
 * Parser for OpenSSH client config (`~/.ssh/config`) used by the
 * "Import from ~/.ssh/config" flow (v2.3.2, B.5).
 *
 * Only connection metadata is read: HostName, User, Port and the *path* of
 * IdentityFile. Private key contents are never touched — the key material is
 * loaded separately through keytar when the user connects.
 */

import type { SshConfigHost } from '@shared/vps'

export type { SshConfigHost }

const KEY_RE = /^([A-Za-z][A-Za-z0-9]*)\s*=?\s*(.*)$/

function isPattern(value: string): boolean {
  return /[*?!]/.test(value)
}

/**
 * Parse an ssh_config file into concrete host blocks. Wildcard/negated `Host`
 * patterns and `Match` blocks are skipped — they cannot be imported directly.
 */
export function parseSshConfig(text: string): SshConfigHost[] {
  const hosts: SshConfigHost[] = []
  let current: SshConfigHost[] = []
  let inMatch = false

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) continue

    const keyMatch = KEY_RE.exec(line)
    if (!keyMatch) continue
    const key = keyMatch[1]!.toLowerCase()
    const value = keyMatch[2]!.trim()

    if (key === 'host') {
      const aliases = value.split(/\s+/).filter((alias) => alias && !isPattern(alias))
      current = aliases.map((alias) => ({ alias, hostName: '' }))
      hosts.push(...current)
      inMatch = false
      continue
    }
    if (key === 'match') {
      current = []
      inMatch = true
      continue
    }
    if (inMatch || current.length === 0) continue

    for (const host of current) {
      switch (key) {
        case 'hostname':
          if (!host.hostName) host.hostName = value
          break
        case 'user':
          if (!host.user) host.user = value
          break
        case 'port':
          if (!host.port && /^\d+$/.test(value)) host.port = Number(value)
          break
        case 'identityfile':
          if (!host.identityFile) host.identityFile = value
          break
      }
    }
  }

  // A block without HostName can still use the alias as the address.
  return hosts.map((host) => ({ ...host, hostName: host.hostName || host.alias }))
}
