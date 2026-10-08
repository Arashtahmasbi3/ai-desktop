# AI Desktop

An Electron desktop AI assistant — a local, Codex-like companion that connects to the
DeepSeek API, VPS servers (SSH), GitHub (Git), and your local files.

> Status: **v2.0.0 (pre-release)**. A Codex-like agent workspace: provider-agnostic LLM
> adapters (OpenAI/Anthropic/DeepSeek/Google), the `SandboxManager` code-execution layer, the
> `AgentOrchestrator` Planning → Execution → Observation → Reflection loop, token-budgeted
> context/session state, and the full renderer UI (chat, tasks/logs, workspace explorer + code
> viewer with diff, internal browser, GitHub, VPS/SSH remote, settings, status bar), plus a
> background worker queue, a localhost remote-access server and Windows packaging.

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

## License

MIT
