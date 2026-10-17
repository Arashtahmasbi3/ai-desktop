/**
 * Network actions are their own class (v4.1, checklist item 17).
 *
 * The app had no concept of the network in its approval layer. A six-port scan written with bash's `/dev/tcp`
 * was an ordinary shell command, so the only thing standing between it and a run was a plan approval that
 * happened to list it. "Read-only" describes the local filesystem; it says nothing about pointing ports at
 * another machine.
 *
 * The detector deliberately does NOT cover `curl`, `wget` or `ping`: they are already governed as read-only
 * fetches or plain reachability checks, and re-flagging them would rebuild the approval friction this round
 * removed. `ssh` is excluded too — a shell session is already gated as a write.
 */
import { describe, expect, it } from 'vitest'
import { detectNetworkAction } from '../../src/core/remote/network-action'
import { shouldRequireApproval } from '../../src/main/approval-gate'

/** Verbatim from the session log. */
const PORT_SCAN =
  'for p in 22 80 443 2022 2222 22222; do printf "port %-6s " "$p"; ' +
  'timeout 6 bash -c "cat </dev/null >/dev/tcp/212.16.86.23/$p" 2>/dev/null && echo "OPEN" || echo "closed/filtered"; done'

describe('detectNetworkAction', () => {
  it('sees the port scan for what it is', () => {
    const action = detectNetworkAction(PORT_SCAN)
    expect(action?.kind).toBe('scan')
    expect(action?.hosts).toContain('212.16.86.23')
    expect(action?.ports).toEqual(expect.arrayContaining(['22', '80', '443']))
    expect(action?.summary).toContain('scan')
  })

  it('recognises a single netcat probe', () => {
    const action = detectNetworkAction('nc -zv -w 6 212.16.86.23 22')
    expect(action?.kind).toBe('probe')
    expect(action?.hosts).toEqual(['212.16.86.23'])
    expect(action?.ports).toEqual(['22'])
  })

  it('recognises nmap as a scan', () => {
    expect(detectNetworkAction('nmap -p 22,80,443 10.0.0.5')?.kind).toBe('scan')
  })

  it('recognises a single /dev/tcp probe as a probe, not a scan', () => {
    const action = detectNetworkAction('cat </dev/null >/dev/tcp/10.0.0.5/22 && echo open')
    expect(action?.kind).toBe('probe')
    expect(action?.ports).toEqual(['22'])
  })

  /* --- the exclusions are deliberate and must stay ----------------------------------------- */

  it('leaves an ordinary command alone', () => {
    expect(detectNetworkAction('ls -la /srv/app')).toBeUndefined()
  })

  it('leaves curl alone', () => {
    expect(detectNetworkAction('curl -fsS https://example.com/health')).toBeUndefined()
  })

  it('leaves ping alone', () => {
    expect(detectNetworkAction('ping -c 3 1.1.1.1')).toBeUndefined()
  })

  it('leaves ssh alone', () => {
    expect(detectNetworkAction("ssh root@host 'df -h /opt'")).toBeUndefined()
  })

  it('handles an empty or non-string command', () => {
    expect(detectNetworkAction('')).toBeUndefined()
    expect(detectNetworkAction(undefined as unknown as string)).toBeUndefined()
  })
})

describe('the approval gate asks about a network action, before any read-only shortcut', () => {
  const shell = (command: string) => ({ name: 'remote_shell', arguments: { command } })

  it('requires approval even though the scan could look read-only', () => {
    const requirement = shouldRequireApproval(shell(PORT_SCAN))
    expect(requirement.required).toBe(true)
    expect(requirement.reason).toBe('network_action')
  })

  it('asks for a bare netcat probe too', () => {
    expect(shouldRequireApproval(shell('nc -zv -w 6 212.16.86.23 22')).reason).toBe('network_action')
  })

  it('keeps read-only diagnostics silent — the friction fix must survive', () => {
    const requirement = shouldRequireApproval(shell('echo "=== SOURCE ==="; du -sh /srv/app; df -h'))
    expect(requirement.required).toBe(false)
    expect(requirement.reason).toBe('read_only_shell')
  })

  it('still asks for a write', () => {
    expect(shouldRequireApproval(shell('rm -rf /srv')).reason).toBe('write')
  })
})
