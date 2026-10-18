/**
 * Network actions are their own class (v4.1; completed in B2-3).
 *
 * The app had no concept of the network in its approval layer. A six-port scan written with bash's `/dev/tcp`
 * was an ordinary shell command, so the only thing standing between it and a run was a plan approval that
 * happened to list it. "Read-only" describes the local filesystem; it says nothing about pointing ports at
 * another machine.
 *
 * v4.1 recognised `/dev/tcp`, `nc` and `nmap` and deliberately left `curl`, `wget`, `ssh` and `ping` alone. That
 * was a policy with holes a model could fall into without meaning to, so B2-3 extends the detector to every
 * class below, one positive each, and pins the negatives that must stay silent.
 *
 * The detector only *detects and describes*; `approval-gate.ts` turns a detection into a prompt. It is pure:
 * no I/O, no clock, no network.
 */
import { describe, expect, it } from 'vitest'
import { describeNetworkTarget, detectNetworkAction } from '../../src/core/remote/network-action'
import { createApprovalGate, shouldRequireApproval } from '../../src/main/approval-gate'
import {
  READ_ONLY_BASE_COMMANDS,
  isReadOnlyShellCommand
} from '../../src/core/remote/command-whitelist'
import type { AgentAction } from '../../src/shared/agent'

/** Verbatim from the v4.1 session log. */
const PORT_SCAN =
  'for p in 22 80 443 2022 2222 22222; do printf "port %-6s " "$p"; ' +
  'timeout 6 bash -c "cat </dev/null >/dev/tcp/212.16.86.23/$p" 2>/dev/null && echo "OPEN" || echo "closed/filtered"; done'

/** The remote shell tool the agent uses for commands on a VPS. */
function shell(command: string): { name: string; arguments: { command: string } } {
  return { name: 'remote_shell', arguments: { command } }
}

/** The local shell tool. */
function local(command: string): { name: string; arguments: { command: string } } {
  return { name: 'run_command', arguments: { command } }
}

function requirement(command: string): ReturnType<typeof shouldRequireApproval> {
  return shouldRequireApproval(shell(command))
}

/* ============================================================================================== */
/* 1. Port probes / raw TCP                                                                        */
/* ============================================================================================== */

describe('1. port probes and raw TCP', () => {
  it('sees the /dev/tcp port scan for what it is', () => {
    const action = detectNetworkAction(PORT_SCAN)
    expect(action?.kind).toBe('scan')
    expect(action?.hosts).toContain('212.16.86.23')
    expect(action?.ports).toEqual(expect.arrayContaining(['22', '80', '443']))
    expect(action?.summary).toContain('scan')
  })

  it('reads the udp pseudo-device too', () => {
    const action = detectNetworkAction('echo probe > /dev/udp/8.8.8.8/53')
    expect(action?.kind).toBe('probe')
    expect(action?.hosts).toContain('8.8.8.8')
    expect(action?.ports).toContain('53')
  })

  it.each([
    'nc -z 10.0.0.5 22',
    'nc -zv -w 6 212.16.86.23 22',
    '/usr/bin/netcat -z db.internal 5432',
    'ncat --send-only 10.0.0.5 443',
    'socat - TCP:203.0.113.9:22',
    'telnet 203.0.113.9 23'
  ])('recognises %s as a probe', (command) => {
    const action = detectNetworkAction(command)
    expect(action, command).toBeDefined()
    expect(action?.kind, command).toBe('probe')
  })

  it('reads the host and port out of nc', () => {
    const action = detectNetworkAction('nc -zv -w 6 212.16.86.23 22')
    expect(action?.tool).toBe('nc')
    expect(action?.hosts).toEqual(['212.16.86.23'])
    expect(action?.ports).toEqual(['22'])
  })

  it('reads a socat address', () => {
    const action = detectNetworkAction('socat - TCP:203.0.113.9:22')
    expect(action?.hosts).toEqual(['203.0.113.9'])
    expect(action?.ports).toEqual(['22'])
  })

  it('does not read telnet -l (a login name) as a listener', () => {
    const action = detectNetworkAction('telnet -l root 203.0.113.9 23')
    expect(action?.kind).toBe('probe')
    expect(action?.hosts).toEqual(['203.0.113.9'])
  })

  it('flags a listener, which exposes a port rather than reaching a host', () => {
    // Fail closed: it is not a probe, but it is still a port action and must not run silently.
    expect(detectNetworkAction('nc -l 4444')?.kind).toBe('probe')
    expect(detectNetworkAction('socat TCP-LISTEN:4444,reuseaddr -')?.kind).toBe('probe')
  })
})

/* ============================================================================================== */
/* 2. Scanners                                                                                     */
/* ============================================================================================== */

describe('2. scanners', () => {
  it.each([
    ['nmap -p 22,80,443 10.0.0.5', '10.0.0.5'],
    ['masscan 10.0.0.0/8 -p80,443', '10.0.0.0/8'],
    ['zmap -p 443 10.0.0.0/8', '10.0.0.0/8']
  ])('recognises %s as a scan', (command, host) => {
    const action = detectNetworkAction(command)
    expect(action?.kind, command).toBe('scan')
    expect(action?.hosts, command).toContain(host)
  })

  it('reads the ports out of nmap -p', () => {
    expect(detectNetworkAction('nmap -p 22,80,443 10.0.0.5')?.ports).toEqual(['22', '80', '443'])
  })

  it('still reads an attached masscan port list', () => {
    expect(detectNetworkAction('masscan 10.0.0.0/8 -p80,443')?.ports).toEqual(['80', '443'])
  })
})

/* ============================================================================================== */
/* 3. HTTP clients                                                                                 */
/* ============================================================================================== */

describe('3. HTTP clients are network actions when they contact something', () => {
  it('flags a fetch that contacts a host', () => {
    const action = detectNetworkAction('curl -fsS https://example.com/health')
    expect(action?.kind).toBe('fetch')
    expect(action?.tool).toBe('curl')
    expect(action?.hosts).toEqual(['example.com'])
  })

  /*
   * The decision this pins: `curl http://localhost:3000` IS a network action.
   *
   * It contacts a host; our rule is about reaching a host, not about which host, and a classifier that tried to
   * special-case "localhost is fine" would be a hole a model could step through (a local service can be a
   * database, a deploy endpoint, or somebody else's tunnel). The dialog is what tells the user *where* — it
   * renders the exact command and, since B2-3, the parsed target, so `localhost:3000` is visible rather than
   * buried. Asking once about a local fetch is cheap; silently probing an unknown address is not.
   */
  it('classifies a localhost fetch the same way and names the address', () => {
    const action = detectNetworkAction('curl http://localhost:3000/health')
    expect(action?.kind).toBe('fetch')
    expect(action?.hosts).toEqual(['localhost'])
    expect(action?.ports).toEqual(['3000'])
    expect(describeNetworkTarget(action!)).toBe('localhost:3000')
  })

  it('flags a POST as a network action, not only a GET', () => {
    const action = detectNetworkAction("curl -X POST https://api.example.com/v1/deploy -d '{}'")
    expect(action?.kind).toBe('fetch')
    expect(action?.hosts).toEqual(['api.example.com'])
  })

  it.each([
    'wget -qO- https://example.com/x',
    'http GET example.com/api',
    'https :8443/health',
    'curl --url https://example.com/x',
    'curl --url=https://example.com/x'
  ])('recognises %s as a fetch', (command) => {
    expect(detectNetworkAction(command)?.kind, command).toBe('fetch')
  })

  it("reads httpie's :port shorthand as localhost", () => {
    const action = detectNetworkAction('https :8443/health')
    expect(action?.hosts).toEqual(['localhost'])
    expect(action?.ports).toEqual(['8443'])
  })
})

/* ============================================================================================== */
/* 4. DNS                                                                                          */
/* ============================================================================================== */

describe('4. DNS', () => {
  it.each([
    ['dig +short example.com', 'example.com'],
    ['nslookup db.internal', 'db.internal'],
    ['host 1.1.1.1', '1.1.1.1'],
    ['getent hosts db.internal', 'db.internal']
  ])('recognises %s as a name lookup', (command, host) => {
    const action = detectNetworkAction(command)
    expect(action?.kind, command).toBe('dns')
    expect(action?.hosts, command).toContain(host)
  })

  it('reads the resolver of an explicit @server dig', () => {
    const action = detectNetworkAction('dig @8.8.8.8 example.com')
    expect(action?.hosts).toEqual(expect.arrayContaining(['example.com', '8.8.8.8']))
  })

  it('leaves getent queries that are not name-service lookups alone', () => {
    expect(detectNetworkAction('getent passwd root')).toBeUndefined()
  })
})

/* ============================================================================================== */
/* 5. Remote shells and copies                                                                     */
/* ============================================================================================== */

describe('5. remote shells and copies', () => {
  it.each([
    ['ssh root@203.0.113.23 uptime', '203.0.113.23'],
    ['scp ./dist.tgz root@203.0.113.23:/srv/', '203.0.113.23'],
    ['sftp user@host.example', 'host.example'],
    ['rsync -az ./dist/ root@host:/srv/app', 'host'],
    ['mosh root@host', 'host']
  ])('recognises %s as a remote action', (command, host) => {
    const action = detectNetworkAction(command)
    expect(action?.kind, command).toBe('remote')
    expect(action?.hosts, command).toContain(host)
  })

  it('leaves a purely local copy alone', () => {
    expect(detectNetworkAction('rsync -az ./dist/ ./backup')).toBeUndefined()
    expect(detectNetworkAction('scp ./a ./b')).toBeUndefined()
    // A Windows drive letter is a path, not a host.
    expect(detectNetworkAction('scp C:\\temp\\a.zip D:\\backup\\')).toBeUndefined()
  })

  it('reads the ssh port', () => {
    const action = detectNetworkAction('ssh -p 2222 deploy@host uptime')
    expect(action?.hosts).toEqual(['host'])
    expect(action?.ports).toEqual(['2222'])
  })
})

/* ============================================================================================== */
/* 6. Interpreter sockets                                                                          */
/* ============================================================================================== */

describe('6. sockets opened from inline interpreter code', () => {
  it('recognises a python socket', () => {
    const action = detectNetworkAction(
      "python3 -c 'import socket; s = socket.socket(); s.connect((\"10.0.0.5\", 22))'"
    )
    expect(action?.kind).toBe('script')
    expect(action?.tool).toBe('python3')
  })

  it('recognises urllib and reads the URL out of the code', () => {
    const action = detectNetworkAction(
      "python -c 'import urllib.request; urllib.request.urlopen(\"https://example.com/api\")'"
    )
    expect(action?.kind).toBe('script')
    expect(action?.hosts).toEqual(['example.com'])
  })

  it('recognises node net.connect and fetch', () => {
    expect(detectNetworkAction("node -e \"require('net').connect(22, '10.0.0.5')\"")?.kind).toBe(
      'script'
    )
    const fetched = detectNetworkAction("node -e \"fetch('https://example.com/api')\"")
    expect(fetched?.kind).toBe('script')
    expect(fetched?.hosts).toEqual(['example.com'])
  })

  it('catches inline code that shells out to a network binary', () => {
    const action = detectNetworkAction(
      "python3 -c \"import subprocess; subprocess.run(['nc', '-z', '10.0.0.5', '22'])\""
    )
    expect(action?.kind).toBe('script')
  })

  it('does not call every shell-out a network action', () => {
    // `os.system('ls')` reaches no host; pairing the shell-out with a binary name is what keeps the reason honest.
    expect(detectNetworkAction("python3 -c \"import os; os.system('ls -la')\"")).toBeUndefined()
    expect(
      detectNetworkAction("node -e \"require('child_process').exec('npm run build')\"")
    ).toBeUndefined()
  })

  it('leaves inline code that opens nothing alone', () => {
    expect(detectNetworkAction("python3 -c 'print(1)'")).toBeUndefined()
    expect(detectNetworkAction("node -e 'console.log(1)'")).toBeUndefined()
  })

  /*
   * The stated limit, pinned so it is a decision rather than an accident: this is a pure function and reads no
   * file, so a script file, a module or a heredoc cannot be inspected.
   */
  it('cannot see a script file, a module or a heredoc', () => {
    expect(detectNetworkAction('python3 payload.py')).toBeUndefined()
    expect(detectNetworkAction('node server.js')).toBeUndefined()
    expect(detectNetworkAction('python3 -m http.server 8000')).toBeUndefined()
    expect(detectNetworkAction("python3 - <<'EOF'\nimport socket\nEOF")).toBeUndefined()
  })
})

/* ============================================================================================== */
/* Fail closed, wrappers, negatives                                                                */
/* ============================================================================================== */

describe('fail closed when the arguments cannot be read', () => {
  // The binary is there but the target is a shell variable, so the command is treated as an action:
  // the cost of asking is one click, and the cost of guessing wrong is a probe the user never saw.
  it.each([
    ['curl "$URL"', 'fetch'],
    ['nc $TARGET $PORT', 'probe'],
    ['socat $ADDR -', 'probe'],
    ['ssh $TARGET uptime', 'remote'],
    ['dig $NAME', 'dns'],
    ['python3 -c "$CODE"', 'script']
  ])('%s is still an action (%s)', (command, kind) => {
    expect(detectNetworkAction(command)?.kind, command).toBe(kind)
  })
})

describe('wrappers are unwrapped first and judged by the payload', () => {
  it.each([
    ['timeout 12 curl -fsS https://example.com/health', 'fetch'],
    ['env X=1 nmap -p22 10.0.0.5', 'scan'],
    ["bash -c 'nc -z 10.0.0.5 22'", 'probe'],
    ['sudo -u deploy ssh root@host uptime', 'remote'],
    ["eval 'nc -z 10.0.0.5 22'", 'probe'],
    ['echo $(curl -fsS https://example.com/x)', 'fetch']
  ])('%s is classified by what it runs (%s)', (command, kind) => {
    expect(detectNetworkAction(command)?.kind, command).toBe(kind)
  })

  it('does not launder an ordinary command through a wrapper', () => {
    expect(detectNetworkAction("bash -c 'rm -rf /srv'")).toBeUndefined()
    expect(detectNetworkAction('timeout 12 ls -la /srv')).toBeUndefined()
    expect(detectNetworkAction("timeout 5 bash -c 'df -h'")).toBeUndefined()
    expect(detectNetworkAction("eval 'rm -rf /srv'")).toBeUndefined()
  })
})

describe('the negatives that keep the policy honest', () => {
  it('leaves a local file fetch alone', () => {
    expect(detectNetworkAction('curl file:///etc/passwd')).toBeUndefined()
    expect(detectNetworkAction('wget file:///tmp/data.json')).toBeUndefined()
    expect(detectNetworkAction('curl -o out.json file:///tmp/data.json')).toBeUndefined()
  })

  it('leaves a name-service binary with no name alone', () => {
    expect(detectNetworkAction('dig')).toBeUndefined()
    expect(detectNetworkAction('nslookup')).toBeUndefined()
    expect(detectNetworkAction('host')).toBeUndefined()
  })

  it('never flags a quoted or grepped mention of a network binary', () => {
    expect(detectNetworkAction("grep 'nc' /var/log/auth.log")).toBeUndefined()
    expect(detectNetworkAction('grep -rn nmap /etc')).toBeUndefined()
    expect(detectNetworkAction('echo "nmap -p22 10.0.0.5"')).toBeUndefined()
    expect(detectNetworkAction('ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519')).toBeUndefined()
  })

  it('leaves an ordinary command alone', () => {
    expect(detectNetworkAction('ls -la /srv/app')).toBeUndefined()
    expect(detectNetworkAction('ping -c 3 1.1.1.1')).toBeUndefined()
    expect(detectNetworkAction('')).toBeUndefined()
    expect(detectNetworkAction(undefined as unknown as string)).toBeUndefined()
  })
})

/* ============================================================================================== */
/* The gate, and the read-only set                                                                 */
/* ============================================================================================== */

describe('the approval gate asks about every class, before any read-only shortcut', () => {
  it('requires approval even though the scan could look read-only', () => {
    const ask = requirement(PORT_SCAN)
    expect(ask.required).toBe(true)
    expect(ask.reason).toBe('network_action')
  })

  it.each([
    'nc -zv -w 6 212.16.86.23 22',
    'nmap -p22 10.0.0.5',
    'masscan 10.0.0.0/8 -p80,443',
    'curl -fsS https://example.com/health',
    'dig +short example.com',
    'ssh root@host uptime',
    'rsync -az ./dist/ host:/srv/app',
    "python3 -c 'import socket'"
  ])('%s asks as a network action', (command) => {
    expect(requirement(command)).toEqual({ required: true, reason: 'network_action' })
  })

  it('labels a local run_command network action too, without changing whether it asks', () => {
    expect(shouldRequireApproval(local('curl https://example.com'))).toEqual({
      required: true,
      reason: 'network_action'
    })
  })

  it('does not widen what the local shell may skip', () => {
    // `run_command` asks in every mode that asks; adding the network reason must not turn a read into a skip.
    expect(shouldRequireApproval(local('ls -la'))).toEqual({
      required: true,
      reason: 'not_whitelisted'
    })
  })

  it('keeps read-only diagnostics silent — the friction fix must survive', () => {
    const ask = requirement('echo "=== SOURCE ==="; du -sh /srv/app; df -h')
    expect(ask.required).toBe(false)
    expect(ask.reason).toBe('read_only_shell')
  })

  it('still asks for a write', () => {
    expect(requirement('rm -rf /srv').reason).toBe('write')
  })
})

describe('the gate itself asks instead of auto-approving a network action', () => {
  function agentAction(command: string): AgentAction {
    return {
      id: 'a1',
      name: 'remote_shell',
      arguments: { command },
      rawArguments: JSON.stringify({ command }),
      valid: true,
      signature: `remote_shell:${command}`
    }
  }

  it('asks for a read-only-looking fetch in auto-write mode', async () => {
    // `dig` is a read by the filesystem classifier; the network class has to outrank that shortcut here,
    // in the gate, or "asked about" would only be true on paper.
    const reasons: string[] = []
    const gate = createApprovalGate({
      mode: 'auto-write',
      requestApproval: async (_action, reason) => {
        reasons.push(reason ?? 'none')
        return { approved: true }
      }
    })
    expect(await gate(agentAction('dig +short example.com'))).toBe(true)
    expect(reasons).toEqual(['network_action'])
  })

  it('still lets an ordinary read-only diagnostic through without a prompt', async () => {
    const reasons: string[] = []
    const gate = createApprovalGate({
      mode: 'auto-write',
      requestApproval: async (_action, reason) => {
        reasons.push(reason ?? 'none')
        return { approved: true }
      }
    })
    expect(await gate(agentAction('df -h'))).toBe(true)
    expect(reasons).toEqual([])
  })
})

describe('the new classes never enter the read-only set', () => {
  it('does not list any network binary as read-only', () => {
    for (const binary of [
      'nc',
      'ncat',
      'netcat',
      'socat',
      'telnet',
      'nmap',
      'masscan',
      'zmap',
      'ssh',
      'mosh',
      'scp',
      'sftp',
      'rsync'
    ]) {
      expect(READ_ONLY_BASE_COMMANDS.has(binary), binary).toBe(false)
    }
  })

  /*
   * `dig` and `curl` ARE read-only by the filesystem classifier (they name no path and write nothing). The
   * network class has to outrank that shortcut, and this is the assertion that says so out loud: the read-only
   * set was not widened, and it is not allowed to swallow the new class either.
   */
  it('asks about dig and curl even though the read-only shortcut would take them', () => {
    expect(isReadOnlyShellCommand('dig +short example.com')).toBe(true)
    expect(isReadOnlyShellCommand('curl -fsS https://example.com/health')).toBe(true)
    expect(requirement('dig +short example.com').reason).toBe('network_action')
    expect(requirement('curl -fsS https://example.com/health').reason).toBe('network_action')
    expect(requirement('dig +short example.com').required).toBe(true)
  })

  it('still calls the network probes writes when the read-only classifier is asked', () => {
    expect(isReadOnlyShellCommand('nc -z 10.0.0.5 22')).toBe(false)
    expect(isReadOnlyShellCommand('nmap -p22 10.0.0.5')).toBe(false)
    expect(isReadOnlyShellCommand('socat - TCP:203.0.113.9:22')).toBe(false)
  })
})

describe('describeNetworkTarget', () => {
  it('names one host and port compactly', () => {
    const action = detectNetworkAction('nc -z 10.0.0.5 22')
    expect(action).toBeDefined()
    expect(describeNetworkTarget(action!)).toBe('10.0.0.5:22')
  })

  it('lists several hosts and ports', () => {
    expect(
      describeNetworkTarget({ kind: 'scan', hosts: ['a', 'b'], ports: ['22', '80'], summary: '' })
    ).toBe('a, b ports 22,80')
  })

  it('returns nothing when no target could be read', () => {
    expect(describeNetworkTarget({ kind: 'fetch', hosts: [], ports: [], summary: '' })).toBe('')
  })
})
