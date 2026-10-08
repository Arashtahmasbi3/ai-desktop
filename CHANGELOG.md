# Changelog

All notable changes to **AI Desktop** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.0] — 2026-10-05

Preview and browsing.

### Added

- **Split (side-by-side) diff** — the code viewer can compare the working draft with the file
  on disk side by side, pairing each changed line with its replacement. Reuses the existing
  LCS diff and tokenizer (no new highlighting dependency).
- **In-app Markdown preview** — open `.md`/`.markdown`/`.mdx` files as a rendered document
  next to their source.
- **Internal browser** (Ctrl+4) — a sandboxed `<webview>` with a URL bar, history chips and
  back/forward/reload. Navigation is restricted to `http(s)`; attached webviews never inherit a
  preload or Node access, and non-web navigation/popups are denied (`src/main/webview-policy.ts`,
  `src/shared/url.ts`).

## [1.1.0] — 2026-10-05

UX and model improvements.

### Added

- **Model switcher in chat** — a grouped provider/model dropdown in the chat header lets you
  choose the model for the next message (or a custom provider); the choice is sent with the
  run and the effective model is reported back on completion.
- **Central model catalog** (`src/shared/models.ts`) — every provider's models, tags
  (`cheap`/`fast`/`powerful`) and defaults in one place; `PROVIDERS` is derived from it, and
  both the chat dropdown and Settings selects read from it.
- **Custom providers** — add any OpenAI-compatible endpoint (base URL + model + optional
  headers). API keys are encrypted with Electron `safeStorage` and never written in plaintext
  or exposed to the renderer. Includes a live “Test connection” and an “Other” group in the
  model picker; built-in providers remain as fallback.
- **First-run onboarding** — a four-step wizard (welcome + use-case model suggestion, connect a
  provider, add a first project, summary) that suggests a model from the catalog and can be
  skipped. Completion is persisted under the app data directory.

### Changed

- Settings' built-in provider select and the chat model picker now share the central catalog.
- `AgentService.buildProviders()` accepts a per-run model override and a selected custom
  provider (tried first, built-ins as fallback).

## [1.0.0] — 2026-10-07

First stable release. Ships as a Windows x64 NSIS installer and a portable executable.

### Added

- **LLM layer (Stage 2)** — provider-agnostic adapters for OpenAI, Anthropic, DeepSeek and
  Google Gemini behind a single `BaseLLMAdapter` interface (`chat`, `streamChat`,
  `getCapabilities`, `validateConfig`). Shared HTTP plumbing with timeouts, retry/backoff,
  SSE parsing and typed errors (`AuthError`, `RateLimitError`, `TimeoutError`, `NetworkError`,
  `APIError`).
- **Sandbox / code execution (Stage 3)** — `SandboxManagerImpl` with lifecycle, concurrency
  limits and TTL/idle sweeps. Docker provider (hardened: resource limits, `--network none`,
  read-only rootfs) with local and Windows fallbacks. Path containment rejects workspace
  escapes; output is capped.
- **Agent orchestrator (Stage 4)** — `AgentOrchestrator` running the Planning → Execution →
  Observation → Reflection loop, with sandbox tools (`read_file`, `write_file`, `list_dir`,
  `run_command`), loop detection (>3 repeats, no-progress pause) and failure recovery
  (bounded retries for transient sandbox errors, provider fallback on auth/config errors).
- **Context & state (Stage 5)** — token estimation with automatic history compaction at 80%
  of the budget, a context compressor (comment/blank-line stripping, code-block dedupe),
  on-disk JSON `SessionStore` with schema migration and resume, and a `Persistence` layer
  that encrypts API keys via Electron `safeStorage` and resolves the AppData path.
- **Renderer UI (Stage 6/7)** — chat panel with Markdown rendering and streaming, tasks/logs
  panel, workspace file explorer, code viewer with syntax highlighting and diffs, settings,
  status bar, dark theme with Vazirmatn (RTL chat content), drag & drop and keyboard
  shortcuts. Zustand state wired to main-process events over IPC.
- **Background work & remote access** — worker queue and a localhost remote-access server,
  all exposed through a typed, `contextIsolation`-based preload bridge.
- **Integration testing (Stage 8)** — `test/e2e/` covers project create/run in the real local
  sandbox, file change → renderer diff, session save/resume, and failure handling (API cut
  with bounded retries, provider fallback, unavailable sandbox, transient sandbox retry,
  path-escape rejection, context overflow with deterministic compaction fallback), plus
  performance/leak guards.

### Fixed

- Destroying a sandbox no longer deletes a caller-supplied workspace (e.g. the active
  project directory); only auto-created workspaces are removed.

### Packaging

- **electron-builder** configured for Windows x64: NSIS installer (`oneClick: false`,
  selectable install directory, desktop + start-menu shortcuts) and a Portable build.
- Application icon (`build/icon.png`, `build/icon.ico`) and product metadata.
- Optimized production build: esbuild minification and tree-shaking for main, preload and
  renderer; source maps disabled. Renderer bundle reduced from ~620 KB to ~321 KB.
- All runtime dependencies are bundled by Vite; `dependencies` is empty, so no
  `node_modules` are shipped inside the app package.
- Optional code signing via `CSC_LINK` / `CSC_KEY_PASSWORD` (skipped safely when absent).

[Unreleased]: https://github.com/Arashtahmasbi3/ai-desktop/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Arashtahmasbi3/ai-desktop/releases/tag/v1.0.0
