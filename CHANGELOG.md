# Changelog

All notable changes to **AI Desktop** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.3.0] — 2026-10-05

Sprint v2.3 “Codex-Like UX & Approval System” — a Codex-style workspace, an approval system
that learns, and advanced chat capabilities.

### Added

- **Sidebar redesign** — workspace switcher, projects-first list with connection status dots,
  per-project hover menu, flat Recents list (rename/duplicate/export/delete) and `Ctrl+K` search.
- **Composer redesign** — inline model switcher with a capabilities tooltip, inline full-access
  toggle, auto-resize up to 200px, `Ctrl/Cmd+Enter` to send and active/grey send states.
- **File changes panel** — per-file `+/-` stats with file-type icons, first-three preview,
  click-to-review split diff and Apply all / Reject all / Review individually.
- **Empty state & chat templates** — project-aware greeting, four quick suggestions and a
  Templates menu with six built-ins plus user-saved templates.
- **Code block runner** — fenced `bash`/`python`/`js` blocks get Copy and Run buttons; output
  and exit code render under the block (ask-mode confirms first).
- **Session fork** — “Fork from here” on any message creates a linked chat from that point.
- **Voice input** — Web Speech API mic button in the composer (locale-aware, hidden if
  unsupported).
- **Multi-window** — `Ctrl+Shift+N` opens a new window; window IPC is sender-scoped and
  settings changes broadcast to every window.
- **Progress timeline** — collapsible vertical timeline beside the chat with animated
  active/pending steps projected from the agent log.
- **Codex-style Settings** — grouped two-column nav (General / Integrations / Coding /
  Advanced) with Providers, API Keys, Plugins (tabs + search + directory), Browser website
  permissions (default “Always ask”), Code Review per-repo auto-review, Connections
  (Control this PC / other devices / SSH), Approval Mode, Memory, Usage and Developer pages.

### Notes

- Existing v2.2 features (session restore, codebase search, terminal, diff review, approval
  modes, remote SFTP tools, project memory) remain unchanged.

## [2.2.0] — 2026-10-05

Codex-like feature pass: session restore and autosave, codebase search (`Ctrl+Shift+F`), file
tree toggle and integrated terminal, inline diff review for agent file writes, approval modes
with a plan/code switch, remote SFTP file tools for connected VPS servers, project
`AI_CONTEXT.md`/`AGENTS.md` injection with context-budget warnings, chats organized by
project, and composer slash commands.

## [2.1.0] — 2026-10-05

UX overhaul, bilingual UI and critical bug fixes.

### Added

- **Internationalization** — English/Persian locales with an instant RTL/LTR switch, persisted
  preference and a Settings language dropdown (i18next + react-i18next).
- **Chat history** — file-per-chat storage with a grouped sidebar (Today / Yesterday /
  This Week / Older), search, and per-chat rename, export (JSON) and delete.
- **Command palette** (`Ctrl+K` / `Ctrl+P`) and a collapsible sidebar (`Ctrl+B`).
- **Workspace switcher** in the title bar, plus custom frameless window controls.
- **VPS selector** in the chat header so a run can target an explicit connected server, with a
  "used remote shell" badge on the answer.
- **Chat composer upgrades** — file attachments (`@path`), live token/character estimate,
  auto-growing textarea and a scroll-to-bottom button.
- **Two-column Settings** — General / Providers / Projects / GitHub / VPS / Advanced.
- **Toast notifications** and an onboarding VPS step.

### Fixed

- Missing project folders are now flagged (`PATH_NOT_FOUND` + `exists`) and can be re-located
  from the sidebar or Settings instead of failing silently.
- `remote_shell` is injected into the main chat runtime when a VPS is connected.
- Project paths now accept Windows drive letters when validated on POSIX hosts.
- Window maximize/restore state is reported to the renderer.

## [2.0.0] — 2026-10-05

VPS / remote — SSH servers from the desktop app, with a hard security boundary.

### Added

- **SSH connections** — add VPS servers (key or password auth), connect/disconnect, and a
  live status indicator. Servers are stored locally; passwords/passphrases are encrypted with
  `safeStorage` and private keys are referenced by path (never copied).
- **Mandatory host-key verification** — a first connection refuses to proceed until you confirm
  the presented `SHA256:` fingerprint; a changed key is always rejected as a possible MITM.
- **Live terminal** — an xterm.js shell (write, output, resize) per connected server.
- **Remote file explorer** — browse, read and edit files over SFTP.
- **Agent integration** — a guarded `remote_shell` tool so the agent can run commands on a
  connected VPS.
- **Security guards** (all enforced in the main process):
  - command deny list (`rm -rf /`, `mkfs*`, `dd of=/dev/*`, fork bombs, `curl | bash`, …);
  - 100 commands/minute rate limit;
  - JSON audit log of every connect/exec/blocked/rate-limited action;
  - 30-minute idle auto-disconnect;
  - a missing private key blocks the connection instead of warning.
- **VPS view** (Ctrl+6) with server list, tabs for Terminal / Files / Audit.

### Notes

- SSH is implemented with `ssh2` (added as a runtime dependency; it is the only one and is
  loaded lazily, so it is listed explicitly in `electron-builder.yml`).
- `keytar` was replaced with the existing `safeStorage` cipher to avoid a second native
  keystore dependency.

## [1.3.0] — 2026-10-05

GitHub integration.

### Added

- **GitHub authentication** — OAuth Device Flow (no backend or redirect URI needed): paste an
  OAuth App client id, authorise in the browser, and the access token is stored encrypted with
  `safeStorage`. The token never leaves the main process.
- **Repository operations** — a GitHub view (Ctrl+5) shows the active project's git status
  (branch, ahead/behind, changed files) and can commit (stage all), pull (fast-forward) and
  push, plus clone. Built on the `git` CLI rather than a bundled library.
- **Pull requests and issues** — list open PRs/issues from `api.github.com`, with links to
  GitHub; pick a repository from your account or type `owner/repo`.

### Notes

- Client ID can also come from `AI_DESKTOP_GITHUB_CLIENT_ID`. Requires a `git` binary on PATH.
- Implemented with `fetch` + the `git` CLI, so no runtime npm dependencies were added.

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
