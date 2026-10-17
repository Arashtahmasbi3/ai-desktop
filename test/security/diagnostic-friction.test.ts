/**
 * Diagnostic friction (v4.1).
 *
 * The user approved **four** prompts in a row for read-only diagnostics during one migration attempt:
 *
 *   1. echo "=== SOURCE ==="; ls -d … && du -sh …; ssh root@host 'hostname; df -h /opt | tail -2'
 *   2. echo "=== SOURCE ==="; du -sh …; ssh root@host 'hostname; df -h'
 *   3. echo "=== PING ==="; ping -c 3 …; nc -zv … 22; ip route get …
 *   4. for p in 22 80 443 …; do … >/dev/tcp/212.16.86.23/$p …; done
 *
 * Two of them are pure reads and must stop prompting. The other two are **network probes**, and they
 * should still be asked — but as network actions with a reason (see the network policy), never as an
 * unexplained "write". This file pins both halves: the friction that must disappear, and the prompt that
 * must survive.
 */
import { describe, expect, it } from 'vitest'
import { isReadOnlyShellCommand } from '../../src/core/remote/command-whitelist'

/** Verbatim from the session log. */
const SSH_DISK_CHECK =
  'echo "=== SOURCE ==="; ls -d /opt/sepehr-motor 2>/dev/null && du -sh /opt/sepehr-motor 2>/dev/null; ' +
  'echo "=== SSH TO TARGET ==="; ssh -o BatchMode=yes -o ConnectTimeout=10 ' +
  '-o StrictHostKeyChecking=accept-new root@212.16.86.23 ' +
  '\'hostname; echo "--- df ---"; df -h /opt | tail -2\' 2>&1 | tail -10'

const SSH_DISK_CHECK_RETRY =
  'echo "=== SOURCE ==="; du -sh /opt/sepehr-motor; echo; echo "=== SSH TO TARGET ==="; ' +
  "ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new root@212.16.86.23 " +
  '\'hostname; echo "--- disk ---"; df -h\' 2>&1 | tail -12'

describe('read-only diagnostics no longer prompt (v4.1)', () => {
  it('classifies the first migration probe as a read', () => {
    expect(isReadOnlyShellCommand(SSH_DISK_CHECK)).toBe(true)
  })

  it('classifies the retry probe as a read', () => {
    expect(isReadOnlyShellCommand(SSH_DISK_CHECK_RETRY)).toBe(true)
  })

  it('classifies a quoted remote read on its own', () => {
    expect(isReadOnlyShellCommand("ssh root@h 'hostname; df -h | tail -2'")).toBe(true)
  })

  it('classifies a banner-plus-probe as a read', () => {
    expect(isReadOnlyShellCommand('echo "=== PING ==="; ping -c 3 10.0.0.1 2>&1 | tail -5')).toBe(true)
  })

  it('classifies chained local reads as a read', () => {
    expect(isReadOnlyShellCommand('du -sh /srv/app; df -h; free -m')).toBe(true)
  })
})

describe('what must STILL prompt (the negatives)', () => {
  it('a netcat probe is not a read — it becomes a network action with a reason', () => {
    expect(isReadOnlyShellCommand('nc -zv -w 6 212.16.86.23 22')).toBe(false)
  })

  it('a /dev/tcp port scan is not a read', () => {
    expect(
      isReadOnlyShellCommand(
        'for p in 22 80 443; do timeout 6 bash -c "cat </dev/null >/dev/tcp/212.16.86.23/$p" 2>/dev/null && echo OPEN || echo closed; done'
      )
    ).toBe(false)
  })

  it('a real write still prompts', () => {
    expect(isReadOnlyShellCommand('rm -rf /srv')).toBe(false)
  })

  it('redirection to a real file still prompts', () => {
    expect(isReadOnlyShellCommand('echo x > /etc/passwd')).toBe(false)
  })

  it('command substitution still prompts', () => {
    expect(isReadOnlyShellCommand('echo $(cat /etc/shadow)')).toBe(false)
  })

  it('a remote WRITE is still a write', () => {
    expect(isReadOnlyShellCommand("ssh h 'rm -rf /srv'")).toBe(false)
  })

  it('tee still prompts', () => {
    expect(isReadOnlyShellCommand('ls | tee /tmp/out')).toBe(false)
  })

  it('sudo still prompts', () => {
    expect(isReadOnlyShellCommand('sudo cat /var/log/syslog')).toBe(false)
  })

  it('an in-place sed still prompts', () => {
    expect(isReadOnlyShellCommand("sed -i 's/a/b/' /etc/hosts")).toBe(false)
  })
})
