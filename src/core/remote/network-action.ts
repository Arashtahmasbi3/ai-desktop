/**
 * Network actions are their own class of command (v4.1).
 *
 * The app had **no concept of the network** in its approval layer. A port scan written with bash's
 * `/dev/tcp` pseudo-device was classified as an ordinary shell command, so it was either approved once as part
 * of a plan or refused by the path guard for an unrelated reason. Neither is the right answer: reaching out to
 * another host is a distinct kind of action, and it should be *stated* to the user in those words.
 *
 * This module only *detects and describes*. It never decides — `approval-gate.ts` turns a detection into a
 * prompt, so there is exactly one place where the policy lives.
 *
 * Deliberately NOT detected here:
 *   - `curl` / `wget`: already governed as read-only fetches, and flagging them would make every web lookup
 *     prompt again — the friction this round exists to remove.
 *   - `ping`: a read-only reachability check that is already allowed without a prompt.
 *   - `ssh`: a shell session is a write-class action on its own and is already gated as one.
 */
export type NetworkActionKind = 'probe' | 'scan'

export interface NetworkAction {
  kind: NetworkActionKind
  /** Hosts the command reaches, as written (a bare IP or a name). */
  hosts: string[]
  /** Ports the command names, when it names any. */
  ports: string[]
  /** One English sentence for logs and audit entries; the UI has its own translated text. */
  summary: string
}

/** `nc`/`ncat`/`netcat`/`nmap`/`telnet` used as a command in some segment. */
const NETWORK_TOOLS = /(?:^|[\s;&|(])(nc|ncat|netcat|nmap|telnet)(?=[\s;&|)]|$)/i

/** Bash's `/dev/tcp/host/port` (and the udp variant) — the usual way a scan sneaks in. */
const DEV_SOCKET = /\/dev\/(?:tcp|udp)\/([^/\s'"`]+)\/([^\s'"`;|&)]+)/gi

/** A shell loop around a probe is a scan by construction. */
const LOOP = /(?:^|[\s;&|(])(?:for|while|until)\b/i

/**
 * The literal list of a `for` loop, which is where a scan's ports usually are.
 *
 * `for p in 22 80 443; do … >/dev/tcp/host/$p` names the ports in the header and uses a variable in the body,
 * so reading the body alone yields `$p`.
 */
const FOR_LIST = /\bfor\s+\w+\s+in\s+([^;]+);/

/** Flags that make `nc` a listener or an executor rather than a probe. */
const NC_LISTEN_OR_EXEC = /^-(?:l|e|c)$/

/**
 * `nc` flags that consume the following token as their value.
 *
 * Without this, `nc -zv -w 6 HOST 22` parsed `6` as the host — the timeout was mistaken for the target.
 */
const NC_OPTIONS_WITH_VALUE = /^-(?:w|i|p|s|q|T|t|o|x|I|M|O|P|X)$/

function unquote(value: string): string {
  return value.replace(/^['"]/, '').replace(/['"]$/, '')
}

/** Split on top-level separators, so a flag inside quotes is not mistaken for one. */
function segments(command: string): string[] {
  return command.split(/(?:&&|\|\||;|\|)/)
}

function tokensOf(segment: string): string[] {
  return segment.trim().split(/\s+/).filter(Boolean)
}

export function detectNetworkAction(command: string): NetworkAction | undefined {
  if (typeof command !== 'string' || command.trim() === '') return undefined

  const hosts = new Set<string>()
  const ports = new Set<string>()
  let socketHits = 0
  let sawTool = false
  let toolLoops = false

  for (const segment of segments(command)) {
    for (const match of segment.matchAll(DEV_SOCKET)) {
      socketHits += 1
      const host = unquote(match[1] ?? '')
      const port = match[2] ?? ''
      if (host !== '') hosts.add(host)
      if (port !== '' && port !== '0' && /^\d+$/.test(port)) ports.add(port)
    }
    // Re-scan without the pseudo-device so `/dev/tcp` is not read as the `nc` tool.
    if (!NETWORK_TOOLS.test(segment)) continue
    const tokens = tokensOf(segment)
    const toolAt = tokens.findIndex((token) => /^(nc|ncat|netcat|nmap|telnet)$/i.test(token))
    if (toolAt === -1) continue
    const tool = tokens[toolAt]!.toLowerCase()
    const args = tokens.slice(toolAt + 1)
    // A listener or an exec is not a probe, but it still reaches the network — describe it as a probe and let
    // the deny list have the final say on `-e`.
    if (args.some((argument) => NC_LISTEN_OR_EXEC.test(argument))) {
      sawTool = true
      continue
    }
    sawTool = true
    // Walk the arguments with their flags, so a flag's value is never read as the target.
    const positional: string[] = []
    for (let at = 0; at < args.length; at += 1) {
      const argument = args[at]!
      if (argument.startsWith('-')) {
        if (NC_OPTIONS_WITH_VALUE.test(argument)) at += 1
        continue
      }
      positional.push(argument)
    }
    if (tool === 'nmap') {
      const target = positional[0]
      if (target !== undefined) hosts.add(unquote(target))
      if (LOOP.test(command)) toolLoops = true
    } else if (tool !== 'telnet') {
      const [host, port] = positional
      if (host !== undefined) hosts.add(unquote(host))
      // A port may be a shell variable in a loop; keep it only when it is a real number.
      if (port !== undefined && /^\d+$/.test(port)) ports.add(port)
    } else {
      const host = positional[0]
      if (host !== undefined) hosts.add(unquote(host))
    }
  }

  if (socketHits === 0 && !sawTool) return undefined

  // Read the literals out of a loop header, so the summary names real ports instead of a shell variable.
  const loopList = FOR_LIST.exec(command)?.[1]
  if (loopList) {
    for (const token of loopList.split(/\s+/)) {
      if (/^\d+$/.test(token)) ports.add(token)
    }
  }

  const scanning =
    LOOP.test(command) || toolLoops || socketHits > 1 || ports.size > 3 || /nmap/i.test(command)
  const kind: NetworkActionKind = scanning ? 'scan' : 'probe'
  const portList = [...ports]
  const hostList = [...hosts]
  const summary =
    hostList.length === 0
      ? `${kind} (no host parsed)`
      : `${kind} ${hostList.join(',')}${portList.length > 0 ? ` ports ${portList.join(',')}` : ''}`

  return { kind, hosts: hostList, ports: portList, summary }
}

/** True when the command reaches another host in a way this module recognises. */
export function isNetworkAction(command: string): boolean {
  return detectNetworkAction(command) !== undefined
}
