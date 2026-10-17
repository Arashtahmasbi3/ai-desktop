/**
 * A path inside a REMOTE payload is not a local path (v4.1).
 *
 * Found from the user's own session log. The agent ran, as its first migration step:
 *
 *   ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new \
 *       root@212.16.86.23 'hostname; echo "--- df ---"; df -h /opt | tail -2'
 *
 * and the guard answered:
 *
 *   Blocked: Path "/opt" is outside project root "/opt/sepehr-motor"
 *
 * `/opt` there is on the **target** machine. The guard was checking one host's filesystem against
 * another host's project root, so a correct command was refused and the agent had to rewrite it —
 * which is exactly the kind of dead end the checklist exists to remove.
 *
 * The fix is narrow on purpose: `ssh`/`mosh` payloads are not scanned (they belong to another host,
 * where approval and host policy govern, not the local workspace boundary), while `bash -c` / `sh -c`
 * stay fully checked because they run **here** — otherwise wrapping a command in a shell would be a
 * one-line bypass of the whole guard.
 */
import { describe, expect, it } from 'vitest'
import {
  enforceCommandPaths,
  stripRemotePayloads
} from '../../src/core/remote/path-guard'

const ROOT = '/opt/sepehr-motor'

/** The command the user actually lost a turn to, verbatim. */
const BLOCKED_COMMAND =
  'echo "=== SOURCE ==="; ls -d /opt/sepehr-motor 2>/dev/null && du -sh /opt/sepehr-motor 2>/dev/null; ' +
  'echo "=== SSH TO TARGET ==="; ssh -o BatchMode=yes -o ConnectTimeout=10 ' +
  '-o StrictHostKeyChecking=accept-new root@212.16.86.23 ' +
  '\'hostname; echo "--- df ---"; df -h /opt | tail -2\' 2>&1 | tail -10'

describe('stripRemotePayloads', () => {
  it('drops the payload of ssh but keeps the transport and the host', () => {
    const stripped = stripRemotePayloads("ssh root@212.16.86.23 'df -h /opt'")
    expect(stripped).toContain('ssh')
    expect(stripped).toContain('root@212.16.86.23')
    expect(stripped).not.toContain('/opt')
  })

  it('walks past value-taking flags to find the host', () => {
    const stripped = stripRemotePayloads('ssh -o BatchMode=yes -p 2222 -i ~/.ssh/id_ed25519 root@h "ls /etc"')
    expect(stripped).not.toContain('ls /etc')
    expect(stripped).toContain('root@h')
  })

  it('keeps the rest of a compound command intact', () => {
    const stripped = stripRemotePayloads("ssh h 'ls /remote'; echo done; ls /local")
    // The remote path is gone, the local one survives for the guard to judge.
    expect(stripped).not.toContain('/remote')
    expect(stripped).toContain('echo done')
    expect(stripped).toContain('ls /local')
  })

  it('leaves a command with no remote transport untouched', () => {
    const command = 'cat /etc/shadow'
    expect(stripRemotePayloads(command)).toBe(command)
  })

  it('does not treat mosh differently from ssh', () => {
    expect(stripRemotePayloads("mosh h 'rm -rf /srv'")).not.toContain('/srv')
  })
})

describe('enforceCommandPaths and remote payloads', () => {
  it('allows the exact command the agent was blocked on', () => {
    expect(enforceCommandPaths(BLOCKED_COMMAND, ROOT)).toEqual({ ok: true })
  })

  it('allows a disk check on the target host', () => {
    expect(enforceCommandPaths("ssh root@h 'df -h /opt'", ROOT).ok).toBe(true)
  })

  /* --- the security negatives: the fix must not become a hole ------------------------------- */

  it('still refuses a local read outside the project', () => {
    const verdict = enforceCommandPaths('cat /etc/shadow', ROOT)
    expect(verdict.ok).toBe(false)
    expect(verdict.error).toContain('/etc/shadow')
  })

  it('still refuses a local listing outside the project', () => {
    expect(enforceCommandPaths('ls /opt', ROOT).ok).toBe(false)
  })

  it('still refuses a local command hidden behind a compound separator', () => {
    expect(enforceCommandPaths("echo ok; ssh h 'ls /remote'; ls /opt", ROOT).ok).toBe(false)
  })

  it('does NOT strip `bash -c`, because that runs locally', () => {
    const verdict = enforceCommandPaths("bash -c 'cat /etc/shadow'", ROOT)
    expect(verdict.ok).toBe(false)
  })

  it('does NOT strip `sh -c` either', () => {
    expect(enforceCommandPaths("sh -c 'ls /opt'", ROOT).ok).toBe(false)
  })

  it('still refuses an escape through ..', () => {
    expect(enforceCommandPaths('cd .. && cat etc/shadow', ROOT).ok).toBe(false)
  })

  it('does not refuse a `..` that only happens on the remote host', () => {
    // `ssh h 'cd ..'` moves up on the target; the local workspace is untouched.
    expect(enforceCommandPaths("ssh h 'cd .. && ls'", ROOT).ok).toBe(true)
  })

  it('keeps ordinary redirections benign', () => {
    expect(enforceCommandPaths('ls -d /opt/sepehr-motor 2>/dev/null', ROOT).ok).toBe(true)
  })
})
