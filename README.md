# AI Desktop

An Electron desktop AI assistant — a local, Codex-like companion that connects to the
DeepSeek API, VPS servers (SSH), GitHub (Git), and your local files.

> Status: **v2.6.5 (in development; latest release v2.6.4)**. A Codex-like agent workspace:
> provider-agnostic LLM
> adapters (OpenAI/Anthropic/DeepSeek/Google), the `SandboxManager` code-execution layer, the
> `AgentOrchestrator` Planning → Execution → Observation → Reflection loop, token-budgeted
> context/session state, and the full renderer UI (chat, tasks/logs, workspace explorer + code
> viewer with diff, internal browser, GitHub, VPS/SSH remote, status bar), plus a
> background worker queue, a localhost remote-access server and Windows packaging.
>
> **Install note:** `npm install` alone may leave Electron without its binary on npm versions
> that block dependency install scripts. If `node_modules/electron/path.txt` is missing, run
> `node node_modules/electron/install.js` before `npm run dev`.
>
> **Platform note:** the agent writes POSIX shell commands, so the local sandbox prefers a real
> POSIX shell on Windows (Git for Windows' `bash.exe`). Without one it falls back to `cmd.exe`,
> where those commands cannot run — install Git for Windows or use Docker.
>
> **Updates:** the app ships without an auto-updater (`publish: null`, no `electron-updater`
> dependency), so a new version means downloading a fresh installer from the Releases page.
> Enabling in-app updates needs an update server (or a GitHub Releases publish provider) and a
> signed build first — see `KNOWN_ISSUES.md`.
>
> v2.3 adds a Codex-style workspace (redesigned sidebar, composer and Settings), an approval
> system that learns (remembered tools, inline full-access toggle), a file-changes panel with
> diff review, chat templates, an in-chat code block runner, session fork, voice input,
> multi-window (`Ctrl+Shift+N`) and a progress timeline — see
> [`TESTING_GUIDE_v2.3.md`](./TESTING_GUIDE_v2.3.md) and
> [`FINAL_REPORT_v2.3.md`](./FINAL_REPORT_v2.3.md).

## Requirements

- Node.js 20 LTS or newer (tested on Node 24)
- npm 10+
- Windows 10/11 for the NSIS installer target (dev works cross-platform)

## Install (Windows)

> **v2.0.0 is a pre-release and the build is unsigned** — expect a SmartScreen warning; see
> [`KNOWN_ISSUES_v2.0.0.md`](./KNOWN_ISSUES_v2.0.0.md) and
> [`TESTING_GUIDE_v2.0.0.md`](./TESTING_GUIDE_v2.0.0.md).

Download `AI Desktop Setup 2.0.0.exe` from the
[Releases](https://github.com/Arashtahmasbi3/ai-desktop/releases) page and run it. The
installer is per-user, lets you choose the install directory, and creates desktop and
start-menu shortcuts. A standalone `AI Desktop 2.0.0 Portable.exe` is also published — no
installation required.

On first launch, open **Settings** and add a DeepSeek (or OpenAI/Anthropic/Google) API key;
keys are encrypted with the OS keystore and stored locally.

## Getting started

```bash
npm install
npm run dev     # opens the Electron window
```

On first run a short onboarding wizard suggests a model, then points you at Settings
(`Ctrl+,`) to add a provider key and your first project folder.

## What's new in v2.0

- **VPS / Remote** (Ctrl+6) — add SSH servers (key or password), connect with mandatory
  host-key verification, run a live xterm terminal, browse/edit files over SFTP, and let the
  agent run guarded commands. Every command is rate-limited (100/min), checked against a
  dangerous-command deny list, audited to JSON, and connections auto-disconnect after 30
  minutes idle. Secrets are encrypted with `safeStorage`; private keys are referenced by path.

### v1.3

- **GitHub** (Ctrl+5) — connect with an OAuth App client ID (device flow, token stored
  encrypted), commit/pull/push the active project, and browse your pull requests and issues.

### v1.2

- **Split diff** — compare the working draft against the file on disk side by side.
- **Markdown preview** — render `.md` files next to their source.
- **Internal browser** (Ctrl+4) — a sandboxed webview with URL bar and history, limited to `http(s)`.

### v1.1

- **Model switcher** in the chat header — pick the provider/model (or a custom provider) per message.
- **Central model catalog** (`src/shared/models.ts`) shared by the chat picker and Settings.
- **Custom providers** — any OpenAI-compatible endpoint, with an encrypted key and a live
  “Test connection”.
- **Onboarding wizard** for first-run setup.

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Run the app in development (HMR) |
| `npm run build` | Build main/preload/renderer to `out/` |
| `npm run typecheck` | Type-check the Node and Web TypeScript projects |
| `npm test` | Run the test suite (Vitest) |
| `npm test:e2e` | Run only the end-to-end suite (`vitest run test/e2e`) |
| `npm run pack` | Build an unpacked app with electron-builder (into `release/`) |
| `npm run build:win` | Package the Windows NSIS installer + portable exe into `release/` |

## Project layout

```
src/
  main/       Electron main process (window, IPC, safeStorage cipher)
  preload/    contextBridge bridge (window.api)
  shared/     provider-agnostic LLM + sandbox + agent types
  core/       LLM adapters + sandbox module + agent orchestrator & context/state
  renderer/   React UI (Vazirmatn, RTL, dark theme)
test/         Vitest tests
```

### LLM adapters

```ts
import { createAdapterForConfig } from '@core/llm-adapters'

const adapter = createAdapterForConfig({ provider: 'deepseek', apiKey, model: 'deepseek-chat' })

const stream = adapter.streamChat({ model: 'deepseek-chat', messages, tools }, { apiKey, model })
for await (const event of stream) {
  if (event.type === 'text') process.stdout.write(event.text)
}
```

### Code sandbox

```ts
import { SandboxManagerImpl } from '@core/sandbox'

const manager = new SandboxManagerImpl({ maxSandboxes: 4 })
const { id } = await manager.createSandbox()            // Docker if available, else fallback

await manager.executeCommand(id, 'echo hello')
await manager.writeFile(id, 'app.js', 'console.log(1)')
await manager.executeCommand(id, 'node app.js')
await manager.destroySandbox(id)
await manager.dispose()
```

Docker sandboxes run with `--network none` (default), a read-only root filesystem, CPU/
memory/PID limits, and only a dedicated workspace bind-mount is writable. Without Docker,
`WindowsSandboxDriver` (Windows) or `LocalSandboxDriver` is used — that path is a
convenience fallback and **not** a security boundary.

### Agent orchestrator

```ts
import { AgentOrchestrator } from '@core/agent-orchestrator'

const agent = new AgentOrchestrator({
  sandbox: manager,
  providers: [{ provider: 'deepseek', adapter, config: { apiKey, model: 'deepseek-chat' } }]
})

const result = await agent.run('Create a Node script that prints the first 10 primes and run it.')
console.log(result.status, result.finalAnswer, result.steps.length, result.warnings)
```

The orchestrator loops Planning → Execution → Observation → Reflection: it asks the model
for the next tool call, runs it in the sandbox (`write_file`, `read_file`, `list_dir`,
`run_command`), feeds the observation back and stops when the model answers without tool
calls. It warns after an action is repeated more than three times, pauses with
`needs_input` after repeated no-progress steps, retries transient sandbox failures and
falls back to the next provider on auth/config errors. Pass an `AbortSignal` via
`agent.run(task, { signal })` to cancel.

For a complex goal the orchestrator plans before it acts: `TaskPlanner` splits the goal
into ordered steps, emits `task:plan` / `task:step` events that drive the in-chat task
tracker, and runs each step in turn. When the loop guard would stop a stuck run, it now
returns a `redirect` carrying a concrete alternative from the strategy table
(`src/core/agent/strategies.ts`) — the blocked call is never executed, and the model is
told what to try instead. Only repeating the redirected call verbatim is a hard stop.

### Context, sessions and settings

The orchestrator keeps the prompt inside a token budget and compacts history automatically:

```ts
import { AgentOrchestrator, createAdapterSummarizer } from '@core/agent-orchestrator'
import { FileSessionStore, Persistence, resolveUserDataDir } from '@core/agent'

const agent = new AgentOrchestrator({
  sandbox: manager,
  providers: [{ provider: 'deepseek', adapter, config }],
  contextWindowTokens: 32_000,   // default: provider contextWindow − max output
  compactionThreshold: 0.8,      // compact at 80% of the budget
  summarizer: createAdapterSummarizer({ provider: 'deepseek', adapter, config }),
  sessionStore: new FileSessionStore(`${resolveUserDataDir({ appName: 'AI Desktop' })}/sessions`),
  sessionId: 'chat-1'
})

await agent.run('Refactor src/app.ts')

// After an app restart, resume the stored conversation:
await agent.run('Continue', { resumeSessionId: 'chat-1' })
```

Old messages may also be compressed (comments/blank lines stripped, duplicate code blocks
dropped) before being sent; the stored history is untouched. API keys are encrypted with the
OS keystore (`safeStorage`) via `Persistence` and never written in plaintext:

```ts
import { Persistence } from '@core/agent'
import { createSafeStorageCipher } from '@main/secure-cipher'

const settings = new Persistence({
  file: `${resolveUserDataDir({ appName: 'AI Desktop' })}/settings.json`,
  cipher: createSafeStorageCipher()
})
await settings.setApiKey('deepseek', apiKey)
```

See [`AGENTS.md`](./AGENTS.md) for architecture notes and conventions.

### Tools

Beyond the sandbox tools (`write_file`, `read_file`, `list_dir`, `run_command`) and the VPS
tools (`remote_shell`, `remote_read_file`, ...), the agent exposes **`migrate_project`** to
copy a project directory from one saved VPS to another with **rsync over SSH**. The command
runs on the source host and pushes to the target, so the source must be connected and able to
reach the target with key auth:

```
migrate_project(
  source_vps_id: 'vps-eu',
  source_path:   '/var/www/app',
  target_vps_id: 'vps-us',
  target_path:   '/srv/app'
)
```

It is non-destructive (no `--delete`), quotes every argument, rejects sensitive paths and
shell metacharacters, records an entry in the SSH audit log, and returns the rsync exit code
(e.g. `127` when rsync is missing on the source). See
[`AGENTS.md`](./AGENTS.md#pattern-cross-host-migration-via-rsync) for the full recipe.

## Packaging & release

```bash
npm run pack       # unpacked app in release/win-unpacked (quick smoke test)
npm run build:win  # NSIS installer + portable exe in release/
```

`electron-builder` is configured in [`electron-builder.yml`](./electron-builder.yml): Windows
x64, an NSIS installer (choose install directory, desktop + start-menu shortcuts) and a
Portable executable. Only the compiled `out/` tree plus `package.json` are packaged — every
renderer dependency is bundled by Vite and the main/preload processes use Electron + Node
built-ins only, so **no `node_modules` ship inside the app**. The production build is
minified and tree-shaken (main ~81 KB, preload ~1.4 KB, renderer JS ~321 KB, CSS ~25 KB).

Code signing is applied automatically when a certificate is available and skipped otherwise:

```bash
CSC_LINK=/path/to/cert.pfx CSC_KEY_PASSWORD=secret npm run build:win
```

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the full release checklist,
[`CHANGELOG.md`](./CHANGELOG.md) for release notes, and
[`FINAL_REPORT.md`](./FINAL_REPORT.md) for the project-level summary, verification results
and the next-version roadmap.

Before installing, please read [`KNOWN_ISSUES_v2.0.0.md`](./KNOWN_ISSUES_v2.0.0.md) — most
importantly the **SmartScreen warning** (the v2.0.0 pre-release is unsigned) and the
**API key / Docker** requirements. To validate a build yourself, follow
[`TESTING_GUIDE_v2.0.0.md`](./TESTING_GUIDE_v2.0.0.md).

## Documentation

| Document | What it covers |
| --- | --- |
| [`TESTING_GUIDE_v2.0.0.md`](./TESTING_GUIDE_v2.0.0.md) | Full Windows test checklist for v1.1 → v2.0, SHA-256 verification, bug-report template and troubleshooting |
| [`KNOWN_ISSUES_v2.0.0.md`](./KNOWN_ISSUES_v2.0.0.md) | Known limitations of the v2.0.0 pre-release (unsigned build, API key, Docker, `ssh2`, v2.1 TODO) |
| [`FINAL_REPORT_v2.0.0.md`](./FINAL_REPORT_v2.0.0.md) | Per-sprint results, final stats, smoke test and installer details |
| [`CHANGELOG.md`](./CHANGELOG.md) | Release notes per version |
| [`AGENTS.md`](./AGENTS.md) | Architecture notes, conventions and the sprint log |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | Release checklist (maintainers) |

## Testing

```bash
npm test          # full Vitest suite (unit + integration)
npx vitest run test/e2e   # end-to-end flows only
```

`test/e2e/` covers the app end to end with only the LLM boundary scripted
(`ScriptedAdapter`), running against the real local sandbox:

| File | Covers |
| --- | --- |
| `agent-flow.e2e.test.ts` | Create + run a project in the sandbox, file change → renderer diff, session save/resume |
| `error-scenarios.e2e.test.ts` | API cut (bounded retries), provider fallback on auth error, unavailable sandbox, transient sandbox retry, path-escape rejection, context overflow with deterministic compaction fallback |
| `performance.e2e.test.ts` | Renderer tokenize/diff budgets, no sandbox leaks across many runs, bounded heap growth and bounded persisted transcript under overflow |
| `v2.3.1-critical-fixes.e2e.test.ts` | Chat → tool → approval → apply → audit, realistic loop stop, VPS connect → chat → `remote_shell` |
| `v2.5.7-integration.test.ts` | Complex goal → plan → step-by-step execution; a `pm2` loop is redirected to `systemctl` at runtime |

## Troubleshooting

- **"Host key verification failed" / `MITM` warning on connect.** The presented SSH host key
  does not match the pinned fingerprint. Confirm the server was not reinstalled or intercepted;
  only then clear the trust in **Settings → Connections → SSH** and reconnect to re-approve.
- **"Blocked by policy: …" in chat.** The target host's `HostPolicy` denied the command. On
  `read-only`/`production` hosts writes are refused and unknown commands count as writes; check
  **Settings → Connections → SSH → <server>** and adjust the mode, allow list or allowed paths.
- **"Approval required by host policy: …".** The command is allowed but the host's approval
  requirement stopped it. Approve it, switch the mode, or add it to the host's allow list.
- **Amber "This command is outside the project policy" banner.** The command is blocked by the
  policy or is not recognised as an explicit read/write (fail-closed). Review the current mode
  shown on the banner, then **Proceed anyway** or **Cancel**. Known write commands skip this
  banner and use the normal approval dialog.
- **A remote project refuses a local tool.** A remote project routes `read_file`/`write_file`/
  `run_command` to the matching `remote_*` tool. If no VPS is selected or the VPS is
  disconnected, the run reports a clear error — pick a VPS in **Settings → Projects** and
  connect it in **Settings → Connections**.
- **"out of the allowed paths" for a path that looks inside.** Allowed paths are
  normalised, so `..` can never climb out of an allowed root (`/srv/app/../../etc/passwd`
  is rejected even when `/srv/app` is allowed).
- **A file was overwritten and you want it back.** Remote writes copy the previous contents to
  `<path>.backup-<timestamp>` first; restore with `cp -p -- '<path>.backup-<ts>' '<path>'`.
- **`migrate_project` printed a dry-run only.** It always previews first; re-run without
  `dry_run` to perform the transfer. `--delete` is never used.
- **Deploy finished but a health check failed.** Check the project's health-check config
  (process/port/HTTP/custom) in **Settings → Projects**; the first failing check is reported.
- **The agent stops with "I got stuck".** Loop detection cut a repeated action (warn at the
  threshold, stop at the hard limit). Rephrase the task or make the failing step different.
- **"Path not found" for a project after upgrading.** Legacy projects with a POSIX path saved on
  Windows are migrated to *remote*; open the project and pick the VPS it lives on.
- **Nothing sensitive in logs.** API keys, tokens and passwords are redacted before they reach
  the log, audit log or UI. If you see a raw secret, that is a bug — report it.

## Documentation

| Document | What it covers |
| --- | --- |
| [`TESTING_GUIDE.md`](./TESTING_GUIDE.md) | Current Windows test checklist and troubleshooting |
| [`CHANGELOG.md`](./CHANGELOG.md) | Release notes per version |
| [`AGENTS.md`](./AGENTS.md) | Architecture notes, conventions and the sprint log |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | Release checklist (maintainers) |

## License

MIT
