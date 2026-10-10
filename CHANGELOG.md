# Changelog

All notable changes to **AI Desktop** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.3.2] — 2026-10-05

Sprint v2.3.2 "Remote-First Architecture & Security Alignment" — a remote-first
agent that routes every tool to the VPS a project lives on, gates mutations behind
an explicit plan, and hardens the host policy against traversal.

### Added

- **Remote-first file routing (A.1)** — when the active project is `remote`, local
  file/shell tools are rewritten to their `remote_*` equivalents (relative paths are
  rebased onto the remote project root and the server id is attached) before they
  reach an executor. A remote project with no usable VPS yields a clear error instead
  of silently touching the local machine.
- **Context-aware host policy (A.3)** — a `HostPolicy` can carry `readOnlyCommands`
  and `writeCommands`. Reads never need approval, writes are gated on `staging` and
  blocked on `production`, and anything unrecognised stays fail-closed.
- **Per-command timeouts (A.4)** — ordinary commands get 60s, builds/tests 5 minutes
  and rsync/db dumps 30 minutes. A hung command is killed when its budget elapses
  instead of freezing the app.
- **Plan Mode (A.5)** — a batch containing mutating tool calls is offered as a short
  plan that must be approved, modified or cancelled before anything runs. Full access
  and read-only batches are exempt.
- **Backups before remote writes (B.1)** — an existing file is copied to
  `<path>.backup-<timestamp>` before it is overwritten, with a restore command, so a
  bad agent write can always be undone.
- **Post-deploy health checks (B.2)** — declarative process/port/HTTP/custom checks
  run after a deploy and report the first failure.
- **rsync dry-run preview (B.3)** — `migrate_project` always runs a `--dry-run` first
  and shows files/bytes/deletes before the real transfer (never `--delete`).
- **Context preview before send (B.4)** — a pre-send modal lists provider/model,
  estimated tokens, included sections and always-withheld secret-looking files.
- **`~/.ssh/config` import (B.5)** — import saved hosts (HostName/User/Port/IdentityFile
  path only; key material is never read).
- **Per-project metadata (C.1)** — projects carry environment, audit log path,
  repository, docker-compose project, ports, domains, linux user, SSH key reference,
  a policy override and a health-check config, edited from an expandable project card.
- **Project isolation UI (C.2)** — sidebar rows show an environment dot
  (🟢/🟡/🔴), a local/remote type badge, the VPS name or "local", the environment label
  and a policy-mismatch warning; the approval dialog shows an amber "outside the
  project policy" banner with **Proceed anyway** / **Cancel** before approving.

### Security

- **Path-traversal fix in `allowedPaths`.** `evaluateHostPolicy` now lexical-normalises
  `.`/`..` before containment, so `/srv/app/../../etc/passwd` no longer passes a
  `/srv/app` allow rule; a path that climbs above the root fails closed. Local
  resolution (`normalizeSandboxPath`, `FileService.resolveSafe`) already rejected `..`.
- **Policy Warning = blocked OR unknown.** A command is flagged before approval only
  when the policy blocks it or does not recognise it; known writes go through normal
  approval instead of the warning.
- Deny-list matching normalises whitespace, so padded/tabbed `rm  -rf  /` variants are
  still blocked; backgrounded commands cannot escape the per-command timeout.

### Fixed

- Sidebar project rows keep the connection dot while adding environment/type/scope
  badges, and no longer truncate the project name behind the VPS label.

### Tests

- New: `test/e2e/v2.3.2-security.e2e.test.ts` (7 integration scenarios),
  `test/security/v2.3.2.test.ts` (5 security scenarios),
  `test/renderer/sidebar-projects.test.tsx`,
  `test/renderer/chat-policy-warning.test.tsx`,
  `test/renderer/settings-projects.test.tsx`.

## [2.3.1] - 2026-10-05

Sprint v2.3.1 "Critical Fixes & Security Hardening" — a hardened agent loop,
strict local/remote separation, per-host command policy and secret redaction.

### Added

- **Per-host command policy (B.3)** — every VPS can carry a `HostPolicy`
  (`read-only` / `staging` / `production`, approval requirement, allow/deny lists
  and allowed paths). `SshManager.exec` evaluates it fail-closed (unknown commands
  count as writes) before SSH; blocked and approval-required commands are audited
  and surfaced in chat as `Blocked by policy:` / `Approval required by host policy:`.
  Edit it in **Settings → Connections → SSH → <server>**.
- **Secret redaction (B.1)** — new `core/agent/redact.ts` scrubs API keys, tokens,
  passwords and private-key material before anything reaches logs, the audit log or
  the UI.
- **DeepSeek V4 catalog + migration (A.3)** — current model list and a legacy
  migration path for stored model selections.
- **Workspace type (A.2)** — projects are explicitly `local` or `remote`; legacy
  POSIX paths saved on Windows are promoted to remote instead of failing with
  "Path not found".
- **Full Access global state (A.5)** — shared approval helpers keep the status bar
  and full-access toggle in sync across windows.

### Changed

- **Loop detection (A.1)** — fuzzy, per-tool-call sliding-window detection catches
  repeated actions even when arguments vary slightly, with warn-then-stop severity.
- **VPS connection state (A.4)** — a single centralized connection state with
  auto-reconnect and keepalive, reflected consistently in the sidebar, status bar
  and settings.

### Security

- **Mandatory host-key verification (B.2)** — first-use approval, pinned
  fingerprint persistence, and hard failure on mismatch/MITM, covered by tests.
- Policy evaluation is fail-closed: anything that cannot be proven a read is
  treated as a write on read-only/production hosts.

### Tests

- New: `test/security/redaction.test.ts`, `test/security/host-key.test.ts`,
  `test/security/policy-engine.test.ts`, `test/renderer/vps-state.test.ts`,
  `test/shared/approval.test.ts`, `test/e2e/v2.3.1-critical-fixes.e2e.test.ts`.

## [2.3.0] ‚Äî 2026-10-05

Sprint v2.3 ‚ÄúCodex-Like UX & Approval System‚Äù ‚Äî a Codex-style workspace, an approval system
that learns, and advanced chat capabilities.

### Added

- **Sidebar redesign** ‚Äî workspace switcher, projects-first list with connection status dots,
  per-project hover menu, flat Recents list (rename/duplicate/export/delete) and `Ctrl+K` search.
- **Composer redesign** ‚Äî inline model switcher with a capabilities tooltip, inline full-access
  toggle, auto-resize up to 200px, `Ctrl/Cmd+Enter` to send and active/grey send states.
- **File changes panel** ‚Äî per-file `+/-` stats with file-type icons, first-three preview,
  click-to-review split diff and Apply all / Reject all / Review individually.
- **Empty state & chat templates** ‚Äî project-aware greeting, four quick suggestions and a
  Templates menu with six built-ins plus user-saved templates.
- **Code block runner** ‚Äî fenced `bash`/`python`/`js` blocks get Copy and Run buttons; output
  and exit code render under the block (ask-mode confirms first).
- **Session fork** ‚Äî ‚ÄúFork from here‚Äù on any message creates a linked chat from that point.
- **Voice input** ‚Äî Web Speech API mic button in the composer (locale-aware, hidden if
  unsupported).
- **Multi-window** ‚Äî `Ctrl+Shift+N` opens a new window; window IPC is sender-scoped and
  settings changes broadcast to every window.
- **Progress timeline** ‚Äî collapsible vertical timeline beside the chat with animated
  active/pending steps projected from the agent log.
- **Codex-style Settings** ‚Äî grouped two-column nav (General / Integrations / Coding /
  Advanced) with Providers, API Keys, Plugins (tabs + search + directory), Browser website
  permissions (default ‚ÄúAlways ask‚Äù), Code Review per-repo auto-review, Connections
  (Control this PC / other devices / SSH), Approval Mode, Memory, Usage and Developer pages.
- **Cross-VPS project migration** — new `migrate_project` agent tool copies a project
  directory from one saved VPS to another with **rsync over SSH**
  (`source_vps_id`, `source_path`, `target_vps_id`, `target_path`).
  - **Security:** `ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new`, every argument
    `shellQuote`d, `checkDenyList` on the built command, sensitive-path and metacharacter
    rejection, and an SSH **audit log** entry per migration.
  - **Non-destructive:** no `--delete` by default, so the destination is only added to/updated.
  - Runs on the **source** host (compression + efficiency); requires source→target SSH key
    auth. Returns the rsync exit code so the agent can handle failures (e.g. `127` when rsync
    is not installed on the source).

### Notes

- Existing v2.2 features (session restore, codebase search, terminal, diff review, approval
  modes, remote SFTP tools, project memory) remain unchanged.

## [2.2.0] ‚Äî 2026-10-05

Codex-like feature pass: session restore and autosave, codebase search (`Ctrl+Shift+F`), file
tree toggle and integrated terminal, inline diff review for agent file writes, approval modes
with a plan/code switch, remote SFTP file tools for connected VPS servers, project
`AI_CONTEXT.md`/`AGENTS.md` injection with context-budget warnings, chats organized by
project, and composer slash commands.

## [2.1.0] ‚Äî 2026-10-05

UX overhaul, bilingual UI and critical bug fixes.

### Added

- **Internationalization** ‚Äî English/Persian locales with an instant RTL/LTR switch, persisted
  preference and a Settings language dropdown (i18next + react-i18next).
- **Chat history** ‚Äî file-per-chat storage with a grouped sidebar (Today / Yesterday /
  This Week / Older), search, and per-chat rename, export (JSON) and delete.
- **Command palette** (`Ctrl+K` / `Ctrl+P`) and a collapsible sidebar (`Ctrl+B`).
- **Workspace switcher** in the title bar, plus custom frameless window controls.
- **VPS selector** in the chat header so a run can target an explicit connected server, with a
  "used remote shell" badge on the answer.
- **Chat composer upgrades** ‚Äî file attachments (`@path`), live token/character estimate,
  auto-growing textarea and a scroll-to-bottom button.
- **Two-column Settings** ‚Äî General / Providers / Projects / GitHub / VPS / Advanced.
- **Toast notifications** and an onboarding VPS step.

### Fixed

- Missing project folders are now flagged (`PATH_NOT_FOUND` + `exists`) and can be re-located
  from the sidebar or Settings instead of failing silently.
- `remote_shell` is injected into the main chat runtime when a VPS is connected.
- Project paths now accept Windows drive letters when validated on POSIX hosts.
- Window maximize/restore state is reported to the renderer.

## [2.0.0] ‚Äî 2026-10-05

VPS / remote ‚Äî SSH servers from the desktop app, with a hard security boundary.

### Added

- **SSH connections** ‚Äî add VPS servers (key or password auth), connect/disconnect, and a
  live status indicator. Servers are stored locally; passwords/passphrases are encrypted with
  `safeStorage` and private keys are referenced by path (never copied).
- **Mandatory host-key verification** ‚Äî a first connection refuses to proceed until you confirm
  the presented `SHA256:` fingerprint; a changed key is always rejected as a possible MITM.
- **Live terminal** ‚Äî an xterm.js shell (write, output, resize) per connected server.
- **Remote file explorer** ‚Äî browse, read and edit files over SFTP.
- **Agent integration** ‚Äî a guarded `remote_shell` tool so the agent can run commands on a
  connected VPS.
- **Security guards** (all enforced in the main process):
  - command deny list (`rm -rf /`, `mkfs*`, `dd of=/dev/*`, fork bombs, `curl | bash`, ‚Ä¶);
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

## [1.3.0] ‚Äî 2026-10-05

GitHub integration.

### Added

- **GitHub authentication** ‚Äî OAuth Device Flow (no backend or redirect URI needed): paste an
  OAuth App client id, authorise in the browser, and the access token is stored encrypted with
  `safeStorage`. The token never leaves the main process.
- **Repository operations** ‚Äî a GitHub view (Ctrl+5) shows the active project's git status
  (branch, ahead/behind, changed files) and can commit (stage all), pull (fast-forward) and
  push, plus clone. Built on the `git` CLI rather than a bundled library.
- **Pull requests and issues** ‚Äî list open PRs/issues from `api.github.com`, with links to
  GitHub; pick a repository from your account or type `owner/repo`.

### Notes

- Client ID can also come from `AI_DESKTOP_GITHUB_CLIENT_ID`. Requires a `git` binary on PATH.
- Implemented with `fetch` + the `git` CLI, so no runtime npm dependencies were added.

## [1.2.0] ‚Äî 2026-10-05

Preview and browsing.

### Added

- **Split (side-by-side) diff** ‚Äî the code viewer can compare the working draft with the file
  on disk side by side, pairing each changed line with its replacement. Reuses the existing
  LCS diff and tokenizer (no new highlighting dependency).
- **In-app Markdown preview** ‚Äî open `.md`/`.markdown`/`.mdx` files as a rendered document
  next to their source.
- **Internal browser** (Ctrl+4) ‚Äî a sandboxed `<webview>` with a URL bar, history chips and
  back/forward/reload. Navigation is restricted to `http(s)`; attached webviews never inherit a
  preload or Node access, and non-web navigation/popups are denied (`src/main/webview-policy.ts`,
  `src/shared/url.ts`).

## [1.1.0] ‚Äî 2026-10-05

UX and model improvements.

### Added

- **Model switcher in chat** ‚Äî a grouped provider/model dropdown in the chat header lets you
  choose the model for the next message (or a custom provider); the choice is sent with the
  run and the effective model is reported back on completion.
- **Central model catalog** (`src/shared/models.ts`) ‚Äî every provider's models, tags
  (`cheap`/`fast`/`powerful`) and defaults in one place; `PROVIDERS` is derived from it, and
  both the chat dropdown and Settings selects read from it.
- **Custom providers** ‚Äî add any OpenAI-compatible endpoint (base URL + model + optional
  headers). API keys are encrypted with Electron `safeStorage` and never written in plaintext
  or exposed to the renderer. Includes a live ‚ÄúTest connection‚Äù and an ‚ÄúOther‚Äù group in the
  model picker; built-in providers remain as fallback.
- **First-run onboarding** ‚Äî a four-step wizard (welcome + use-case model suggestion, connect a
  provider, add a first project, summary) that suggests a model from the catalog and can be
  skipped. Completion is persisted under the app data directory.

### Changed

- Settings' built-in provider select and the chat model picker now share the central catalog.
- `AgentService.buildProviders()` accepts a per-run model override and a selected custom
  provider (tried first, built-ins as fallback).

## [1.0.0] ‚Äî 2026-10-07

First stable release. Ships as a Windows x64 NSIS installer and a portable executable.

### Added

- **LLM layer (Stage 2)** ‚Äî provider-agnostic adapters for OpenAI, Anthropic, DeepSeek and
  Google Gemini behind a single `BaseLLMAdapter` interface (`chat`, `streamChat`,
  `getCapabilities`, `validateConfig`). Shared HTTP plumbing with timeouts, retry/backoff,
  SSE parsing and typed errors (`AuthError`, `RateLimitError`, `TimeoutError`, `NetworkError`,
  `APIError`).
- **Sandbox / code execution (Stage 3)** ‚Äî `SandboxManagerImpl` with lifecycle, concurrency
  limits and TTL/idle sweeps. Docker provider (hardened: resource limits, `--network none`,
  read-only rootfs) with local and Windows fallbacks. Path containment rejects workspace
  escapes; output is capped.
- **Agent orchestrator (Stage 4)** ‚Äî `AgentOrchestrator` running the Planning ‚Üí Execution ‚Üí
  Observation ‚Üí Reflection loop, with sandbox tools (`read_file`, `write_file`, `list_dir`,
  `run_command`), loop detection (>3 repeats, no-progress pause) and failure recovery
  (bounded retries for transient sandbox errors, provider fallback on auth/config errors).
- **Context & state (Stage 5)** ‚Äî token estimation with automatic history compaction at 80%
  of the budget, a context compressor (comment/blank-line stripping, code-block dedupe),
  on-disk JSON `SessionStore` with schema migration and resume, and a `Persistence` layer
  that encrypts API keys via Electron `safeStorage` and resolves the AppData path.
- **Renderer UI (Stage 6/7)** ‚Äî chat panel with Markdown rendering and streaming, tasks/logs
  panel, workspace file explorer, code viewer with syntax highlighting and diffs, settings,
  status bar, dark theme with Vazirmatn (RTL chat content), drag & drop and keyboard
  shortcuts. Zustand state wired to main-process events over IPC.
- **Background work & remote access** ‚Äî worker queue and a localhost remote-access server,
  all exposed through a typed, `contextIsolation`-based preload bridge.
- **Integration testing (Stage 8)** ‚Äî `test/e2e/` covers project create/run in the real local
  sandbox, file change ‚Üí renderer diff, session save/resume, and failure handling (API cut
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
[2.3.2]: https://github.com/Arashtahmasbi3/ai-desktop/compare/v2.3.1...v2.3.2
[1.0.0]: https://github.com/Arashtahmasbi3/ai-desktop/releases/tag/v1.0.0
