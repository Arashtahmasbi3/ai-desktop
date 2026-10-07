# Changelog

All notable changes to **AI Desktop** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
