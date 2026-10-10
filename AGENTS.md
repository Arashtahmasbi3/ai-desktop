# AGENTS.md

Persistent memory / operating guide for AI agents working in this repository.

## Project

**AI Desktop** — an Electron desktop AI assistant. Long-term goal: behave like Codex and
connect to DeepSeek API, VPS servers (SSH), GitHub (Git), and the local desktop (file I/O).

**Repository**: https://github.com/Arashtahmasbi3/ai-desktop (private, independent).
Default branch `master`; remote `origin` tracks it. Push after every committed change.

Current state: **Stage 9 — packaging & release (v1.0.0)**. Stage 1 skeleton (Electron + React 18 +
TypeScript), Stage 2 LLM adapters (OpenAI/Anthropic/DeepSeek/Google), Stage 3 code-execution
sandbox and Stage 4 `AgentOrchestrator` (Planning → Execution → Observation → Reflection loop,
loop detection, failure recovery) are in place. Stage 5 adds context/state management:
token estimation with automatic history compaction at 80% of the budget, a context compressor
that strips code comments/blank lines and dedupes blocks, an on-disk JSON `SessionStore` with
schema migration, and a `Persistence` layer that encrypts API keys (Electron `safeStorage` in
the app) and resolves the AppData path. The chat UI, SSH and Git come next.

Since then the renderer UI landed (chat with Markdown + streaming, tasks/logs, workspace
file explorer + code viewer with syntax highlighting/diff, settings, status bar), along with
a background worker queue and a localhost remote-access server, all wired through
`src/main/ipc.ts` + `src/main/app-services.ts`. Stage 8 adds `test/e2e/`: integration
coverage that drives the real local sandbox with a scripted LLM boundary — create/run a
project, file change + renderer diff, session save/resume, and the failure paths (API
cut/fallback, unavailable sandbox, transient sandbox retry, path escape, context overflow)
plus performance/leak guards. Stage 9 packages the app for Windows (NSIS installer + portable
exe, icon and version metadata), optimizes the production build (minify/tree-shake, no shipped
`node_modules`) and adds `CHANGELOG.md` / `CONTRIBUTING.md`; release is `v0.1.0`.

## Status

**v2.3.1 released. Sprint complete. Next: user testing on Windows.** (2026-10-05)

- Latest release: **v2.3.1 (full release)** — installer + portable exe published on a GitHub
  Release with `SHA256SUMS.txt`
  (<https://github.com/Arashtahmasbi3/ai-desktop/releases/tag/v2.3.1>); `master` at the
  v2.3.1 merge (`4c88b0b`), tag `v2.3.1`.
- **v2.3.1 — Critical Fixes & Security Hardening**: 5 critical fixes (A.1 loop detection,
  A.2 local/remote workspaces, A.3 DeepSeek V4, A.4 VPS connection state, A.5 Full Access
  sync) + 3 security layers (B.1 secret redaction, B.2 host-key verification, B.3 per-host
  command policy).
- Test suite green: **86 files / 648 passed, 1 skipped**; `typecheck` (node + web) and
  production `build` green.
- Windows artifacts built from Linux via Wine (`electron-builder`): `AI Desktop Setup 2.3.1.exe`
  (~107 MB) and `AI Desktop 2.3.1 Portable.exe` (~107 MB), `SHA256SUMS.txt` (189 B).
- Smoke-tested on Linux under `xvfb` (`docs/screenshots/v2.3.1/01-chat-empty.png`) — a **clean
  Windows machine** install is still pending.
- Next action: the user tests on Windows using
  [`TESTING_GUIDE_v2.3.1.md`](./TESTING_GUIDE_v2.3.1.md) and reports back (known limitations
  in [`KNOWN_ISSUES.md`](./KNOWN_ISSUES.md)).
- Backlog entry for v2.1: opt-in deny list for the manual VPS terminal (see **Backlog** below).

## Tech stack

- Electron 44 + electron-vite 5 + Vite 7
- React 18 + TypeScript 5 (strict)
- Tailwind CSS 3 (dark theme)
- Zustand 5 (state) + lucide-react (icons) + react-markdown
- Vitest (tests) + electron-builder (NSIS packaging)

## Commands

| Command | Purpose |
| --- | --- |
| `npm install` | Install dependencies |
| `npm run dev` | Start Electron + renderer in dev mode (HMR) |
| `npm run build` | Build main/preload/renderer into `out/` |
| `npm run typecheck` | Type-check node + web projects |
| `npm test` | Run Vitest once (`npm run test:watch` to watch) |
| `npm run test:e2e` | Run only the end-to-end suite in `test/e2e/` |
| `npm run pack` | Build an unpacked app with electron-builder into `release/` |
| `npm run build:win` | Build + package a Windows NSIS installer + portable exe into `release/` |

## Structure

```
src/
  main/index.ts          Electron main process (window + IPC handlers)
  main/secure-cipher.ts  safeStorage-backed SecretCipher for API keys
  preload/index.ts       contextBridge API exposed as window.api
  preload/index.d.ts     window.api type declarations
  shared/types.ts        provider-agnostic LLM types (ChatMessage, ToolCall, ...)
  shared/sandbox.ts      sandbox types (SandboxManager, limits, ExecResult, ...)
  shared/agent.ts        agent types (AgentStep, AgentRunResult, LoopWarning, policies)
  core/
    agent-orchestrator.ts  AgentOrchestrator — plan/execute/observe/reflect loop
    agent/
      context-manager.ts   history + token budget + 80% auto-compaction + summary
      context-compressor.ts comment/blank stripping + code-block dedupe
      session-store.ts     on-disk JSON sessions + schema migration
      persistence.ts       encrypted API keys, AppData path, settings migration
      loop-detector.ts     repeated-action / no-progress detection
      error-recovery.ts    tool + LLM retry/fallback policies
      tools.ts             SANDBOX_TOOLS + SandboxToolExecutor + action parsing
      logger.ts            JSON-Lines / in-memory loggers
      index.ts             barrel export
    llm-adapters/
      base.ts            BaseLLMAdapter interface + BaseAdapter class + collectStream
      openai.ts          OpenAI (also the OpenAI-compatible base)
      deepseek.ts        DeepSeek (extends OpenAIAdapter, api.deepseek.com/v1)
      anthropic.ts       Anthropic Messages API (event-based SSE)
      google.ts          Google Gemini (contents/parts, alt=sse)
      registry.ts        provider metadata + adapter selection
      errors.ts          typed errors (Auth/RateLimit/Timeout/Network/API/...)
      http.ts            fetch + timeout + retry/backoff
      sse.ts             Server-Sent Events parser
      util.ts            safe JSON walking helpers
    sandbox/
      manager.ts         SandboxManagerImpl — lifecycle, concurrency, TTL/idle sweep
      docker-sandbox.ts  DockerSandboxDriver (limits, --network none, read-only rootfs)
      local-sandbox.ts   LocalSandboxDriver + WindowsSandboxDriver (no-Docker fallback)
      driver.ts          SandboxDriver/SandboxHandle interfaces
      command-runner.ts  ChildProcessRunner (spawn + timeout + capped output)
      concurrency.ts     Semaphore for max concurrent sandboxes
      registry.ts        provider registry + availability-based selection
      paths.ts           workspace path containment (rejects escapes)
      errors.ts          typed sandbox errors
  renderer/
    index.html
    src/
      main.tsx           React entry
      App.tsx            root component
      assets/main.css    Tailwind entry + Vazirmatn font
      components/        UI components (added in later stages)
      lib/               non-UI logic (llm, agent, ...)
test/                    Vitest tests (adapters use a mocked fetch boundary)
```

## Conventions

- TypeScript everywhere, `strict` on. Prefer `node:` import prefixes in the main process.
- Renderer talks to the system only through `window.api.*` (preload). Never enable
  `nodeIntegration`; keep `contextIsolation: true`.
- New IPC channels: add `ipcMain.handle('<ns>:<action>')` in `src/main/index.ts`, expose it
  in `src/preload/index.ts`, and declare its type in `src/preload/index.d.ts`.
- LLM providers: never call a provider SDK directly — go through `BaseLLMAdapter`
  (`chat` / `streamChat` / `getCapabilities` / `validateConfig`). Pick the adapter with
  `registry.ts` (`createAdapter`, `getAdapter`, `createAdapterForConfig`). Provider-specific
  request/response translation lives in the adapter; shared plumbing (HTTP, retry, SSE,
  errors) lives in `base.ts` / `http.ts` / `sse.ts` / `errors.ts`.
- Import via path aliases: `@shared/*` → `src/shared/*`, `@core/*` → `src/core/*`,
  `@main/*`, `@preload/*`, `@renderer/*`. Aliases are configured in `tsconfig.*.json`,
  `electron.vite.config.ts` and `vitest.config.ts`.
- Tests mock the HTTP boundary (a fake `fetch` injected via `config.fetchImpl` or
  `test/helpers/mock-fetch.ts`) so adapters' own logic is still exercised end to end.
- Sandbox code execution goes through `SandboxManager` (`createSandbox`, `executeCommand`,
  `writeFile`, `readFile`, `destroySandbox`) — never spawn processes for rendered code
  directly. Providers: `docker` (primary; hardened flags, `--network none` default) then
  `windows`/`local` fallbacks. The local fallback is **not** a security boundary; state
  that explicitly whenever it is used. Every path is validated by `paths.ts`.
- Sandbox tests: command-execution and file round-trips run for real against the local
  driver; the Docker driver is tested deterministically with an injected `CommandRunner`
  (asserting exact CLI flags), and real Docker integration is gated on daemon availability.
- Sandbox workspace ownership: `SandboxManagerImpl` records whether it created the workspace.
  A caller-supplied `workspaceRoot` (e.g. the active project) must survive `destroySandbox`;
  only auto-created workspaces are deleted. The flag is passed to drivers as
  `SandboxHandle.ownsWorkspace` — honour it in any new driver so project files are never
  removed on teardown.
- End-to-end tests live in `test/e2e/` and drive the real local sandbox with a scripted
  `BaseLLMAdapter` (only the LLM boundary is faked). Keep them deterministic — no network,
  no Docker — so they run in CI everywhere.
- Agent orchestration goes through `AgentOrchestrator` (`src/core/agent-orchestrator.ts`).
  It owns the Planning → Execution → Observation → Reflection loop and is the only place
  that drives an adapter and a sandbox together. Tool calls are turned into `AgentAction`s
  by `tools.ts`, executed via `SandboxToolExecutor` (never host APIs directly), and the
  result is fed back as a `tool` message. Loop detection lives in `loop-detector.ts`
  (warn on >3 repeats of the same action signature; ask the user after repeated
  no-progress steps), recovery policies in `error-recovery.ts` (bounded retries for
  transient sandbox errors; provider fallback on auth/config errors). Streaming is not
  used by the orchestrator — it calls `adapter.chat`.
- Agent tests inject a scripted `BaseLLMAdapter` (`test/helpers/fake-adapter.ts`) at the
  LLM boundary and use a real local `SandboxManager` (`test/helpers/local-sandbox-manager.ts`),
  so tool execution, context handling and loop detection run for real.
- Context/state: `AgentOrchestrator` builds its `ContextManager` with a token budget
  (`contextWindowTokens`, defaulted from the provider's `getCapabilities`) and compacts history
  with an LLM summary once usage crosses `compactionThreshold` (default 80%). `compressContext`
  (default on) runs old messages through `context-compressor.ts` before they are sent — it only
  affects the prompt, never the stored history/session. Sessions are saved via `SessionStore`
  (one JSON file per session, atomic writes) and can be resumed with `run(task, { resumeSessionId })`.
  API keys are never stored in plaintext: they go through a `SecretCipher`
  (`SafeStorageCipher` = Electron `safeStorage` in the app) inside `persistence.ts`, which also
  owns the AppData path (`resolveUserDataDir`) and settings migration. Both stores migrate old
  payloads forward and re-save so legacy plaintext is scrubbed.
- UI: dark theme only. Use the Tailwind theme tokens `bg-bg-primary` `#0a0a0a`,
  `bg-bg-secondary` `#141414`, `bg-bg-tertiary` `#1e1e1e`, `border-border`, `text-accent`.
- Menus/labels in English; chat content is RTL (`dir="rtl"`), font Vazirmatn.
- Keep the Content-Security-Policy in `src/renderer/index.html` in sync with any new
  external resource (fonts, network calls to the DeepSeek API, etc.).

## Release process

The project uses SemVer + annotated git tags, with GitHub Releases as the distribution channel.
Tags are `v<version>` and match `version` in `package.json`.

1. **Bump the version** in `package.json`, then sync the lockfile:
   `npm install --package-lock-only --ignore-scripts`.
2. **Update `CHANGELOG.md`** — move the `[Unreleased]` bullets under a new
   `## [<version>] — <date>` heading and update the compare-link footnotes.
3. **Re-verify** before tagging: `npm run typecheck && npm test` (must be green) and
   `npm run build:win` (produce the artifacts). Cross-building on Linux needs 32-bit Wine —
   see *Lessons learned*.
4. **Checksum the artifacts** (in `release/`):
   `sha256sum "AI Desktop Setup <v>.exe" "AI Desktop <v> Portable.exe" > SHA256SUMS.txt`.
   GitHub's limit is 2 GB per asset; both artifacts are ~110 MB so no Git LFS is needed.
5. **Commit and push** the version/changelog/docs changes to `master`.
6. **Tag and push:**
   ```bash
   git tag -a v<version> -m "AI Desktop v<version>"
   git push origin master && git push origin v<version>
   ```
7. **Create the GitHub Release** for the tag. Start as a **pre-release** to collect feedback,
   then promote to a full release once install/run is confirmed on a clean Windows machine.
   Upload `AI Desktop Setup <v>.exe`, `AI Desktop <v> Portable.exe` and `SHA256SUMS.txt`, and
   put the checksums in the release body. Example (uses `$GITHUB_PERSONAL_ACCESS_TOKEN`):
   ```bash
   REL=$(curl -s -X POST \
     -H "Authorization: Bearer $GITHUB_PERSONAL_ACCESS_TOKEN" \
     -H "Accept: application/vnd.github+json" \
     https://api.github.com/repos/Arashtahmasbi3/ai-desktop/releases \
     -d '{"tag_name":"v<version>","target_commitish":"master",
          "name":"v<version> — Initial Release (Pre-release)","prerelease":true,
          "body":"..."}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')

   for f in "AI Desktop Setup <v>.exe" "AI Desktop <v> Portable.exe" SHA256SUMS.txt; do
     curl -s -X POST \
       -H "Authorization: Bearer $GITHUB_PERSONAL_ACCESS_TOKEN" \
       -H "Content-Type: application/octet-stream" \
       --data-binary @"release/$f" \
       "https://uploads.github.com/repos/Arashtahmasbi3/ai-desktop/releases/$REL/assets?name=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$f")"
   done
   ```
8. **Verify** the release via the API (`/releases/tags/v<version>`): `prerelease` flag, all
   three assets present with the expected sizes.

Notes: assets are uploaded via `uploads.github.com` (not the API host); the release body always
carries the SmartScreen warning while the build is unsigned. Do **not** delete the tag when
promoting — just flip the release's `prerelease` flag to `false`.

## Packaging

- Config lives in `electron-builder.yml` (referenced by `npm run build:win` / `npm run pack`).
  Windows x64, NSIS installer + portable exe, icon in `build/icon.ico` / `build/icon.png`.
- `dependencies` is intentionally **empty**: the renderer is fully bundled by Vite and
  main/preload only use Electron + Node built-ins. Keep new runtime deps bundled (add to
  `devDependencies`) so `node_modules` never ships inside the app. `files` packages only
  `out/` + `package.json`.
- Production build is minified/tree-shaken via `optimizeBuild` in `electron.vite.config.ts`
  (esbuild minify, no source maps, `debugger` dropped). Don't turn minify off for releases.
- Code signing is automatic when `CSC_LINK`/`CSC_KEY_PASSWORD` (or an OS cert) are present;
  absent that the build is unsigned and must not fail (`forceCodeSigning: false`).
- Building the Windows targets on Linux/macOS requires **wine** (electron-builder uses it to
  patch the exe/installer resources). Without wine the NSIS step fails with `spawn wine ENOENT`.
  The `win-unpacked/` app is still produced, which is enough for a smoke test.

## Environment notes

- Target runtime is Windows (NSIS). `electron-builder.yml` currently targets `win`/`nsis`.
- Secrets (DeepSeek API key) must never be committed. Use a settings store / `.env.local`
  (git-ignored), never hardcode keys.

### Running in headless containers / CI

- Electron needs an X display. In a headless Linux box run it under `xvfb-run -a npm run dev`.
- Chromium's sandbox is often blocked in containers (`Failed to move to new namespace`).
  For local/CI runs only, disable it via `ELECTRON_DISABLE_SANDBOX=1` (or `--no-sandbox`).
  Never ship that flag in production.
- Some hardened npm setups skip dependency install scripts, leaving Electron without its
  binary. If `node_modules/electron/path.txt` is missing, run `node node_modules/electron/install.js`.

### Verifying the running renderer

- `npm run dev -- --noSandbox --remoteDebuggingPort 9223` exposes Chrome DevTools Protocol on
  `http://127.0.0.1:9223/json`. Drive it with a CDP WebSocket client (Python `websockets` works)
  to read `document.body.innerText` and click real buttons — this is the fastest way to confirm
  what the Electron window actually renders without a human looking at it.
- Screenshots: `DISPLAY=:99 XAUTHORITY=<xvfb-run auth file> import -window root artifacts/ui.png`
  (the Xauthority path is in the `Xvfb` process line; `artifacts/` is git-ignored).
- Gotcha: editing two nearby regions of one file in quick succession can leave Vite's transform
  cache stale; the dev server then serves a module that references a symbol whose import was
  only added in the second write, and React unmounts the tree with a `ReferenceError`, leaving a
  blank window. `location.reload()` may not fix it — restart `electron-vite dev` (and delete
  `node_modules/.vite` if needed) and re-check.
- Render errors unmount the whole React tree, so panels are wrapped in `ErrorBoundary`
  (`src/renderer/src/components/ErrorBoundary.tsx`); keep new panels inside one.

## Patterns

Conventions that recur across the codebase — follow them when adding code.

- **Adapter/registry pattern for providers.** New LLM providers implement `BaseLLMAdapter`
  and are registered in `src/core/llm-adapters/registry.ts`; shared HTTP/SSE/retry/error
  plumbing lives in `base.ts` / `http.ts` / `sse.ts` / `errors.ts`. Never special-case a
  provider inside the orchestrator.
- **Driver/manager pattern for execution.** `SandboxManager` is the only entry point; the
  Docker and local behaviours are drivers behind it (`driver.ts`, `registry.ts`). Ownership of
  a workspace is tracked on the handle so `destroy()` never deletes a caller-supplied path.
- **Event-driven IPC, not request/response for long work.** Streaming LLM output and task
  progress flow to the renderer as events (`window.api.on*`); one-shot operations use
  `ipcMain.handle`/`invoke`. Every new channel needs three edits: main handler, preload
  entry, and `src/preload/index.d.ts` type.
- **Inject the boundary, don't mock internals.** Tests depend on injectable seams:
  `config.fetchImpl` (LLM HTTP), `CommandRunner` (process exec), and a fake `Cipher`
  (`test/helpers/`). E2E tests use a scripted `BaseLLMAdapter` and the **real** local sandbox.
- **Layered state with migration.** `SessionStore` and the settings/persistence layers write
  versioned payloads and migrate forward on read; keep that so old sessions/keys keep working.
- **Time/limits are injected, not hard-coded.** TTL/idle sweeps, timeouts and token budgets
  come from config so tests can drive them deterministically.

## Pattern: Cross-Host Migration via rsync

How `migrate_project` copies a project between two saved VPS servers
(`src/core/tools/migrate-project-tool.ts`). Follow this when adding any cross-host copy.

- Use `rsync -az --info=stats2` with `-e 'ssh -p PORT -o BatchMode=yes -o StrictHostKeyChecking=accept-new'`.
- **Never** pass `--delete` unless the user explicitly confirms (non-destructive by default).
- Run the command **from the source** host — compression happens once and the transfer is
  pushed to the target, which is cheaper than pulling.
- Require **SSH key auth source→target**; `BatchMode=yes` fails fast instead of hanging on a
  password prompt, and `StrictHostKeyChecking=accept-new` pins new hosts on first use.
- Guard every argument: `shellQuote` values, reject control characters / shell metacharacters,
  reject sensitive roots (`/etc`, `/var/log`, `/proc`, `/sys`, `/dev`, ...), and run
  `checkDenyList` on the assembled command.
- Write an entry to the **audit log** for every migration (`migrate <src> -> <server>:<dst>`).
- Return the **rsync exit code** to the agent so it can react — e.g. `127` means `rsync` is not
  installed on the source host, which the agent should surface as an actionable error.

## Pattern: Agent Loop Detection

How the orchestrator stops a stuck run (`src/core/agent/loop-detector.ts`).

- Detection is **fuzzy and per-tool-call**, over a sliding window (`windowSize`), so repeated
  `remote_shell` calls are caught even when the arguments differ slightly — not just byte-identical
  repeats.
- Severity is **layered**: the first repeats emit a WARN the model can self-correct from
  (`repeatedActionThreshold`), a hard threshold **STOPs** the run (`repeatedStopThreshold`).
  Separate counters cover failure streaks, repeated reasoning and no-progress turns.
- The orchestrator checks **before** a tool call (`beforeToolCall`) to cut a loop early and
  **after** it (`afterToolCall` / `markProgress`) to update progress. New "progress" tools must be
  registered, otherwise a productive tool looks like a stall.
- A stop produces a `LoopStopInfo` on `AgentRunResult.stop` plus a user-facing warning, so tests
  assert `result.stop?.reason` rather than counting steps.

## Pattern: Local vs Remote Workspaces

Projects carry an explicit workspace type (`src/core/agent/persistence.ts`).

- A `ProjectRecord` is `local` (a folder on this machine) or `remote` (a folder on a connected
  VPS, with an optional `vpsId`). Never infer it from a string at use sites.
- Records written by older builds are **migrated on read** (`migrateProjectRecord`): a POSIX path
  saved while running on Windows is almost certainly remote, so it is promoted to `remote` with no
  VPS chosen yet. The UI then prompts for a VPS instead of reporting "Path not found".
- Remote project paths are normalized separately (`normalizeRemoteProjectPath`) from local ones.

## Pattern: Layered Architecture & Remote-First Routing

Keep the dependency direction and the routing seam intact (`src/core/agent/remote-routing.ts`).

- **Layering is `shared ← core ← main ← renderer`.** `core` never imports from `main`;
  logic both layers need is a pure module in `shared/` (e.g. `shared/project-metadata.ts`).
  The renderer reaches main only through the typed `window.api` preload bridge.
- **Routing is a pure function consulted before execution.** `routeToolCall(tool, args,
  context)` returns `passthrough` / `redirect` / `error`; the orchestrator applies it and
  rewrites local tool names (`read_file` → `remote_read_file`, `run_command` →
  `remote_shell`) with the remote project root and `server_id` attached.
- **Never let a local tool run against a remote project.** A remote project with no VPS or a
  disconnected VPS gets a clear `error` decision instead of a `sandbox_error` on the wrong
  machine. Add new routable tools to `LOCAL_TO_REMOTE_TOOL`.
- The routing decision is data, so it is unit-testable without SSH or an LLM.

## Pattern: Secret Redaction

Never log or persist a raw secret (`src/core/agent/redact.ts`).

- The `redact()` helper scrubs API keys, bearer tokens, passwords and PEM/private-key material.
- Redaction is applied at the **boundaries** that reach disk or the UI: `logger.ts`,
  `audit-log.ts` (both `command` and `detail`) and renderer error strings in `store.ts`.
- New logging or audit call sites must route through these helpers; do not hand-format values
  that may contain credentials.

## Pattern: Per-Host Command Policy

Every remote command passes a fail-closed policy (`src/core/remote/host-policy.ts`).

- A host may carry a `HostPolicy` (`read-only` / `staging` / `production`, an approval requirement,
  allow/deny lists and allowed paths). Hosts without a policy keep the legacy deny-list behaviour.
- Classification is **fail-closed**: `commandIntent` returns `write` for anything it cannot prove is
  a read, so read-only/production hosts block unknown commands. Precedence is
  deny list → read-only mode → allowed paths → explicit allowlist → approval.
- `SshManager.exec` evaluates the policy after `checkDenyList` and before SSH; a block or an
  approval requirement is audited and returned on `VpsExecResult` (`blocked` / `requiresApproval`),
  which `executeRemoteShell` surfaces to the model as `Blocked by policy:` /
  `Approval required by host policy:`.

## Pattern: Policy Warning = blocked OR unknown

When the renderer warns the user before an agent command runs (`src/renderer/src/lib/policy-warning.ts`).

- A command is **"outside the project policy"** (⇒ amber pre-approval warning with
  Proceed anyway / Cancel) in exactly two cases: the policy **blocks** it
  (`evaluateHostPolicy().allowed === false` — deny/path/mode) or it is
  **unknown** (fail-closed: not recognised as an explicit read or write).
- A **known write** command is **not** a warning: it is inside the policy and only
  goes through the normal approval flow (`requiresApproval`).
- The warning reuses `@core/remote/host-policy` — never a parallel classifier. The
  same helper derives the sidebar's policy-mismatch flag (`hasPolicyMismatch`:
  different mode, or a looser approval requirement than the host mandates).


## Lessons learned

- **Verify the packaged artifact, not just the build.** `npm run build` passing says nothing
  about what ships. Inspect `app.asar` (`@electron/asar`'s `listPackage`) and the installer
  (`7zz l`). This is how we confirmed no `node_modules`/source maps leaked into the release.
- **`dependencies: {}` is a feature.** Because Vite bundles the renderer and main/preload use
  only Electron + Node built-ins, nothing needs to be installed at runtime — the app package
  stays ~1 MB and the installer is just Electron + that. Keep new runtime libs bundled.
- **Cross-building Windows NSIS on Linux needs 32-bit Wine.** electron-builder runs the
  32-bit installer once (`WineVmManager`) to generate the uninstaller, so it fails with
  `spawn wine ENOENT`, then `wine32 is missing`, then `failed to load .../ntdll.dll`. Installing
  `wine32:i386` (and its i386 deps) and initializing the prefix (`wineboot -u`) fixes it.
  electron-builder's bundled Wine (`toolsets.wine`) is 64-bit-only here and is *not* enough.
  `release/win-unpacked/` is produced even when the NSIS step fails — useful for a smoke test.
- **Namespace the packaged payload.** Restrict `files:` to `out/**` + `package.json` and
  exclude `**/*.map`, `**/*.ts`, `**/node_modules/**`; set `removePackageScripts`,
  `removePackageKeywords`, `compression: maximum`. Small, predictable artifacts.
- **The sandbox ownership bug is easy to reintroduce.** A sandbox created around a user's
  workspace must not delete that workspace on destroy. The handle carries `ownsWorkspace`,
  and `test/sandbox/manager.test.ts` guards it.
- **Context overflow needs a deterministic fallback.** Compaction can itself fail; the
  orchestrator falls back to deterministic trimming rather than erroring (covered in
  `test/e2e/error-scenarios.e2e.test.ts`).
- **Headless UI verification is worth the setup.** The CDP probe (`/json`, websockets) reading
  `document.body.innerText` catches blank-window/ReferenceError regressions that unit tests
  cannot; it was reused across Stage 6–8.
- **Keep docs in lockstep with the artifact.** Every packaging change moves three files:
  `electron-builder.yml`, the npm scripts, and the version in `package.json`/`CHANGELOG.md`.
  Dated changelog entries + a SemVer tag are cheap and make releases reproducible.

## Autonomous sprint log

Running notes for the `MASTER_AUTONOMOUS.md` execution (v1.1 → v2.0). Decisions that deviate
from the plan are tagged `[AUTO-DECISION]` or `[BETTER-ALTERNATIVE]`.

### Sprint 1 — v1.1 (branch `feature/v1.1-ux-improvements`)

- `[BETTER-ALTERNATIVE]` **Follow the real tree, not the plan's paths.** The plan names files
  like `src/core/agent-service.ts`, `src/main/ipc/custom-providers.ts` and
  `src/renderer/components/...`; the repository actually uses `src/main/agent-service.ts`,
  `src/main/ipc.ts` (one handler table), and `src/renderer/src/components/...`. New code lives in
  the real locations; the plan's intent (feature behaviour) is unchanged.
- `[BETTER-ALTERNATIVE]` **Onboarding state in the main process, not `localStorage`.** The plan
  chose renderer `localStorage`; we persist `onboarding.json` under the app data dir via
  `OnboardingStore`. Reason: consistent with `settings.json`/`sessions/`, survives renderer
  storage resets, and is testable under the node Vitest environment.
- `[AUTO-DECISION]` **Onboarding is four steps** (`welcome` → `connect` → `project` → `done`),
  not six slides, with a use-case → model recommendation instead of a static tour.
- `[AUTO-DECISION]` **Custom providers are OpenAI-compatible only**, with an optional JSON
  “extra headers” field; keys reuse the existing `SecretCipher`/`safeStorage` seam
  (`createSafeStorageCipher`) rather than adding a new crypto dependency.
- `[AUTO-DECISION]` **`CustomProviderStore.test()` is non-throwing** — it returns
  `{ ok, latencyMs?, message? }` so a bad endpoint cannot crash the Settings panel.
- `[AUTO-DECISION]` **Model catalog is the single source of truth**; `PROVIDERS` is derived, so a
  missing recommended model falls back to the provider default (`recommendModel`).
- Tests: 43 files / 304 passed, 1 skipped. `typecheck` and `build` green.

### Sprint 2 — v1.2 (branch `feature/v1.2-preview-browser`)

- `[BETTER-ALTERNATIVE]` **Reuse the existing diff/highlighter, add no dependencies.** The plan
  proposed shiki/`prism-react-renderer` + `diff`; the repo already ships a tokenizer
  (`lib/highlight.ts`) and an LCS diff (`lib/diff.ts`). Split view is built on those
  (`lib/split-diff.ts`), so `dependencies` stays empty (see “Lessons learned”).
- `[AUTO-DECISION]` **Browser only allows `http(s)`.** `src/shared/url.ts` normalizes input
  (bare host → `https://`) and rejects `file:`/`data:`/`javascript:`; `installWebviewPolicy`
  denies popups and non-web navigation, and `will-attach-webview` strips preload + Node.
- `[AUTO-DECISION]` **HTML/image preview deferred.** The file IPC is text-only, so previewing
  images would need a new binary channel; rendering HTML in the privileged renderer risks script
  execution, and the new Browser view is the sanctioned way to view a page. `PreviewPane`
  renders Markdown only and says so for other types.
- Branch based on `feature/v1.1-ux-improvements` (not `master`) so Sprint 1 code is present;
  master has not been updated yet.
- Tests: 45 files / 313 passed, 1 skipped. `typecheck` and `build` green.

### Sprint 3 — v1.3 (branch `feature/v1.3-github`)

- `[BETTER-ALTERNATIVE]` **No `octokit`/`simple-git`.** Both were trialled and reverted: the repo
  packages with no `node_modules` (see “Lessons learned”), so a runtime dependency would ship a
  broken app. GitHub is `fetch` (`src/main/github/client.ts`) + the `git` CLI
  (`src/main/github/git.ts`). Requires `git` on PATH.
- `[AUTO-DECISION]` **OAuth Device Flow** (not a redirect/broker): works without a backend or
  registered callback. The client id is user-supplied or from `AI_DESKTOP_GITHUB_CLIENT_ID`.
- Token stored with the same `safeStorage` cipher as provider keys and never sent to the renderer.
- `parseGitStatus` and device-flow parsing are pure and unit-tested (`test/main/*`).
- Tests: 47 files / 327 passed, 1 skipped. `typecheck` and `build` green.

### Sprint 4 — v2.0 (branch `feature/v2.0-vps-remote`)

- `[BETTER-ALTERNATIVE]` **`keytar` → `safeStorage`.** Credentials are encrypted with the same
  OS-keystore cipher already used for provider keys (`src/main/secure-cipher.ts`); this avoids a
  second native keystore module while keeping secrets out of the renderer and off disk in plaintext.
- `ssh2` is the **only runtime dependency**. It is kept out of the Vite bundle (lazy
  `import('ssh2')` so Rollup never resolves its optional `.node` binding) and is re-included
  explicitly in `electron-builder.yml` (`ssh2` + `asn1`/`bcrypt-pbkdf`/`tweetnacl`/`safer-buffer`).
  `ssh2-sftp-client` was dropped — `ssh2`'s own `sftp` covers list/read/write.
- All security rules live in `SshManager` and are injected/clock-driven for tests: mandatory
  host-key verification (`host-key-verify.ts`), deny list + rate limiter + JSON audit
  (`src/core/agent/`), 30-minute idle disconnect, and a missing key/password **blocks** (never warns).
- Host key is only pinned after explicit user approval; a changed fingerprint is always rejected.
- Testability: `SshBackend` is an interface, so `test/main/ssh-manager.test.ts` and
  `test/security/penetration.test.ts` run the real manager with a fake transport.
- Tests: 53 files / 384 passed, 1 skipped. `typecheck` and `build` green.

## Backlog

- **TODO v2.1:** گزینه «اعمال Deny-list روی ترمینال دستی» در Settings (پیش‌فرض: خاموش).
  (Manual VPS terminal input is intentionally unrestricted today because the user owns the
  server; v2.1 will add an opt-in Settings toggle to apply the deny list to typed input too.)

## v2.1 — UX overhaul & bug fixes (branch `feature/v2.1-ux-overhaul`)

Decisions taken conservatively without blocking on questions (per the sprint's golden rule):

- `[AUTO-DECISION]` **Version bump `2.0.0` → `2.1.0`** to match the sprint line (package.json + StatusBar/Advanced label).
- `[AUTO-DECISION]` **Chat history is file-per-chat** (`ChatStore` → `<userData>/chats/<id>.json`) exposed as
  `window.api.chats.*`. This is the sidebar source of truth; the older `agent.sessions` store is kept for the
  Tasks/worker panel. `normalizeProjectPath` also accepts **Windows drive paths** even on POSIX so CI (Linux) and
  the Windows app agree.
- `[AUTO-DECISION]` **i18n = i18next + react-i18next** with `en`/`fa` resources under `src/renderer/src/i18n/`.
  Locale is persisted in `localStorage` (`ai-desktop:locale`); `<html dir>` switches instantly (`fa` → `rtl`).
  A parity test fails the build if a key is missing from `fa.json`.
- `[AUTO-DECISION]` **Menu chrome stays English; chat content follows locale direction.** Sidebar/Settings labels are
  translated, but long marketing/help copy in Onboarding is still English to avoid churn.
- `[AUTO-DECISION]` **Chat export = JSON download** (Blob + `<a download>`) rather than a native save dialog; rename
  uses `window.prompt`. Chosen to stay dependency-free and avoid new IPC surface.
- `[AUTO-DECISION]` **New IPC added:** `dialog:pickFile` (multi-select) for the composer attachment button. Attached
  paths are appended to the prompt as `@<path>` lines.
- `[AUTO-DECISION]` **Shortcuts:** `Ctrl+K`/`Ctrl+P` palette, `Ctrl+B` sidebar, `Ctrl+N` new chat, `Ctrl+,` settings,
  `Ctrl+1..6` views, `Esc` closes palette → settings → error.
- Tests: 58 files / 411 passed, 1 skipped. `typecheck` (node + web) and `build` green.

## v2.2 — Codex-like features & deep fixes (branch `feature/v2.2-codex-features`)

Autonomous decisions logged per the sprint's golden rule (`[AUTO-DECISION]`, no blocking questions).

- `[AUTO-DECISION]` **Automatic path discovery / missing-project recovery (Task 1).** Projects are never
  deleted when their path is missing; `exists` is computed at read time (`settingsView()`), the Sidebar shows
  a missing-path warning with **Locate** (pick a new folder) and remote projects can be searched on a connected
  VPS (`vps:searchProject` -> `settings:addRemoteProject`). Cross-OS paths survive a round-trip.
- `[AUTO-DECISION]` **Model catalog (Task 7).** Tags extended to `cheap|powerful|fast|free|coding|reasoning|vision`;
  catalog refreshed with current OpenAI/Anthropic/DeepSeek/Google Gemini ids. Model picker badges reuse these tags.
- `[AUTO-DECISION]` **RTL & typography (Task 5).** Font stack is `Inter, Vazirmatn, ...` (menus English / chat RTL via
  `<html dir>`), markdown code blocks force LTR, and dark themed scrollbars replace the OS default. Inter is added as
  the primary Latin face but is not bundled -- it falls back to Vazirmatn/system when unavailable (no new dependency).
- `[AUTO-DECISION]` **GitHub auth (Task 4).** Kept the OAuth **device flow** and added a zero-config
  **Personal Access Token** path (`GitHubService.setToken` -> validated with `GET /user` *before* persisting, so a
  bad token never leaves a half-connected state). UI has a Device-flow / Access-token toggle with guide links.
  IPC: `github:setToken`. The device flow still needs a client id (env `AI_DESKTOP_GITHUB_CLIENT_ID` or the in-app
  field) because GitHub has no public client id to embed; the PAT path is the no-setup fallback.
- `[AUTO-DECISION]` **Chats organised by project (Task 3).** New chats inherit `settings.activeProjectId` as
  `workspaceId`; the Sidebar groups history under the project name. Chats with no project (or a deleted one) fall
  into a trailing **No project** bucket -- the migration path for pre-v2.2 history (no file rewrite needed).
- `[AUTO-DECISION]` **Memory (Task 6).** `AI_CONTEXT.md` and `AGENTS.md` from the active *local* project are read at
  run time and appended to the agent system prompt, truncated to a 12 000-char budget so they cannot crowd out the
  task (`src/shared/memory.ts` + `src/main/project-memory.ts`). Remote projects are skipped (files are not local).
  The composer shows an amber over-budget notice once the conversation estimate crosses ~32k tokens.
- `[AUTO-DECISION]` **Slash commands (Task 8, partial).** `/new /clear /settings /workspace /vps /github` run actions;
  `/plan /explain /fix /test` seed prompt templates; `/help` lists everything. Menu supports arrows/Tab/Enter/Esc.
  Tool **approval modes** and a Plan/Code system-prompt switch are **deferred** -- they require orchestrator-level
  tool gating that is too risky to land without a larger refactor and dedicated tests.
- `[AUTO-DECISION]` **Remote workspace (Task 2, partial).** Remote projects, VPS discovery IPC and the Settings
  add-remote UI ship. A dedicated `read_file/write_file/list_dir` **remote** fs tool for the agent is **deferred**
  (today the agent reaches a VPS through `remote_shell`); doing it properly needs an SFTP-backed tool executor.
- Tests: 64 files / 439 passed, 1 skipped. `typecheck` (node + web) and `build` green.

### Sprint v2.2 continued — Codex-like features
- `[AUTO-DECISION]` **Remote FS tools (Task A).** Added SFTP-backed `remote_read_file` / `remote_write_file` /
  `remote_list_dir` / `remote_exists` / `remote_grep` / `remote_git_status` (`src/core/tools/remote-fs-tools.ts` +
  `remote-fs-executor.ts`). They are injected only when a VPS is connected and the SSH host exposes SFTP
  (`RemoteFsHost`), routed through `CompositeToolExecutor`; writes/deletes honour the shared deny-list and audit log.
- `[AUTO-DECISION]` **Approval modes + Plan/Code switch (Task B).** Supersedes the earlier "deferred" note. Three
  modes (`auto` / `dangerous` / `writes`, default `dangerous`) gate every tool call through `core/agent/approval.ts`
  (`classifyAction` -> read/write/shell + deny-list escalation). The renderer answers via `main/approval-broker.ts`
  (`ApprovalBroker`), which **fails closed** on timeout (2 min), on abort (`cancelAll`), or on an unknown id.
  **Plan Mode** exposes no tools (`tools: []`, `toolChoice: 'none'`) and appends `PLAN_MODE_HINT`; a composer
  Plan/Code toggle and Settings > Advanced controls drive it. Persisted as settings schema v2 (`approvalMode`,
  `planModeDefault`).
- `[AUTO-DECISION]` **Inline diff review (Task C).** The agent still edits in an ephemeral sandbox; after a
  successful `write_file` the orchestrator emits `FileChange {path, before, after}` via `onFileWritten`.
  `AgentService` re-reads the *project* file for a true `before`, emits a `file:change` event, and exposes
  `applyChange` (writes onto the active project through `FileService`) / `rejectChange` (drops it). The chat renders
  each pending edit as a collapsible split diff (`FileChangeCard` + `DiffViewer`) with **Apply** / **Reject**.
  Rationale: applying to the project is an explicit, user-initiated action, so agent writes can never touch real
  files without consent — safer than pointing the sandbox at the project.
- `[AUTO-DECISION]` **Chat file tree + terminal (Tasks D/E).** The chat header gains two toggles: a file tree
  (`FileExplorer` rendered in an aside, preference persisted in `localStorage`) and a local terminal panel.
  The terminal is **one-shot, not a PTY**: `shell:exec` runs a command via `child_process.exec` with a 30s timeout,
  a 4MB cap and `cwd` = the active project root (`src/main/local-shell.ts`), keeping history/clear/close in the UI.
  Chose one-shot exec over a PTY because it reuses the existing IPC/typed boundary and avoids vending a raw shell.
- `[AUTO-DECISION]` **Codebase search (Task F).** `Ctrl+Shift+F` opens a modal backed by `search:code` →
  `src/main/project-search.ts`, a literal case-insensitive walker that skips `node_modules`/`.git`/build dirs,
  caps files (5k), file size (512KB) and results (200). Clicking a hit opens it in the code viewer.
- `[AUTO-DECISION]` **Session restore (Task G).** The active chat id is remembered in `localStorage`; `init()`
  restores the most recent chat after a restart, and a 30s interval autosaves the open conversation
  (`persistChat`) so a crash mid-run does not lose messages.
- `[AUTO-DECISION]` **Keyboard shortcuts (Task H).** Existing: `Ctrl+K/P` palette, `Ctrl+B` sidebar, `Ctrl+N` new
  chat, `Ctrl+,` settings, `Ctrl+1..6` views. Added: `Ctrl+Shift+F` search, `Ctrl+Shift+E` file tree,
  `Ctrl+Shift+T`/`` Ctrl+` `` terminal, `Ctrl+S` save the open file, and `Esc` now also closes the search modal.
- `[AUTO-DECISION]` **v2.1/v2.2 release topology.** Branch analysis showed `feature/v2.1-ux-overhaul` was
  **already merged and tagged `v2.1.0`** (merge commit `02b95c9`), and `feature/v2.2-codex-features` was cut from
  master (`634a6d4`), i.e. it already contained both v2.1 and master. So the v2.1→master merge/tag step was a
  no-op and v2.2 needed no rebase — only the v2.2 merge. Released as `v2.2.0`: merge commit `110d6d4` on master,
  annotated tag `v2.2.0`, and a GitHub **pre-release** with the NSIS setup, portable exe, and `SHA256SUMS.txt`.
- `[AUTO-DECISION]` **v2.3.2 B.4 — context preview before send.** A shared, pure module `src/shared/context-preview.ts` (`buildContextPreview`, `estimateTokens`, `isSecretPath`, `formatContextPreview`) powers a pre-send modal that lists provider/model, estimated tokens, included sections and always-withheld files. Hand-rolled a small `ContextPreviewCard` modal rather than a dependency; the on-by-default `showContextBeforeSend` preference lives in `localStorage` and toggles from Settings → General. Secret-looking files are filtered out of the included set and shown under "Withheld", never dropped silently.
- `[AUTO-DECISION]` **v2.3.2 B.5 — `~/.ssh/config` import.** `src/core/remote/ssh-config.ts` is a pure parser (no filesystem access) so it is trivially testable; `vps:importSshConfig` reads the config in main and the renderer only ever sees HostName/User/Port/IdentityFile **path**. Deliberately skips wildcard/negated `Host` patterns and `Match` blocks, and keeps `~` in IdentityFile rather than expanding it — key material is only opened later via keytar at connect time.
- `[PATTERN]` **Layered architecture: `shared ← core ← main ← renderer`.** `core` NEVER imports from `main` (enforced by tsconfig `paths` + review). Pure, dependency-free logic that both layers need lives in `shared/` (e.g. `shared/project-metadata.ts`, `shared/context-preview.ts`). Renderer talks to main only through the typed `window.api` preload bridge.
