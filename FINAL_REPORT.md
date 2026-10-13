> ⚠️ **SUPERSEDED — this document describes v1.0.0 only.** The application is now at
> **v2.6.4**; see `AGENTS.md` (Status) and `CHANGELOG.md` for the current state, and the
> versioned `*_v2.3.x.md` documents for later testing guides. Kept for history; do not treat
> its counts, feature list or limitations as current.
# AI Desktop â€” Final Report

**Version:** 1.0.0 Â· **Date:** 2026-10-07 Â· **Repository:** https://github.com/Arashtahmasbi3/ai-desktop

A local, Codex-like desktop AI assistant built with Electron + React 18 + TypeScript. It
connects to the DeepSeek API (and OpenAI / Anthropic / Google), executes code in a sandbox,
works with VPS servers over SSH, interacts with GitHub via Git, and reads/writes local files â€”
all from a single dark-themed desktop window.

---

## 1. Project summary & architecture

The codebase is split so that all provider/Sandbox/agent logic is Electron-free and therefore
unit-testable. The renderer never touches Node directly; it goes through a single
`contextBridge` API.

```
src/
  main/       Electron main process: window, IPC handlers, services, secure stores
  preload/    contextBridge bridge (window.api) + type declarations
  shared/     cross-process types (providers, sandbox, agent, ui)
  core/       runtime logic (no Electron dependency)
    llm-adapters/   OpenAI, Anthropic, DeepSeek, Google behind one BaseLLMAdapter
    sandbox/        Docker + local code execution, path safety, concurrency
    agent/          orchestrator loop, context/state, tools, recovery, persistence
    worker/         task queue, worker manager, offline queue, resource limits
    remote/         localhost remote-access server (websocket framing)
  renderer/   React UI (Vazirmatn, RTL chat, dark theme)
test/         Vitest: unit, integration and e2e suites
build/        app icons (icon.png, icon.ico)
release/      packaged artifacts (git-ignored)
```

**Data flow:** Renderer â†’ `window.api.*` (typed IPC) â†’ main-process services â†’ `core/`
(orchestrator / adapters / sandbox) â†’ back to the renderer as events. Only the LLM HTTP
boundary and the OS are external.

**Layered abstractions:**
- `BaseLLMAdapter` â€” one streaming/chat contract; provider quirks isolated per adapter.
- `SandboxManager` â€” one execution contract; Docker (hardened) and local drivers behind it.
- `AgentOrchestrator` â€” Planning â†’ Execution â†’ Observation â†’ Reflection loop with loop
  detection, bounded retries and provider fallback.
- `ContextManager` â€” token budget with compaction at 80%; `SessionStore` for resume.

---

## 2. Stages and verification status

| Stage | Scope | Status |
| --- | --- | --- |
| 1 | Project skeleton (Electron + React 18 + TS + Vite + Tailwind) | âœ… Complete |
| 2 | LLM adapters (OpenAI / Anthropic / DeepSeek / Google) | âœ… Complete |
| 3 | Code-execution sandbox (Docker + local, path safety) | âœ… Complete |
| 4 | Agent orchestrator (loop, loop detection, recovery) | âœ… Complete |
| 5 | Context & state (token budget, compaction, session persistence) | âœ… Complete |
| 6 | Renderer UI foundation (chat, explorer, theme, RTL) | âœ… Complete |
| 7 | Viewer/diff, tasks/logs, settings, status bar, background worker, remote access | âœ… Complete |
| 8 | Integration/E2E testing & bug fixing | âœ… Complete |
| 9 | Packaging & release (NSIS + portable, optimization, docs) | âœ… Complete |

**Stage 8 highlights:** fixed the sandbox workspace-ownership bug (destroying a sandbox no
longer deletes a caller-supplied workspace); added the e2e suites
(`agent-flow`, `error-scenarios`, `performance`) covering create/run, file-change diff,
session resume, API-cut fallback, transient sandbox retry, path-escape rejection and context
overflow.

**Stage 9 highlights:** NSIS x64 installer + portable exe, app icon and version metadata,
minified/tree-shaken build with no shipped `node_modules` (whole `app.asar` â‰ˆ 970 KB),
and release documentation.

---

## 3. Verification

| Check | Command | Result |
| --- | --- | --- |
| Type-check (main/preload) | `npm run typecheck:node` | âœ… pass |
| Type-check (renderer) | `npm run typecheck:web` | âœ… pass |
| Test suite | `npm test` | âœ… **37 files, 264 passed Â· 1 skipped** |
| Production build | `npm run build` | âœ… minified output |
| Windows package | `npm run build:win` | âœ… Setup.exe + Portable.exe produced |
| Installer structure | 7-Zip listing | âœ… `Type = Nsis`, `SubType = NSIS-3 Unicode`, `app-64.7z`, `Uninstall AI Desktop.exe`, UAC/dir dialogs |
| Version metadata | `strings` on `AI Desktop.exe` | âœ… `AI Desktop`, `0.1.0â†’1.0.0`, `Sepid_Com` |
| Packaged payload | `@electron/asar` list | âœ… only `out/**` + `package.json`; 0 source maps, 0 `node_modules` |

**Build artifacts (`release/`):**

| File | Size |
| --- | --- |
| `AI Desktop Setup 1.0.0.exe` | ~112 MB (NSIS, x64) |
| `AI Desktop 1.0.0 Portable.exe` | ~112 MB |
| `AI Desktop Setup 1.0.0.exe.blockmap` | ~118 KB |
| `win-unpacked/` | ~369 MB (unpacked app) |

> The single skipped test is the Docker integration test, which is skipped automatically when
> no Docker daemon is available; it runs in CI/local environments that have Docker.

---

## 4. Remaining issues & known limitations

1. **Clean-machine install not yet performed.** Packaging and the installer were verified
   structurally on Linux, but installing/running `Setup.exe` must be done on a real clean
   Windows 10/11 machine â€” this is the only outstanding acceptance step.
2. **No code signing certificate.** Builds are unsigned by default, so SmartScreen will warn.
   The pipeline is ready: set `CSC_LINK` / `CSC_KEY_PASSWORD` (or install an OS certificate)
   and the installer/exe are signed automatically.
3. **SSH/VPS and GitHub/Git integrations** are wired through the agent's tool layer and the
   local Git/shell facilities; they are not surfaced as dedicated first-class UI panels yet
   (the agent drives them). A hosted OAuth flow for GitHub is not implemented.
4. **Windows-target builds on Linux/macOS require Wine with 32-bit support** (the NSIS step
   runs the 32-bit installer once to generate the uninstaller). Documented in `AGENTS.md`.
5. **Remote-access server is localhost-only** and intended for local tooling; no
   authentication/transport security layer for remote exposure exists.
6. **Renderer bundle is a single ~321 KB JS chunk.** Code-splitting is not applied; fine for a
   desktop app that loads from disk, but large for a first paint heuristic.

---

## 5. Suggested next-version roadmap (v1.1+)

- **Signing & auto-update.** Add a code-signing cert to the release workflow and wire
  `electron-updater` with a `publish` target (GitHub Releases) for in-app updates.
- **CI/CD pipeline.** GitHub Actions: typecheck â†’ test â†’ `build:win` on `windows-latest`
  (native signing) â†’ publish artifacts to a Release. Add artifact caching for the Electron
  and electron-builder binaries.
- **First-class SSH/VPS panel.** Saved hosts, key management, an interactive terminal, and
  file transfer â€” turning the agent tool into a user-facing feature.
- **GitHub integration UI.** OAuth device flow, repo picker, branch/PR creation from the app.
- **Extensibility.** A plugin/MCP-style tool registry so new tools can be added without
  editing the orchestrator, plus per-tool permission prompts.
- **Cost/usage dashboard.** Token and cost accounting per session/provider.
- **Renderer code-splitting** and a lazy-loaded settings/editor route to trim first paint.
- **Localization.** Extract UI strings to fa/en catalogs (only chat content is RTL today).

---

## 6. Quick start

### For users (Windows)

1. Download `AI Desktop Setup 1.0.0.exe` from the Releases page.
2. Run it â€” per-user install, choose your directory, desktop + start-menu shortcuts are created.
   (Or run `AI Desktop 1.0.0 Portable.exe` with no installation.)
3. Open **Settings**, paste a **DeepSeek** (or OpenAI/Anthropic/Google) **API key**, and save â€”
   keys are encrypted with the OS keystore and stored locally.
4. Start a chat; the assistant can plan, run code in the sandbox, and read/write local files.
5. Optional: add a **Project** (name + path) in Settings to scope file tools to a folder.

### For developers

```bash
npm install
npm run dev          # Electron + renderer with HMR
npm run typecheck    # type-check node + web
npm test             # full Vitest suite (unit + integration)
npm run test:e2e     # end-to-end flows only
npm run pack         # unpacked app in release/win-unpacked
npm run build:win    # NSIS installer + portable exe in release/
```

See [`README.md`](./README.md), [`CONTRIBUTING.md`](./CONTRIBUTING.md) and
[`AGENTS.md`](./AGENTS.md) for more detail.

---

## 7. Verification checklist

- [x] All 9 stages implemented
- [x] Type-check passes (node + web)
- [x] Full test suite green (264 passed Â· 1 skipped)
- [x] Production build minified/tree-shaken, no `node_modules` shipped
- [x] NSIS installer + portable exe produced with icon and version metadata
- [x] Installer payload/structure verified
- [x] `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `AGENTS.md` complete
- [x] `v1.0.0` tagged and pushed
- [ ] Install & run validated on a clean Windows machine *(manual)*
- [ ] Code-signing certificate configured *(blocked on certificate)*

*Report generated by an AI agent (OpenHands) on behalf of the project owner.*
