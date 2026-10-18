/**
 * Network actions are their own class of command (v4.1; completed in B2-3).
 *
 * The app had **no concept of the network** in its approval layer. A port scan written with bash's
 * `/dev/tcp` pseudo-device was classified as an ordinary shell command, so it was either approved once as part
 * of a plan or refused by the path guard for an unrelated reason. Neither is the right answer: reaching out to
 * another host is a distinct kind of action, and it should be *stated* to the user in those words.
 *
 * This module only *detects and describes*. It never decides — `approval-gate.ts` turns a detection into a
 * prompt, so there is exactly one place where the policy lives. It is a pure function: no I/O, no clock, no
 * network, and it never reads the payload of a script file (it cannot, and pretending otherwise would be worse
 * than saying so).
 *
 * What is recognised (each one a class the reviewer can point at):
 *   1. raw TCP / port probes     `/dev/tcp`, `/dev/udp`, `nc`/`netcat`/`ncat`, `socat`, `telnet`
 *   2. scanners                  `nmap`, `masscan`, `zmap`
 *   3. HTTP clients              `curl`, `wget`, `http`/`https` (httpie)
 *   4. name services             `dig`, `nslookup`, `host`, `getent hosts`
 *   5. remote shells and copies  `ssh`, `mosh`, `scp`, `sftp`, `rsync` (with a remote spec)
 *   6. interpreter sockets       `python -c`, `node -e`, `ruby/perl -e`, `php -r` whose inline code opens a
 *                                socket (`socket`, `connect`, `urllib`, `requests`, `http.client`, …)
 *
 * Wrappers are unwrapped first and judged by their payload, exactly like the read-only classifier:
 * `timeout 12 curl …`, `env X=1 nmap …`, `bash -c 'nc …'`, `for …; do nc …; done`, `sudo -u x nc …`,
 * `sshpass -p x scp …`, and command substitution (`echo $(curl …)`).
 *
 * Deliberately NOT detected, and why:
 *   - a *local* HTTP read: `curl file:///etc/passwd`, `wget file:///x`. No host is contacted, so it is left to
 *     the normal read/write classification (a `file://` fetch is not a network action and must not prompt as
 *     one).
 *   - a name-service binary with no name: `dig`, `nslookup`, `host` with no argument. There is nothing to ask
 *     about, so it is not flagged (the binary alone is not an action).
 *   - a *mention*: `grep 'nc' /var/log`, `echo "nmap -p22 host"`. Only a command position counts, so quoting a
 *     binary in an argument never flags it.
 *   - `ping`: a read-only reachability check that is already allowed without a prompt (v4.1 decision, kept).
 *   - a *listener* is flagged but never auto-approved: `nc -l`, `socat TCP-LISTEN:` are reported because they
 *     expose a port, not because they reach another host.
 *   - *indirect* clients (`git push`, `npm install`, `docker pull`, PowerShell's `Test-NetConnection`). They
 *     reach the network, but they are already asked about as writes — the classifier's job here is to add the
 *     network *wording* to commands the read-only shortcut could otherwise wave through, not to re-label every
 *     package manager.
 *
 * The honest limits of class 6 (the case a deny-list can never catch): only inline code passed through
 * `-c` / `-e` / `-p` / `eval` on a known interpreter is inspected, and only by textual marker. A script file
 * (`python payload.py`), a module (`python -m http.server`), a heredoc on stdin, base64/`exec` obfuscation or
 * `getattr(socket, "con" + "nect")` is NOT detected: this is a pure function and cannot read a file, follow an
 * import, or evaluate code. A shell-out (`subprocess.run(['nc', …])`, `child_process.exec('curl …')`) is caught
 * only when the inline code also names a network binary, so `os.system('ls')` is not re-labelled. The same
 * applies to a network call hidden behind another program (`docker run --net host …`) — we match the binary we
 * can see, not the program it loads.
 */
import { splitTopLevel, unwrapShellWrapper } from './command-whitelist'

/** What kind of network action this is; also the noun the dialog/logs use. */
export type NetworkActionKind = 'probe' | 'scan' | 'fetch' | 'dns' | 'remote' | 'script'

export interface NetworkAction {
  kind: NetworkActionKind
  /** The binary that does the reaching, when one was recognised (`nc`, `curl`, `ssh`, `python`). */
  tool?: string
  /** Hosts the command reaches, as written (a bare IP, a name, or a shell variable). */
  hosts: string[]
  /** Ports the command names, when it names any. */
  ports: string[]
  /** One English sentence for logs and audit entries; the UI has its own translated text. */
  summary: string
}

/** How deep a wrapper chain (`env X=1 bash -c 'timeout 5 nc …'`) may nest before we stop. */
const MAX_WRAPPER_DEPTH = 6

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

const PORT_PROBE_TOOLS = new Set(['nc', 'ncat', 'netcat', 'telnet', 'socat'])
const SCANNER_TOOLS = new Set(['nmap', 'masscan', 'zmap'])
const HTTP_TOOLS = new Set(['curl', 'wget', 'http', 'https'])
const DNS_TOOLS = new Set(['dig', 'nslookup', 'host', 'getent', 'drill', 'kdig'])
const REMOTE_SHELL_TOOLS = new Set(['ssh', 'mosh'])
const REMOTE_COPY_TOOLS = new Set(['scp', 'sftp', 'rsync'])
const INTERPRETER_TOOLS = new Set([
  'python',
  'python2',
  'python3',
  'py',
  'node',
  'nodejs',
  'deno',
  'bun',
  'ruby',
  'perl',
  'php'
])

/** Commands that run *another* command; the payload is the real binary. */
const PREFIX_COMMANDS = new Set([
  'sudo',
  'doas',
  'nohup',
  'command',
  'exec',
  'time',
  'nice',
  'ionice',
  'stdbuf',
  'setsid',
  'watch',
  'env',
  'xargs',
  'sshpass',
  'eval',
  'then',
  'do',
  'else',
  '!'
])

/** Prefix flags that consume the next token as their value (`sudo -u bob nc …`). */
const PREFIX_VALUE_FLAGS = new Set(['-u', '-g', '-n', '-p', '-c', '-d', '-o', '-I', '-P', '-a'])

/** `nc` flags that consume the following token as their value. */
const NC_VALUE_FLAGS = new Set(['-w', '-i', '-p', '-s', '-q', '-T', '-t', '-o', '-x', '-I', '-M', '-O', '-P', '-X'])

/** `telnet` flags that consume the following token as their value (`telnet -l user host`). */
const TELNET_VALUE_FLAGS = new Set(['-l', '-p', '-e', '-a', '-n', '-E', '-S', '-K', '-L'])

/** Flags that make `nc` a listener or an executor rather than a probe. */
const NC_LISTEN_OR_EXEC = /^-[a-zA-Z]*[le][a-zA-Z]*$/

/** `ssh`/`mosh` flags that consume the following token as their value. */
const SSH_VALUE_FLAGS = new Set([
  '-p',
  '-P',
  '-i',
  '-o',
  '-l',
  '-F',
  '-J',
  '-b',
  '-c',
  '-D',
  '-e',
  '-L',
  '-R',
  '-W',
  '-m',
  '-O',
  '-Q',
  '-S',
  '-w',
  '-B',
  '-I',
  '-E'
])

/** `scp`/`sftp`/`rsync` flags that consume the following token as their value. */
const COPY_VALUE_FLAGS = new Set([
  '-e',
  '-P',
  '-i',
  '-o',
  '-F',
  '-c',
  '-l',
  '-T',
  '--rsh',
  '--port',
  '--include',
  '--exclude',
  '--filter',
  '--exclude-from',
  '--include-from',
  '--files-from',
  '--rsync-path',
  '--timeout',
  '--bwlimit',
  '--chmod',
  '--chown',
  '--link-dest',
  '--compare-dest',
  '--temp-dir',
  '--log-file',
  '--password-file'
])

/** `nmap`/`masscan`/`zmap` flags that consume the following token as their value. */
const SCANNER_VALUE_FLAGS = new Set([
  '--top-ports',
  '--exclude',
  '--exclude-ports',
  '--exclude-file',
  '--excludefile',
  '--rate',
  '--max-rate',
  '--min-rate',
  '--interface',
  '--source-port',
  '--max-retries',
  '--host-timeout',
  '--script',
  '--script-args',
  '--seed',
  '--shards',
  '--output-file',
  '--adapter',
  '--targets',
  '-iL',
  '-iR',
  '-oN',
  '-oX',
  '-oG',
  '-oA',
  '-e',
  '-b',
  '-S',
  '-G',
  '-D',
  '-T',
  '-t'
])

/** `dig`/`nslookup`/`host`/`getent` flags that consume the following token as their value. */
const DNS_VALUE_FLAGS = new Set([
  '-f',
  '-p',
  '-t',
  '-c',
  '-k',
  '-y',
  '-q',
  '-b',
  '-4',
  '-6',
  '--type',
  '--port',
  '--timeout',
  '--query',
  '--server',
  '--file'
])

/** `curl` flags that consume the following token as their value. */
const CURL_VALUE_FLAGS = new Set([
  '-o',
  '-H',
  '-d',
  '-F',
  '-X',
  '-u',
  '-A',
  '-e',
  '-b',
  '-c',
  '-x',
  '-w',
  '-m',
  '-T',
  '-r',
  '-K',
  '-E',
  '-Y',
  '-y',
  '-z',
  '--output',
  '--header',
  '--data',
  '--data-raw',
  '--data-binary',
  '--data-urlencode',
  '--form',
  '--form-string',
  '--request',
  '--user',
  '--user-agent',
  '--referer',
  '--cookie',
  '--cookie-jar',
  '--proxy',
  '--write-out',
  '--max-time',
  '--connect-timeout',
  '--upload-file',
  '--range',
  '--config',
  '--url',
  '--cert',
  '--key',
  '--cacert',
  '--capath',
  '--speed-limit',
  '--speed-time',
  '--retry',
  '--retry-delay',
  '--limit-rate',
  '--resolve',
  '--connect-to',
  '--interface',
  '--dns-servers',
  '--local-port',
  '--oauth2-bearer',
  '--json',
  '--proxy-user',
  '--aws-sigv4',
  '--time-cond',
  '--max-filesize'
])

/** `wget` flags that consume the following token as their value. */
const WGET_VALUE_FLAGS = new Set([
  '-O',
  '-o',
  '-P',
  '-a',
  '-t',
  '-T',
  '-w',
  '-U',
  '-e',
  '-i',
  '-B',
  '-D',
  '-A',
  '-R',
  '-I',
  '-X',
  '--output-document',
  '--output-file',
  '--directory-prefix',
  '--append-output',
  '--tries',
  '--timeout',
  '--wait',
  '--waitretry',
  '--user-agent',
  '--execute',
  '--input-file',
  '--base',
  '--domains',
  '--accept',
  '--reject',
  '--include-directories',
  '--exclude-directories',
  '--header',
  '--user',
  '--password',
  '--limit-rate'
])

/** `http`/`https` (httpie) flags that consume the following token as their value. */
const HTTPIE_VALUE_FLAGS = new Set([
  '-a',
  '-A',
  '-b',
  '-j',
  '-f',
  '-p',
  '-o',
  '-s',
  '-d',
  '-c',
  '-t',
  '-m',
  '--auth',
  '--auth-type',
  '--body',
  '--json',
  '--form',
  '--print',
  '--output',
  '--style',
  '--download',
  '--continue',
  '--timeout',
  '--max-redirects',
  '--session',
  '--verify',
  '--cert',
  '--cert-key'
])

/** HTTP methods, which httpie accepts before the URL and which are not targets. */
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'TRACE'])

/** Schemes that read a local resource; a fetch of one of these contacts no host. */
const LOCAL_SCHEMES = new Set(['file', 'data', 'about', 'blob', 'javascript'])

/** Inline-code flags per interpreter; only these are inspected (see the module comment). */
const INLINE_EVAL_FLAGS: Record<string, string[]> = {
  python: ['-c'],
  python2: ['-c'],
  python3: ['-c'],
  py: ['-c'],
  node: ['-e', '--eval', '-p', '--print'],
  nodejs: ['-e', '--eval', '-p', '--print'],
  deno: ['eval', '-e'],
  bun: ['eval', '-e'],
  ruby: ['-e'],
  perl: ['-e'],
  php: ['-r']
}

/**
 * Textual markers of a socket in inline interpreter code. Deliberately broad (a false positive costs one
 * click); it is *not* a parser and is documented as such.
 */
const SCRIPT_NETWORK =
  /\b(?:socket|socketpair|dgram|connect|open_connection|create_connection|urllib|requests|httpx?|http\.client|https\.client|net\.connect|Net::HTTP|URLConnection|tls\.connect)\b|\bconnect\s*\(|\bfetch\s*\(|\bnew\s+Socket\b/i

/** The `scheme://host[:port]` inside an inline script, for the dialog's target line. */
const SCRIPT_URL = /[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/\s'"`]+)/g

/**
 * Inline code that starts *another* process (`subprocess.run(['nc', …])`, `child_process.exec('curl …')`).
 *
 * Only counted when the payload also names a network binary, so `python -c "os.system('ls')"` stays a plain
 * command while a shell-out to `nc`/`curl`/`ssh` is caught. Without the pairing every inline `os.system` would
 * be labelled a network action and the reason would stop meaning anything.
 */
const SCRIPT_SHELL_OUT =
  /\b(?:subprocess|Popen|os\.system|popen|child_process|spawnSync|execSync|spawn|exec)\b/i

/** A network binary named *anywhere* in inline code — used only to qualify {@link SCRIPT_SHELL_OUT}. */
const NETWORK_BINARY_WORD =
  /\b(?:nc|ncat|netcat|nmap|masscan|zmap|curl|wget|ssh|scp|sftp|rsync|mosh|telnet|socat|dig|nslookup|getent)\b/i

interface Accumulator {
  detected: boolean
  kinds: Set<NetworkActionKind>
  tool?: string
  hosts: Set<string>
  ports: Set<string>
  socketHits: number
  scanner: boolean
}

function createAccumulator(): Accumulator {
  return {
    detected: false,
    kinds: new Set<NetworkActionKind>(),
    hosts: new Set<string>(),
    ports: new Set<string>(),
    socketHits: 0,
    scanner: false
  }
}

function record(acc: Accumulator, kind: NetworkActionKind, tool: string): void {
  acc.detected = true
  acc.kinds.add(kind)
  if (acc.tool === undefined) acc.tool = tool
}

function addHost(acc: Accumulator, value: string): void {
  const host = unquote(value)
  if (host !== '') acc.hosts.add(host)
}

function addPort(acc: Accumulator, value: string): void {
  const port = unquote(value)
  if (/^\d+$/.test(port) && port !== '0') acc.ports.add(port)
}

/** Strip one layer of matching quotes from a token or a wrapper payload. */
function unquote(value: string): string {
  let text = value.trim()
  while (
    text.length >= 2 &&
    (text[0] === '"' || text[0] === "'") &&
    text[text.length - 1] === text[0]
  ) {
    text = text.slice(1, -1)
  }
  return text
}

/** The executable's basename, so `/usr/bin/nc` and `./nc` both match `nc`. */
function baseName(token: string): string {
  const cleaned = unquote(token)
    .replace(/^[("'`]+/, '')
    .replace(/[)"'`,;]+$/, '')
  const parts = cleaned.split(/[\\/]/)
  return (parts[parts.length - 1] ?? '').toLowerCase()
}

/**
 * True when a token cannot be resolved without running the shell (`$HOST`, `$(dig …)`, %VAR%).
 *
 * This is the fail-closed trigger: the binary is there but the target is unreadable, so the command is treated
 * as an action. The cost of asking is one click.
 */
function looksDynamic(token: string): boolean {
  return /[$`]/.test(token) || /%[A-Za-z_][A-Za-z0-9_]*%/.test(token)
}

function isEnvAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)
}

/**
 * Index of the token that is actually executed, skipping environment assignments and prefix commands
 * (`sudo -u bob nc …` ⇒ the `nc` index). `-1` when the segment runs nothing.
 */
function commandIndex(tokens: string[]): number {
  let index = 0
  while (index < tokens.length) {
    const token = tokens[index]!
    if (isEnvAssignment(token)) {
      index += 1
      continue
    }
    if (!PREFIX_COMMANDS.has(baseName(token))) return index
    index += 1
    while (index < tokens.length && tokens[index]!.startsWith('-')) {
      if (PREFIX_VALUE_FLAGS.has(tokens[index]!)) index += 1
      index += 1
    }
  }
  return -1
}

/** Command substitutions and backticks, whose bodies are commands too (`echo $(curl …)`). */
function substitutions(text: string): string[] {
  const found: string[] = []
  for (const match of text.matchAll(/\$\(([^()]*)\)|`([^`]*)`/g)) {
    const inner = (match[1] ?? match[2] ?? '').trim()
    if (inner !== '') found.push(inner)
  }
  return found
}

/** Parse the target of an HTTP client into a host/port, or say it is a local resource. */
function parseHttpTarget(target: string): { host: string; port: string; local: boolean } | undefined {
  if (/^(?:file|data|about|blob|javascript):/i.test(target)) return { host: '', port: '', local: true }

  let rest = target
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(rest)
  if (scheme) {
    const name = scheme[1]!.toLowerCase()
    rest = rest.slice(scheme[0].length)
    if (LOCAL_SCHEMES.has(name)) return { host: '', port: '', local: true }
  }

  // httpie's `:3000/path` means "localhost on that port".
  if (rest.startsWith(':')) {
    const port = /^:(\d{1,5})/.exec(rest)?.[1] ?? ''
    return { host: 'localhost', port, local: false }
  }

  rest = rest.split(/[/?#]/)[0] ?? ''
  const at = rest.lastIndexOf('@')
  if (at >= 0) rest = rest.slice(at + 1)
  if (rest.startsWith('[')) {
    const end = rest.indexOf(']')
    if (end > 0) {
      return {
        host: rest.slice(1, end),
        port: rest.slice(end + 1).replace(/^:/, ''),
        local: false
      }
    }
  }
  const separator = rest.indexOf(':')
  if (separator === -1) return { host: rest, port: '', local: false }
  return { host: rest.slice(0, separator), port: rest.slice(separator + 1), local: false }
}

/** `nc`/`netcat`/`ncat`/`telnet`: a single host (and usually a port). */
function probeTool(tool: string, args: string[], acc: Accumulator): void {
  // Only the netcat family has `-l`/`-e`/`-c`; `telnet -l user host` is a login flag, not a listener.
  const listener =
    tool !== 'telnet' && args.some((argument) => NC_LISTEN_OR_EXEC.test(unquote(argument)))
  const valueFlags = tool === 'telnet' ? TELNET_VALUE_FLAGS : NC_VALUE_FLAGS
  const positional: string[] = []
  let dynamic = false

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!
    if (looksDynamic(argument)) dynamic = true
    if (argument.startsWith('-')) {
      if (valueFlags.has(unquote(argument))) index += 1
      continue
    }
    positional.push(argument)
  }

  const [host, port] = positional
  if (!listener && host === undefined && !dynamic) return
  record(acc, 'probe', tool)
  // A listener exposes a port rather than reaching another host; still recorded, but it names no target.
  if (listener) return
  if (host !== undefined) addHost(acc, host)
  if (port !== undefined) addPort(acc, port)
}

/** `socat - TCP:host:port` / `socat TCP-LISTEN:4444 -`: read the address families it names. */
function socatTool(tool: string, args: string[], acc: Accumulator): void {
  let network = false
  let listener = false
  const hosts: string[] = []
  const ports: string[] = []

  for (const argument of args) {
    const address = unquote(argument)
    if (looksDynamic(address)) {
      network = true
      continue
    }
    const match =
      /^(?:TCP|TCP4|TCP6|UDP|UDP4|UDP6|SCTP|SCTP4|SSL|OPENSSL|IP|IP4|IP6)(-LISTEN|-CONNECT)?:([^,]+)/i.exec(
        address
      )
    if (!match) continue
    network = true
    if ((match[1] ?? '').toUpperCase() === '-LISTEN') {
      listener = true
      continue
    }
    const [host, port] = (match[2] ?? '').split(':')
    if (host !== undefined && host !== '') hosts.push(host)
    if (port !== undefined) ports.push(port)
  }

  if (!network) return
  record(acc, 'probe', tool)
  if (listener) return
  hosts.forEach((host) => addHost(acc, host))
  ports.forEach((port) => addPort(acc, port))
}

/** `nmap`/`masscan`/`zmap`: always a scan; the target may be a CIDR or a list file. */
function scannerTool(tool: string, args: string[], acc: Accumulator): void {
  acc.scanner = true
  let target: string | undefined
  let opaqueTarget = false
  const ports: string[] = []

  for (let index = 0; index < args.length; index += 1) {
    const argument = unquote(args[index]!)
    if (looksDynamic(argument)) opaqueTarget = true
    if (argument === '-p' || argument === '--ports') {
      const value = args[index + 1]
      if (value !== undefined) {
        ports.push(...unquote(value).split(','))
        index += 1
      }
      continue
    }
    if (/^-p./.test(argument)) {
      ports.push(...argument.slice(2).split(','))
      continue
    }
    if (argument.startsWith('-')) {
      if (SCANNER_VALUE_FLAGS.has(argument)) index += 1
      continue
    }
    if (target === undefined) target = argument
  }

  if (target === undefined && !opaqueTarget) return
  record(acc, 'scan', tool)
  if (target !== undefined) addHost(acc, target)
  ports.forEach((port) => addPort(acc, port))
}

/** `curl`, `wget`, httpie: a network action when it names something that is not a local resource. */
function httpTool(tool: string, args: string[], acc: Accumulator): void {
  const valueFlags =
    tool === 'wget' ? WGET_VALUE_FLAGS : tool === 'http' || tool === 'https' ? HTTPIE_VALUE_FLAGS : CURL_VALUE_FLAGS
  const targets: string[] = []
  let opaque = false

  for (let index = 0; index < args.length; index += 1) {
    const raw = args[index]!
    const argument = unquote(raw)
    if (looksDynamic(argument)) {
      opaque = true
      continue
    }
    if (argument === '-') continue
    if (argument === '--url') {
      // curl's long form: the URL is the *next* token, so it is a target rather than a flag value.
      const next = args[index + 1]
      if (next !== undefined) {
        targets.push(unquote(next))
        index += 1
      }
      continue
    }
    if (argument.startsWith('-')) {
      const equals = argument.indexOf('=')
      if (equals > 0) {
        // `--url=https://…`: the URL is attached to the flag.
        if (valueFlags.has(argument.slice(0, equals))) targets.push(argument.slice(equals + 1))
        continue
      }
      if (valueFlags.has(argument)) index += 1
      continue
    }
    targets.push(argument)
  }

  // httpie allows the method before the URL (`http GET example.com`); the method is not a target.
  if ((tool === 'http' || tool === 'https') && targets.length > 0) {
    if (HTTP_METHODS.has((targets[0] ?? '').toUpperCase())) targets.shift()
  }

  let network = false
  let local = false
  const hosts: string[] = []
  const ports: string[] = []
  for (const target of targets) {
    const parsed = parseHttpTarget(target)
    if (parsed === undefined) continue
    if (parsed.local) {
      local = true
      continue
    }
    network = true
    if (parsed.host !== '') hosts.push(parsed.host)
    if (parsed.port !== '') ports.push(parsed.port)
  }

  // `curl file:///etc/passwd` names only a local resource, so it is a read, not a network action.
  if (!network && local) return
  // No target at all and nothing unreadable: the client is being asked for its usage, not a host.
  if (!network && !opaque) return
  record(acc, 'fetch', tool)
  hosts.forEach((host) => addHost(acc, host))
  ports.forEach((port) => addPort(acc, port))
}

/** `dig`, `nslookup`, `host`, `getent hosts`. */
function dnsTool(tool: string, args: string[], acc: Accumulator): void {
  if (tool === 'getent') {
    if (unquote(args[0] ?? '') !== 'hosts') return
    const name = args.slice(1).find((argument) => !argument.startsWith('-'))
    if (name === undefined) return
    record(acc, 'dns', tool)
    addHost(acc, name)
    return
  }

  let name: string | undefined
  let server: string | undefined
  let dynamic = false
  let fromFile = false

  for (let index = 0; index < args.length; index += 1) {
    const argument = unquote(args[index]!)
    if (looksDynamic(argument)) dynamic = true
    if (argument.startsWith('+')) continue
    if (argument.startsWith('@')) {
      server = argument.slice(1)
      continue
    }
    if (argument.startsWith('-')) {
      if (argument === '-f') fromFile = true
      if (DNS_VALUE_FLAGS.has(argument)) index += 1
      continue
    }
    if (name === undefined) name = argument
  }

  if (name === undefined && server === undefined && !fromFile && !dynamic) return
  record(acc, 'dns', tool)
  if (name !== undefined) addHost(acc, name)
  if (server !== undefined) addHost(acc, server)
}

/** `ssh`, `mosh`: a remote session or a remote command, always a remote action. */
function remoteShellTool(tool: string, args: string[], acc: Accumulator): void {
  let host: string | undefined
  let port: string | undefined
  let dynamic = false

  for (let index = 0; index < args.length; index += 1) {
    const argument = unquote(args[index]!)
    if (looksDynamic(argument)) dynamic = true
    if (argument.startsWith('-')) {
      if ((argument === '-p' || argument === '-P') && /^\d+$/.test(args[index + 1] ?? '')) {
        port = args[index + 1]
        index += 1
        continue
      }
      if (SSH_VALUE_FLAGS.has(argument)) index += 1
      continue
    }
    if (host === undefined) host = argument
  }

  if (host === undefined && !dynamic) return
  record(acc, 'remote', tool)
  if (host !== undefined) {
    const at = host.lastIndexOf('@')
    addHost(acc, at >= 0 ? host.slice(at + 1) : host)
  }
  if (port !== undefined) addPort(acc, port)
}

/** `scp`, `sftp`, `rsync`: only a copy that names a remote side (`host:/path`, `user@host:path`). */
function remoteCopyTool(tool: string, args: string[], acc: Accumulator): void {
  let remote = false
  let dynamic = false
  const hosts: string[] = []

  for (let index = 0; index < args.length; index += 1) {
    const argument = unquote(args[index]!)
    if (looksDynamic(argument)) {
      dynamic = true
      continue
    }
    if (argument.startsWith('-')) {
      if (COPY_VALUE_FLAGS.has(argument)) index += 1
      continue
    }
    // A Windows drive path (`C:\dst`, `C:/dst`) is local, not `host:path`.
    if (/^[A-Za-z]:[\\/]/.test(argument)) continue
    const scheme = /^(?:rsync|ssh|sftp):\/\/([^/\s]+)/i.exec(argument)
    if (scheme) {
      remote = true
      const host = (scheme[1] ?? '').split('@').pop() ?? ''
      if (host !== '') hosts.push(host)
      continue
    }
    // `sftp user@host` names a remote side without a path.
    const bare = /^[^@/\s]+@([A-Za-z0-9_.-]+)$/.exec(argument)
    if (bare) {
      remote = true
      const host = bare[1] ?? ''
      if (host !== '') hosts.push(host)
      continue
    }
    const match = /^(?:[^@/\s]+@)?([A-Za-z0-9_.:[\]-]+):/.exec(argument)
    if (match) {
      remote = true
      const host = (match[1] ?? '').replace(/^\[/, '').replace(/\]$/, '')
      if (host !== '' && !/^[A-Za-z]$/.test(host)) hosts.push(host)
    }
  }

  if (!remote && !dynamic) return
  record(acc, 'remote', tool)
  hosts.forEach((host) => addHost(acc, host))
}

/** `python -c`, `node -e`, …: only inline code is inspected (see the module comment for the limits). */
function interpreterTool(tool: string, args: string[], acc: Accumulator): void {
  const flags = INLINE_EVAL_FLAGS[tool] ?? []
  let payload: string | undefined

  for (let index = 0; index < args.length; index += 1) {
    const argument = unquote(args[index]!)
    const isEval =
      flags.includes(argument) ||
      (flags.includes('-e') && /^-[A-Za-z]*e[A-Za-z]*$/.test(argument))
    if (!isEval) continue
    const code = args.slice(index + 1).join(' ').trim()
    if (code !== '') payload = code
    break
  }

  if (payload === undefined) return
  const shellOutToNetwork = SCRIPT_SHELL_OUT.test(payload) && NETWORK_BINARY_WORD.test(payload)
  if (!looksDynamic(payload) && !SCRIPT_NETWORK.test(payload) && !shellOutToNetwork) return

  record(acc, 'script', tool)
  for (const match of payload.matchAll(SCRIPT_URL)) {
    const hostPort = match[1] ?? ''
    const [host = '', port = ''] = hostPort.split(':')
    if (host !== '') addHost(acc, host)
    if (port !== '') addPort(acc, port)
  }
}

/** Classify one command position; `false` means "not mine, look for a wrapper instead". */
function classifyBinary(binary: string, args: string[], acc: Accumulator): boolean {
  if (PORT_PROBE_TOOLS.has(binary)) {
    if (binary === 'socat') socatTool(binary, args, acc)
    else probeTool(binary, args, acc)
    return true
  }
  if (SCANNER_TOOLS.has(binary)) {
    scannerTool(binary, args, acc)
    return true
  }
  if (HTTP_TOOLS.has(binary)) {
    httpTool(binary, args, acc)
    return true
  }
  if (DNS_TOOLS.has(binary)) {
    dnsTool(binary, args, acc)
    return true
  }
  if (REMOTE_SHELL_TOOLS.has(binary)) {
    remoteShellTool(binary, args, acc)
    return true
  }
  if (REMOTE_COPY_TOOLS.has(binary)) {
    remoteCopyTool(binary, args, acc)
    return true
  }
  if (INTERPRETER_TOOLS.has(binary)) {
    interpreterTool(binary, args, acc)
    return true
  }
  return false
}

/**
 * Walk a command, statement by statement and stage by stage, unwrapping a wrapper into its payload.
 *
 * `unwrapShellWrapper` returns `undefined` for something that is not a wrapper, and the payload is walked
 * again — so `timeout 12 curl …`, `bash -c 'nc …'` and `env X=1 nmap …` are judged by what they run, exactly
 * like the read-only classifier. Recursion is bounded.
 */
function analyse(command: string, depth: number, acc: Accumulator): void {
  if (depth > MAX_WRAPPER_DEPTH) return

  for (const statement of splitTopLevel(command, [';', '\n', '&&', '||'])) {
    for (const stage of splitTopLevel(statement, ['|'])) {
      const text = stage.trim()
      if (text === '') continue
      const tokens = text.split(/\s+/).filter(Boolean)
      const at = commandIndex(tokens)
      const binary = at >= 0 ? baseName(tokens[at]!) : ''
      const args = at >= 0 ? tokens.slice(at + 1) : []
      const handled = binary !== '' && classifyBinary(binary, args, acc)

      if (!handled) {
        const inner = unwrapShellWrapper(text)
        if (inner !== undefined) analyse(unwrapQuotedPayload(inner), depth + 1, acc)
      }

      // `find . -exec nc -z host 22 \;` runs a command we would otherwise miss.
      for (let index = 1; index < tokens.length; index += 1) {
        const marker = baseName(tokens[index]!)
        if (marker !== '-exec' && marker !== '-execdir' && marker !== '-ok') continue
        const rest = tokens.slice(index + 1)
        const execAt = commandIndex(rest)
        if (execAt < 0) continue
        classifyBinary(baseName(rest[execAt]!), rest.slice(execAt + 1), acc)
      }

      for (const inner of substitutions(text)) analyse(inner, depth + 1, acc)
    }
  }
}

/**
 * Remove the quotes a wrapper put around its payload (v4.1 read-only handling, reused here).
 *
 * The opening quote must be first, but the closing one need not be last: a redirection can follow it
 * (`'nc -z host 22' 2>&1`). Whatever trails the closing quote is kept, so a real trailing command still counts.
 */
function unwrapQuotedPayload(text: string): string {
  const quote = text[0]
  if (quote !== "'" && quote !== '"') return text.trim()
  const close = text.indexOf(quote, 1)
  if (close === -1) return text.trim()
  const inner = text.slice(1, close)
  const rest = text.slice(close + 1).trim()
  return (rest === '' ? inner : `${inner} ${rest}`).trim()
}

export function detectNetworkAction(command: string): NetworkAction | undefined {
  if (typeof command !== 'string' || command.trim() === '') return undefined

  const acc = createAccumulator()

  // `/dev/tcp` / `/dev/udp` are read anywhere: they are the pseudo-device, not a command.
  for (const match of command.matchAll(DEV_SOCKET)) {
    acc.socketHits += 1
    const host = match[1] ?? ''
    const port = match[2] ?? ''
    if (host !== '') addHost(acc, host)
    if (port !== '') addPort(acc, port)
  }

  analyse(command, 0, acc)

  if (!acc.detected && acc.socketHits === 0) return undefined

  // Read the literals out of a loop header, so the summary names real ports instead of a shell variable.
  const loopList = FOR_LIST.exec(command)?.[1]
  if (loopList !== undefined) {
    for (const token of loopList.split(/\s+/)) addPort(acc, token)
  }

  const scanning = acc.scanner || LOOP.test(command) || acc.socketHits > 1 || acc.ports.size > 3
  const kinds = acc.kinds
  const kind: NetworkActionKind = scanning
    ? 'scan'
    : kinds.has('script')
      ? 'script'
      : kinds.has('fetch')
        ? 'fetch'
        : kinds.has('dns')
          ? 'dns'
          : kinds.has('remote')
            ? 'remote'
            : 'probe'

  const hostList = [...acc.hosts]
  const portList = [...acc.ports]
  const tool = acc.tool
  const summary =
    `${kind}${tool !== undefined ? ` ${tool}` : ''}` +
    `${hostList.length > 0 ? ` ${hostList.join(',')}` : ''}` +
    `${portList.length > 0 ? ` ports ${portList.join(',')}` : ''}`

  const action: NetworkAction = { kind, hosts: hostList, ports: portList, summary }
  if (tool !== undefined) action.tool = tool
  return action
}

/**
 * A short, human-readable target for the approval dialog: `host:port`, `host1, host2 ports 22,80`, or `''`
 * when the command's arguments were too dynamic to name one.
 */
export function describeNetworkTarget(action: NetworkAction): string {
  const hosts = action.hosts.slice(0, 4)
  const ports = action.ports.slice(0, 6)
  if (hosts.length === 0) return ''
  if (hosts.length === 1 && ports.length === 1) return `${hosts[0]}:${ports[0]}`
  const suffix = ports.length > 0 ? ` ports ${ports.join(',')}` : ''
  return `${hosts.join(', ')}${suffix}`
}

/** True when the command reaches another host in a way this module recognises. */
export function isNetworkAction(command: string): boolean {
  return detectNetworkAction(command) !== undefined
}
