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

## Development process — mandatory

**Before starting every Sprint, review [`DEVELOPMENT_CHECKLIST.md`](./DEVELOPMENT_CHECKLIST.md)**
(sections 1–3 pre-sprint, 4–7 during, 8–11 post-sprint, plus the ten golden rules). The
checklist is the single source of truth for our definition of Done; do not start a task
without walking the relevant boxes. When a Sprint reveals a new lesson, record it here in
AGENTS.md (as `[PATTERN]` / `[AUTO-DECISION]`) and, if it changes process, update the
checklist too.

Non-negotiable rules restated: no task is skipped without a technical reason (stop and ask
otherwise); every fix ships with a test that covers a real scenario (never `assert(true)`);
verify state (`git status`, inspect files) before changing anything; plan before executing;
least privilege with an always-on deny-list, approval for risky ops and secret masking in
all logs; per-project isolation (metadata / SSH key / Linux user / host policy where
possible); everything reversible (git from day one, backups, checkpoints, rollback plan);
transparency about what is read/changed and the result; automatic environment self-check
(git/node/docker/disk/memory) before acting; and an honest report (say it when a test
fails, a tool is missing, or the budget ran out — ask rather than guess).

## Status

**v4.2.0 released — the substrate the audit asked for, and three god files split.** Thirty-two findings from
`ai-desktop-audit-and-plan-fa.md`, worked in the approved order. The load-bearing additions are seams rather than
features: one `ToolsetBuilder` assembles a run's tools (a definition without a route is a tool nothing can run;
neither mistake was visible in a diff), and on top of it **MCP** and **`SKILL.md`** — a capability can now arrive as
a configured server or a folder on disk. MCP tools are foreign by construction (`mcp__<server>__<tool>`) and get
shell semantics in the approval gate, because "auto-approve writes" was a choice about the agent's own tools, not
about a process the user just installed. `store.ts` 2243 → 193, `agent-service.ts` 1967 → 744,
`agent-orchestrator.ts` 2072 → 785, with no file in `src/` over 800 and **no importer changed**. A stopped run now
names one of twelve causes from a table — the old chain reported a *refused* connection as a timeout — and the card
actually renders it. The network policy covers the ways a command really reaches a host, `ask_user` stopped silently
repairing a model's options, and three process rules became build failures: a settings switch nothing reads, a new
double cast, a new assertion on exact UI copy (179 existing ones are a ratchet that may only shrink), plus a
capability matrix that must name every tool the agent can be offered. **Honest limits:** one invariant of the
settings-capability test was lost when its agent was interrupted and is deliberately not guessed back; the screenshot
driver and the debug port are tested only in their pure halves, because Defender blocks executing a freshly built
unsigned exe here; code signing stays deferred and the review queue needs a product decision. 327 test files / 2971
tests green, typecheck clean. (2026-10-19)

**v4.1.0 released — a stopped run explains itself, and the network became a kind of action.** The report was "I am
not satisfied, it keeps getting stuck", backed by a screenshot and, crucially, by the session log, which changed
the diagnosis twice. A run ended with "It looks like I got stuck" while the app knew that SSH to the target had
timed out and every probed port was filtered — the target's firewall was blocking the source server. `LoopStopInfo`
now carries the failed observations, the step count and any pending question, and a **deterministic verdict**
(no model call) names the cause, lists the evidence and ends with one next step; a question is no longer labelled
a fault, and the heading no longer claims a loop when the clock simply ran out. The turn clock became an **idle**
timer with a hard ceiling, because a 300s budget was being spent on network timeouts while the run was still
making progress. Two bugs came straight out of that log: `ssh host 'df -h /opt'` was refused as "outside project
root" because the guard compared one host's filesystem with another host's project root (`ssh`/`mosh` payloads are
no longer scanned; `bash -c` still is, or a shell wrapper would be a one-line bypass), and four read-only
diagnostics each demanded a click because a `;` inside a quoted payload invented a phantom segment and a wrapper's
payload arrived still quoted. Network actions became their own class (`/dev/tcp`, `nc`, `nmap`) asked about in
those words before any read-only shortcut, and a real per-server **connection test** landed so the agent never has
to improvise a port scan. The window lost its duplicates: one Stop, one Sources entry point, four status items,
and a chat row that is no longer mistaken for a form. Simple mode is the default. 296 test files / ~2500 tests
green, typecheck and production build clean. (2026-10-18)

**v4.0.1 released — the chat transcript, which the 4.0 restyle had missed.** Found by reading a real
conversation rather than the component list: `MessageBubble` used no clay classes, so the mechanical
rename never touched it and it never made a sweep list — and it is the most-used surface in the app.
Messages are now bordered blocks told apart by border colour (user = accent, assistant = ink, system =
warning), never by a soft fill alone; inline code is a bordered chip and the code block has a stated
header. Fixing it introduced a bug worth recording: a JSX comment in the **children** position must be
`{/* … */}` — a bare `/* … */` there is a text node, and the transcript printed my own note above
every message. No test caught it, reading the rendered page did; a case now pins that the bubble
renders its message and nothing else. The sidebar's bottom nav also had a hard-coded "Plugins" string
that survived the rename to *Surfaces*, and was the one untranslated label in the shell. 286 test files
/ 2414 tests green, typecheck and production build clean. (2026-10-16)

**v4.0.0 released — a brutalist design language, and a settings page that stopped lying.** The
report was "still cluttered, messy, over-saturated, confusing, not beautiful", so the layer *under*
the colours was rebuilt and the colours were kept: the warm ramps, the brand accent and the WCAG
contrast contract are untouched. Clay's three-step radius, blurred dual shadows and bezier easing are
gone, replaced by square geometry, a **single hard offset shadow with zero blur**, instant linear
motion, uppercase micro-labels, monospace data and an offset focus ring. The largest single fix is
invisible in a screenshot: 180 borders sat at roughly **1.1:1** against the page, so they were raised
into a real hierarchy (1px separator → 2px ink container → 2px ink + shadow for primary surfaces) —
the one deliberate palette adjustment. Restraint is enforced by tests, not hoped for: depth only on
touchable surfaces, never two shouting elements, and the security dialogs keep the border with no
offset shadow. `clay-tokens.test.ts` became `brutal-tokens.test.ts` (zero blur, square geometry,
per-theme shadows, instant motion, the surface vocabulary, and no clay class anywhere). Separately,
`Settings → Plugins` was a page of switches that persisted a key **nothing read**; it is now
*Surfaces*, with three real switches that genuinely hide their surface (and its button), and four
informational rows that point at where they are really configured via a Configure button that lands on
that exact tab. 285 test files / 2408 tests green, typecheck and production build clean. Verified by
launching the app against an isolated profile and screenshotting both themes — every pass was driven
by what the screenshot showed. (2026-10-16)

**v3.2.1 released — attach by dropping or pasting, instead of opening a project.** Closing the
approved plan's item 4. The app had **no** paste or drag-drop attachment path, and the only drop
handler in the tree treated every dropped item as a **project** — dropping a screenshot opened a
project named `screenshot.png` pointing at a file. The composer now intercepts its own drops (with
`stopPropagation`, so the app-level handler cannot also open a project) and shows itself as a drop
target; a real file pasted from a file manager attaches, while an ordinary **text** paste is left
entirely alone. A screenshot tool's bitmap has no file behind it and is reported rather than dropped
silently — supporting it needs main to accept renderer-provided bytes, a separate security-relevant
change. The decision is a pure, tested helper because each direction of getting it wrong is a bug;
main remains the only side that reads a file. 284 test files / 2393 tests green, typecheck and
production build clean. (2026-10-16)

**v3.2.0 released — decision checkpoints.** The last item of phase 4, and with it phase 4 is
complete. Per step the app already knew what the agent intended and what it chose; it can now judge
**how much a decision matters** by whether it can be undone, keep an **append-only log** of the
consequential ones, and — in `confirm` mode — stop before anything that is not routine. The
classification is deterministic (no model call), credentials and production hosts outrank the
command, and an unclassified tool is treated as a change rather than as harmless. Two rules make it
more than a log, each pinned by a test: a standing **server grant** is not consent to the
irreversible (that is still asked), and a **trusted plan** is consent to the plan, not to the
irreversible (it now goes through the gate anyway rather than being silently skipped). Off by
default. Known limitation, documented at the call site: `productionHost` is not passed here because
the host policy is evaluated at the SSH layer and a second opinion could disagree with it. 283 test
files / 2384 tests green, typecheck and production build clean. (2026-10-16)

**v3.1.1 released — rate limits are recoverable, and keys rotate.** A 429 used to retry the same
provider until the run died (the planner switched provider only on `auth`/`config`) and the parsed
`Retry-After` was ignored, so the app could retry inside the window the provider asked it to wait
out. Both fixed: one same-provider retry, then the next provider; the provider's own window honoured;
a wait past 30s treated as "move on". Providers can now hold **several keys** with round-robin
rotation, a cooldown that honours `Retry-After`, a circuit breaker with a capped exponential park,
and success clearing the history — managed in Settings → Providers, where key states are visible and
**the keys themselves never are**. An upgrade keeps every key: a test writes a pre-3.1.1 settings
file by hand and asserts it resolves, and that same test caught a **silent data-loss bug** in this
change (the settings migration dropped the new key list, so every key after the first vanished on the
next read). Full suite green, typecheck and production build clean. **Still outstanding from this
phase: decision-checkpoint mode** — a durable, reviewable record of the agent's consequential
decisions plus an optional pause before them. (2026-10-16)

**v3.1.0 released — the app remembers the project, and a spend cap that stops a send.** Phase 4
of the approved plan: a **project fact ledger** with validity windows (a newer observation
supersedes an older one and keeps its history; facts reach the prompt as dated prior beliefs
that a current observation overrides; an invented `supersedes` id cannot invalidate anything;
learning is one bounded call that can never break a session) with a Settings → Memory view that
shows live, superseded and expired facts and can delete them. Plus a daily spend cap that warns
and then **refuses the send before the call**, reports an unpriced model as a lower bound rather
than counting it as free, and a flaky sandbox test fixed. Still outstanding from phase 4: key
rotation with a circuit breaker and 429-aware backoff, and decision-checkpoint mode. 276 test
files / 2312 tests green, typecheck and production build clean. (2026-10-16)

**v3.0.0 released — Restrained Clay, auto-update, image previews.** The whole interface moved
onto a real design-token layer (three-step radius, per-theme dual shadows, motion and z-index
scales, a warmer neutral ramp with the brand accent pinned by a test) and clay depth is applied
in tiers — full on touchable surfaces, soft on cards, and deliberately absent from tables, logs
and every security dialog. The app can finally update itself: a dependency-free updater reads a
dedicated **public** feed repository, verifies the installer against the release's published
SHA-256 before running it, and never acts without a click. Attached images get a preview
generated in main so the desktop path still never reaches the renderer. Fixed a diagnostics
probe that silently answered about a different server than the one asked about. The tree is
sanitised of the user's private infrastructure identifiers (history still holds them; recorded,
not rewritten). 267 test files / 2221+ tests green, typecheck and production build clean.
(2026-10-16)

**v2.9.2 released — a disconnected remote project is no longer reported as a missing path.**
Found by installing the app on the user's own machine and reading the live sidebar: main
defines a remote project's `exists` as "its VPS is connected", and `projectState()` in the
sidebar checked `exists` before its remote branch, so a remote project whose server was down
showed an amber dot, "Path not found" and a local **Locate** button for a path on a server.
The sidebar now applies the same guard `store.ts` already had
(`project.exists === false && project.type !== 'remote'`). 264 test files / 2177 tests green,
typecheck and production build clean. (2026-10-15)

**v2.9.1 released — the agent now works inside your project.** A local run's sandbox workspace
is rooted at the project folder (the user asked for this explicitly, having found that the
agent could not read the project's files or run its tests), the project is never owned or
deleted by the sandbox, and the file-change view is honest about writes that already landed
(`FileChangeView.applied`, before/after taken from the write rather than from re-reading the
file, no Reject for something already on disk). The system prompt no longer claims the user's
files are unreachable. Trade-off accepted: local edits are no longer gated by "review, then
Apply". Deny list, path containment and secret guard untouched, `..` still refused.
263 test files / 2172 tests green, typecheck and production build clean. (2026-10-14)

**v2.9.0 released — approvals, uploads, GitHub and the main page.** Everything from the
second report: read-only work no longer prompts (one canonical read-only set, and shell
wrappers are unwrapped and re-classified rather than trusted) and a scoped, expiring
"approve every command on this server in this project for 30 minutes" grant is offered
exactly where a permanent remember is refused; tool cards lead with a verb headline
("Ran a command on the server") with the raw command and exact id in the expanded body;
file and image upload actually works (registered in main, copied into the run workspace,
described by a workspace-relative path, and sent as real image parts to vision models); the
agent can discover servers itself via a read-only `list_servers` and every id-taking tool now
accepts an id, name or host; connecting GitHub is one click through an existing `gh` login,
and a wrong OAuth client id fails loudly instead of rendering an empty code box; and the main
page shows "Edited N files +A −R" per file in the transcript, the elapsed time and the model's
reasoning. 262 test files / 2166 tests green, typecheck and production build clean. Windows
artifacts built natively on Windows. (2026-10-14)

**v2.8.0 released — the nine reported problems, plus thinking and mid-run questions.**
All nine items from the user's report are fixed with regression tests: the opt-in token
preview, multiple simultaneous VPS connections (two causes: a single global status slot,
and an idle reaper that closed hand-connected servers), four independent loop wedges, raw
`target_host` migration, the project-switch dialog default, chat grouping under each
project, and an approval dialog that could outlive its decision. Added: `ask_user` so the
model can ask a question mid-run and continue the *same* run, and the model's own
reasoning (`reasoning_content` / Anthropic `thinking`), which the adapters previously
discarded — kept strictly out of `content` and rendered collapsed in the trace. The
status area now names the work in words and shows a durable per-file diffstat summary.
Also fixed the long-standing `goal-panel` test flake (two real races, verified with 10
consecutive parallel runs). 250 test files / 2024 tests green, typecheck and production
build clean. Windows artifacts built natively on Windows (`npm run build:win`): see
`release/SHA256SUMS.txt`. (2026-10-14)

**v2.7.0 released — light theme, UI/UX hardening and the full audit fix set.** Merged
`audit/fixes-v2.6.5` into `master` (`e2cce3d`, `--no-ff`), tag `v2.7.0`. 244 test files /
1941 tests pass, typecheck and production build green. Windows artifacts built **natively on
Windows** (`npm run build:win`, exit 0, no Wine needed): `AI Desktop Setup 2.7.0.exe`
(107.3 MB), `AI Desktop 2.7.0 Portable.exe` (107 MB), `SHA256SUMS.txt`. The light theme is a
default-on change: every colour is now a CSS variable and 82 files moved off theme-blind
palette utilities, with a contract test that recomputes the WCAG contrast of both palettes.
The application window was verified live over CDP in both themes (isolated `APPDATA`, so the
user's real settings/VPS records were never touched). See the v2.7.0 section at the end of
this file. (2026-10-14)

**v2.6.4 released — Multi-Project & Polish.** Released 2026-10-13. Merged `feature/v2.6.4-critical-fixes` into `master` (`8e12e9e`, `--no-ff`), tag `v2.6.4`. Full suite green (221 files, 1724 passed | 1 skipped, Docker-conditional); Windows artifacts published: https://github.com/Arashtahmasbi3/ai-desktop/releases/tag/v2.6.4. Ready for user testing on Windows. See the v2.6.4 sprint section at the end of this file. (2026-10-13)

**v2.4 Sprint — phases A–E complete; version bumped to 2.4.0. A.1 jobs, A.2 preflight, A.3 success verification, B.1 db migration, B.2 docker transfer, B.3 checksum verify, C.1 project users, C.2 project SSH key, C.3 worktrees, D.1 scaffolding. Branch: feature/v2.4-full-compliance.** (2026-10-05)

- Reviewed [`DEVELOPMENT_CHECKLIST.md`](./DEVELOPMENT_CHECKLIST.md) sections 1–3 (pre-sprint:
  precise definition, ordered backlog, ready environment) plus the ten golden rules; rules
  acknowledged. Sprint plan: [`SPRINT_v2.4_FULL_COMPLIANCE.md`](./SPRINT_v2.4_FULL_COMPLIANCE.md).


**v2.3.3 merged to master (no release). Pending v2.4 for full source-doc compliance. Release will happen after v2.4.** (2026-10-05)

- `master` at merge `e16e13f` (`Merge v2.3.3: Git-Aware Agent + Self-Diagnosis`,
  `--no-ff` from `feature/v2.3.3-git-aware`). **No tag and no GitHub Release** for
  v2.3.3 by decision — the release is deferred until after Sprint v2.4.
- Latest actual release remains **v2.3.2**.

- Latest release: **v2.3.2 (full release)** — installer + portable exe published on a GitHub
  Release with `SHA256SUMS.txt`
  (<https://github.com/Arashtahmasbi3/ai-desktop/releases/tag/v2.3.2>); `master` at the
  v2.3.2 merge (`f8919a2`), tag `v2.3.2`.
- **v2.3.2 — Remote-First Architecture & Security Alignment**: A.1 remote-first file routing,
  A.2 remote-aware project status, A.3 context-aware host policy, A.4 per-command timeouts,
  A.5 Plan Mode; B.1 backup-before-write, B.2 post-deploy health checks, B.3 rsync dry-run,
  B.4 context preview, B.5 `~/.ssh/config` import; C.1 per-project metadata, C.2 isolation UI
  + pre-approval policy warning. Also fixed an `allowedPaths` path-traversal bypass in
  `evaluateHostPolicy`. Full suite: **763 passed | 1 skipped** across 101 files.

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
- Tailwind CSS 3 (light + dark themes via CSS variables)
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
- UI: **light ("day") theme by default, dark theme, or `system`** (v2.7.0). Every colour
  is a CSS variable in `src/renderer/src/assets/main.css` (`:root` = light, `.dark` =
  dark) exposed through Tailwind in `tailwind.config.js`. Use the **semantic tokens
  only**: surfaces `bg-bg-primary` / `bg-bg-secondary` / `bg-bg-tertiary` /
  `bg-bg-elevated`, lines `border-border` / `border-border-strong`, text `text-fg-strong`
  / `text-fg` / `text-fg-muted` / `text-fg-subtle`, states `danger` / `warning` /
  `success` / `info`, brand `accent` (text/borders/tints) and `accent-solid` (filled
  buttons that carry `accent-fg`). A bare Tailwind palette class (`text-neutral-500`,
  `bg-red-500/10`, ...) is a **bug** — it is a fixed hex value and is therefore wrong in
  one of the two themes; `test/renderer/theme-tokens.test.ts` fails the build on one, and
  also recomputes the WCAG contrast of both palettes (text ≥ 4.5:1 on every surface).
  The theme lives in `src/renderer/src/lib/theme.ts`, is applied before React mounts in
  `main.tsx`, and is switched from the titlebar menu or Settings → General.
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
- **`dependencies` holds exactly one entry: `ssh2`** (v2.6.5). Everything the renderer uses
  (`@xterm/xterm`, `@xterm/addon-fit`, `i18next`, `react-i18next`) is bundled by Vite and
  therefore lives in `devDependencies` — that is what keeps `node_modules` out of the app.
  `ssh2` is the one genuine runtime dependency: it is externalized out of the main bundle and
  shipped through the explicit `node_modules/ssh2/**/*` globs in `electron-builder.yml`. Any
  *new* library used by main/preload must be added to `dependencies` **and** to those globs, or
  the packaged app will be missing it. `files` otherwise packages only `out/` + `package.json`.
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

## Pattern: Server references (id, name or host)

How the agent names a server, and why it never asks for a UUID (v2.8.1).

- **The model must be able to discover servers itself.** `list_servers`
  (`src/core/tools/server-tools.ts`) is offered on **every** remote path — with no pinned
  server, with a pinned-but-disconnected one, and on a plain task — because "which servers
  do I have?" has to be answerable before a server can be chosen. Before it existed, the
  only id the model could see was the active project's own (rendered by
  `buildRemoteGuidance`), and asking it to migrate to a *second* saved server ended with it
  demanding a UUID that the UI never displays. A roster read that *fails* is reported as an
  error, never as "no servers", or the model goes straight back to asking the human.
- **Ids, names and hosts are interchangeable at every call site.** Fifteen tools take
  `server_id` / `source_vps_id` / `target_vps_id`. Rather than editing each one,
  `wrapServerRefRoutes` (`src/core/tools/server-ref-executor.ts`) canonicalises those
  arguments to the saved id before dispatch, using the pure `resolveServerRef`
  (`src/core/tools/server-ref.ts`): exact id first (never second-guessed), then a
  case-insensitive name, then `host` or `host:port`.
- **An ambiguous or unknown reference FAILS with the candidate list.** Never take the first
  match — silently migrating to the wrong server is the worst possible outcome. A
  known-but-offline server gets "is not connected", which is a different error from
  "unknown" because the fix is different.
- **The roster is data, never a routing decision.** It must not be consulted by
  `resolveVpsForRun` / `reconcileRunServer`: a run stays pinned to the explicitly chosen or
  project server. `list_servers` is read-only in `approval.ts` and must stay OUT of
  `VPS_REQUIRING_TOOLS`, or asking about servers would itself demand a server.

## Pattern: Human labels for tool calls

Never show a raw tool id as the primary label (v2.8.1).

- `src/renderer/src/lib/tool-labels.ts` is the single source: `toolLabel` (the noun used by
  the live status, "Running {{tool}}…") and `toolHeadline` (a verb headline for a card or
  chip: "Ran a command on the server"), plus `summarizeCommand` / `summarizePath` /
  `truncateMiddle` for the one-line preview.
- `summarizeCommand` is **quote-aware** (a pipe or `-F'|'` inside quotes never splits),
  splits on top-level `;`, `&&`, `||`, `|` and newlines, drops a leading decorative
  `echo`/`printf` banner, and middle-truncates so trailing flags/hosts survive.
- The **raw id and the verbatim command stay reachable**: the card's tooltip, a
  `data-tool` attribute, and the expanded body. `ToolResultCard.hasBody` must include
  `command`/`path`, otherwise a successful shell card is not expandable at all and the raw
  command is lost.
- Deliberately left raw: the audit log, and the disclosures a user opens on purpose
  (approval "Show details", plan-step arguments, the task args JSON) — there the exact
  string is the point.

## Pattern: Approval — what may skip the prompt

Matching the label "Auto-approve safe tools" to what actually happens (v2.8.1).

- **Read-only is derived, not re-declared.** `READ_TOOLS` (`core/agent/approval.ts`) and
  `READ_ONLY_REMOTE_TOOLS` (`main/approval-gate.ts`) come from the canonical
  `READ_ONLY_TOOL_NAMES` (`@shared/profile`). Declaring them twice is how the four named
  diagnostics ended up prompting with a **Write** badge in `auto-write` mode while the app
  was telling the model to prefer them over free-form shell.
- **Wrappers are unwrapped, then RE-CLASSIFIED.** `timeout 12 ssh …`, `for …; do … done`,
  `bash -c '…'` and `env VAR=x …` made a chain of pure probes count as a write. Each is now
  unwrapped and its body classified again — never trusted outright, or
  `timeout 12 rm -rf /srv` becomes prompt-free. The safety negatives in
  `test/core/approval-readonly.test.ts` are the point of that test file.
- **Still asking, deliberately:** a bare `ssh host` (it opens a session, not a known read),
  `nc`, redirection, substitution, and anything the classifier cannot *prove* is a read.
  Unknown ⇒ write stays the default.
- **The deny list is upstream of everything.** Path containment, the secret-path guard, the
  rate limiter and the audit log all run after the approval gate and are never skipped.

## Pattern: The scoped server grant

The one escape hatch for repeated shell work (v2.8.1, `core/agent/server-grant.ts`).

- The user can grant "all commands on THIS server in THIS project" for 30 minutes, because
  per-command dialogs on your own VPS are exhausting and — since v2.5 P0-3 — shell and write
  tools are deliberately **not** rememberable at all.
- Invariants, each pinned by `test/security/server-grant.test.ts`: exact `vpsId` +
  `projectId` binding (an empty `vpsId` is a local run and can never match a remote grant);
  expiry evaluated on read, never by a renderer timer; stored apart from the permanent
  `always`/`tools`/`sessions` lists so a stale file cannot resurrect a permanent shell
  allow; and the check sits **inside** `if (!denyListed)`, so it suppresses the *user
  approval* only — a deny-listed command still prompts, and the host policy, containment,
  secret guard, rate limiter and audit log are untouched.
- `ApprovalOutcome.grant` is a separate field from `ApprovalOutcome.remember` on purpose:
  `ApprovalRememberScope` is contractually read-only, and widening it would put shell and
  write tools back into the permanently-remembered set P0-3 removed.

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
- `[PATTERN]` **Remote-First Workspace Routing.** `routeToolCall` (`core/agent/remote-routing.ts`) is a pure decision (`passthrough`/`redirect`/`error`) consulted by the orchestrator before every action: a `remote` project rewrites `read_file`/`write_file`/`run_command` to `remote_read_file`/`remote_write_file`/`remote_shell` with the remote root + `server_id`, and a remote project with no connected VPS errors instead of silently running locally. Decisions are data, so they are unit-testable without SSH or an LLM.
- `[AUTO-DECISION]` **v2.3.2 release topology.** `f8919a2` merged `feature/v2.3.2-security` into `master` (`--no-ff`), annotated tag `v2.3.2`, and a full GitHub Release with `AI.Desktop.Setup.2.3.2.exe`, `AI.Desktop.2.3.2.Portable.exe` and `SHA256SUMS.txt`. The D.2 traversal probe found a real bypass: `allowedPaths` compared raw strings, so `/srv/app/../../etc/passwd` passed a `/srv/app` rule — now lexically normalised and fail-closed (`normalizeAbsolutePath`/`isWithin`).
- `[AUTO-DECISION]` **v2.3.3 A.1/A.2 — git-aware workspace detection.** `detectWorkspace(exec, path)` (`src/core/remote/workspace-detect.ts`) runs a cheap `test -d .git` probe first and only asks git for branch/remote/dirty when it is a repo, all through an injected `exec` (testable without SSH). `AgentService.buildRemoteRuntime` detects once per run and caches for 30s per `server:path`, appending `buildWorkspaceSystemHint` to the prompt. The chat header shows `WorkspaceBadge` (branch or "No git"). Detection is **advisory**, not security-sensitive: it only shapes the prompt and UI.
- `[AUTO-DECISION]` **v2.3.3 A.3 — per-tool failure blocking.** Rather than aborting the whole run when a tool keeps failing, `LoopDetector.beforeToolCall` returns `{action:'block'}` for a tool that failed twice in the session; the orchestrator emits a synthetic blocked result and the model is told to try an alternative (`read_file`/`list_dir`). A later success clears the block, and `reset()` clears all of them.
- `[AUTO-DECISION]` **v2.3.3 B.1/B.2 — git setup & status.** `buildGitSetupCommands` is a pure planner (preview shown before anything runs); `.gitignore` is written via a heredoc (`cat > file << 'EOF'`), not a temp file, and the path is POSIX-quoted. `parseRemoteGitStatus` parses `--porcelain=v1 --branch` for the sidebar pill. Both keep `core` free of `node:child_process` so the renderer can reuse the formatters.
- `[AUTO-DECISION]` **v2.3.3 C.1/C.2/C.3 — self-diagnosis + install assistant.** Health probes run in parallel over the injected `exec` and are parsed into a shared `SystemHealth`. Missing tools map to a declarative `InstallRecipe`; `assertInstallAllowed(recipe, approved, elevated)` is the single security gate (approval always required, sudo needs a second confirmation) and `runRemoteCommands` aborts at the first failure. The renderer only chooses options — every command runs in main through the guarded remote shell.
- `[PATTERN]` **Pure core, injected boundaries.** Anything that both main and renderer need, or that must be tested without SSH/LLM, lives in `src/core/*` as a pure function over injected callbacks (`WorkspaceExec`, `exec`). `src/main/*` wires these to real `AppServices`; the renderer imports only the pure formatters/types. This kept v2.3.3's detection, parsing, health, recipes and command runners unit-testable end to end.
- `[AUTO-DECISION]` **v2.4.1 A–C — wiring the v2.4 tool modules into the agent + UI.** `src/main/v24-tools-wiring.ts` is the single choke point: `planV24Tools(host, enabledTools)` returns `{ extraTools, routes, hint }`, so `planRemoteRuntime` stays a thin composition and the tool list is testable with a fake SSH host. The canonical toggle list lives in `src/shared/tool-toggles.ts` (shared by main + renderer so they cannot drift); `enabledToolNames(undefined)` means "all on". `AgentRunRequest.enabledTools` threads the Settings toggles from `store.send` → main. db/docker need cross-host transfer, so they are only registered when the host exposes `resolveServer`; project_user/worktree/scaffold need only `exec`. UI: `SettingsTools` (localStorage via `lib/tool-toggles.ts`) and `ToolResultCard` (inline in the chat for `role:'tool'` messages, carrying `toolCall:{name,ok,detail}`). A–C committed as three green commits (`b03e658`, `1a8582b`, `8cfa165`); Phase D (merge/tag/push) left pending explicit confirmation because the sprint's `v2.4.0` tag name conflicts with the new `v2.4.1` scope.

- `[AUTO-DECISION]` **v2.4 A.1 — Job ID + long-running tasks.** `JobManager` (`src/core/agent/job-manager.ts`) classifies a command via `estimateDurationMs` (`@shared/jobs`) and, when it exceeds 60s, detaches it on the host under the strongest available supervisor (tmux -> systemd-run -> nohup), writing output/exit to `/tmp/<id>.log|.exit`. All SSH goes through an injected `exec`, and persistence through an injected `persist`, so `core` keeps no node imports and the renderer can typecheck it. `executeRemoteShell` gained an optional `jobs` runner; `AppServices` wires a real `JobManager` backed by `JobStore` (`~/.ai-desktop/jobs.json`), reloaded on boot. IPC: `jobs:list|refresh|status|kill`. UI: `JobCard` + self-polling `JobsPanel` mounted in `ChatPanel`.

- `[AUTO-DECISION]` **v2.4 A.2 + A.3 — preflight and success verification.** `preflight(exec, workspace, action)` (`src/core/agent/preflight.ts`) checks workspace existence, git cleanliness, disk (`df --output=pcent`, fail >90%) and PM2 on deploy; `preflightGate` in the orchestrator blocks any action whose preflight has a `fail`, and AgentService builds a gate for the active remote project over the existing SSH exec. `verifySuccess(text, recentToolCalls)` (`src/core/agent/success-verifier.ts`) blocks success claims (`completed/done/.../انجام شد`) unless a test/build/health-shaped call succeeded within 30s; enabled in AgentService, with one nudge before the run ends as `needs_input`. UI: `PreflightBanner`, `SuccessWarning`. A.2 and A.3 share orchestrator/agent-service edits, so they were committed together to keep every commit green.

- `[RELEASE]` **v2.4.1 released.** Merged to `master` (`43be7c7`) and tagged `v2.4.1`. Windows artifacts built from Linux via Wine (`npm run build:win`) and published as a **GitHub Release** (not prerelease): `AI.Desktop.Setup.2.4.1.exe`, `AI.Desktop.2.4.1.Portable.exe`, `SHA256SUMS.txt`. GitHub's server-side asset digests match the local hashes. Binaries are unsigned (SmartScreen warned in the release notes). 939 tests pass.

- `[RELEASE]` **v2.4.2 released.** Merged to `master` (`b6207d4`) and tagged `v2.4.2`. Windows artifacts built from Linux via Wine 10.0 (`npm run build:win`, exit 0) and published as a **GitHub Release**: `AI.Desktop.Setup.2.4.2.exe`, `AI.Desktop.2.4.2.Portable.exe`, `SHA256SUMS.txt`. 947 tests pass (1 skipped). Binaries are unsigned, so SmartScreen may warn (noted in the release). Loop Detector fixed (args-aware + shell progress) — the agent can now explore projects freely without false loop stops.

- `[MILESTONE]` **v2.5-P0 complete** — 4 security tasks, 75 new tests, 1016 total. Merged to `master` (`6e831e6`, release prep `9b483db`) and tagged `v2.5.0-p0` (no full release; a **pre-release** is published only for testing at https://github.com/Arashtahmasbi3/ai-desktop/releases/tag/v2.5.0-p0). Windows artifacts built from Linux via Wine 10.0 (`npm run build:win`, exit 0): `AI.Desktop.Setup.2.5.0-p0.exe` (`10815005…`), `AI.Desktop.2.5.0-p0.Portable.exe` (`8cd05ab…`), `SHA256SUMS.txt`. Awaiting Windows + VPS testing before P1.

- `[AUTO-DECISION]` **v2.4.2 — loop detector false positives.** The per-tool-call guard hung off the tool *name*, so `run_command pwd` → `run_command ls` → `run_command cat` tripped the 5-repeat STOP. `computeLoopHash(toolName, args)` (`src/core/agent/loop-detector.ts`) now keys the window on normalized arguments: command for shell tools (`run_command`/`remote_shell`/`shell_exec`), path for filesystem tools, `stableStringify(args)` otherwise; identical repeats still stop. Additionally a *successful* `run_command`/`remote_shell` now calls `markProgress()` in `agent-orchestrator.ts` (added to `progressTools`) so distinct shell work starts a fresh window; the step-level analyzer still catches genuine repeats. Old `test/core/loop-detector.test.ts` test 8 encoded the buggy name-only behaviour and was rewritten. Sprint doc: `SPRINT_v2.4.2_LOOP_FIX.md`. Shipped in the v2.4.2 release (see the `[RELEASE]` entry above).

- `[AUTO-DECISION]` **v2.5 P0-2 — remote path containment.** For a remote project, an absolute path the model emitted (`/etc/nginx/nginx.conf`, `/root/.ssh/authorized_keys`) was accepted verbatim: `resolveRemotePath` returned absolute inputs unchanged and `executeRemoteFs`/`executeRemoteShell` had no notion of the project root. Added `src/core/remote/path-guard.ts` (pure POSIX): `enforceProjectPath` rebases + normalizes + proves containment (sibling `/opt/app-evil` rejected), rejects control chars and empty input; `extractAbsolutePaths`/`enforceCommandPaths` pull absolute paths out of a shell command (URLs stripped, `/dev/*` allowed) and validate each. Enforced in three places: `routeToolCall` (stray local file/shell tools redirected for a remote project), `executeRemoteFs` (all six path tools, before any SFTP/shell call) and `executeRemoteShell` (before deny-list and job detach). The root is threaded as optional `projectRoot` on `RemoteFsDeps`/`RemoteShellDeps` from `buildRemoteRuntime` → `planRemoteRuntime`, so callers that do not know the active project (and local projects) are unaffected; enforcement only kicks in for a remote project with a known root. 26 tests in `test/security/path-guard.test.ts`.
- `[AUTO-DECISION]` **v2.5 P0-3 — remembered approvals are read-only, scoped and expiring.** A "Remember" choice was stored per tool *name* with no server/project and no expiry (`ApprovedCommands.tools`/`sessions`), so one `remote_shell` approval then auto-ran any command on any connected VPS. Added `src/core/agent/remember-policy.ts` (pure): `REMEMBERABLE_TOOLS` (reads/listings only — shell, writes, migrate, db_*, scaffold_* excluded), `canRememberTool`, `createRememberedApproval` (throws for sensitive tools), and `isRememberedApprovalValid` (requires same tool + same `vpsId` + same `projectId` and `now <= expiresAt`; `REMEMBER_TTL_MS = 30 min`). `ApprovedCommands` gained a `scoped` array + `rememberScoped`, and its `isApproved` now (a) returns `false` for any non-rememberable tool — neutralising stale pre-fix global entries — and (b) honours a scoped entry only for the matching VPS+project; `rememberAction/Tool/Session` no-op for non-rememberable tools. `createApprovalGate` takes `vpsId`/`projectId`, refuses to persist sensitive remembers, checks scoped approvals, and no longer fires `onSuggestion` for sensitive tools. `AgentService.run` supplies the active project's id + `vpsId ?? ''`; the suggestion IPC (`agent:rememberApprovalTool`) derives the same scope and no-ops for sensitive tools. UI: `ApprovalDialog` hides the Remember checkboxes + "Approve all" and shows a warning for non-rememberable tools. `ApprovedCommandKind` gained `'scoped'` so scoped entries are listed/revocable. 26 tests in `test/security/remember-policy.test.ts`; two pre-existing `approved-commands` tests that encoded remembering `write_file` were rewritten to reads.
- `[AUTO-DECISION]` **v2.5 P0-4 — no auto VPS selection.** `planRemoteRuntime` treated a task that merely matched `VPS_KEYWORDS` (`/vps|ssh|server|remote/`) as licence to pin the run to `connectedServers()[0]`, so a prompt phrase (or injected text) could silently bind a side-effecting `remote_shell`/migration/tool to an unchosen host. Added `src/core/agent/vps-resolver.ts` (pure): `resolveVpsForRun` picks an **explicit** selection first, then the active remote **project**'s own `vpsId`, then fails closed for a VPS-requiring run, then allows local; plus `requiresVps`/`VPS_REQUIRING_TOOLS` for the remote/migration/worktree/project-user tool set. `planRemoteRuntime` no longer computes `target = pinned ?? connected[0]` — it resolves via `resolveVpsForRun` and, when nothing is selected, returns only a hint ("choose a VPS … Do not assume or auto-select a server") with no remote tools; a selected-but-disconnected host also yields no tools. `buildRemoteRuntime` resolves the explicit-or-project VPS with the same function. A VPS-only tool group being enabled now counts as "wants a VPS" (hint instead of silent host pick). Tests: `test/security/vps-resolver.test.ts`; the four v2.4.1 wiring tests and two `vps-tool-injection` tests that encoded the old keyword auto-select were rewritten to pass an explicit server (or assert the hint). Note: the checklist's `Project.remoteVpsId` does not exist here — the record uses `type: 'remote'` + `vpsId`; the resolver takes a structural `{ type, vpsId }`.
- `[PATTERN]` **Remember policy: fail-closed.** Old global records are auto-invalidated; no migration is needed because the check itself rejects unscoped tools. `ApprovedCommands.isApproved` returns `false` for any tool not in `REMEMBERABLE_TOOLS` before consulting stored data, so stale `tools`/`sessions`/`always` entries for shell/write tools are inert without rewriting the file.
- `[PATTERN]` **RunStore & AgentRun live in `src/core/agent/`, not `src/shared/types/`, because they are main-side only.** Follow the flat-file convention of `session-store.ts` and `job-store.ts`. `shared/` is reserved for code that both main and renderer need; a main-only run/state module belongs with its siblings in `core/agent/`.
- `[AUTO-DECISION]` **v2.5 P0-1 — immutable Project Run isolation.** `AgentService.captureChange` recorded a `FileChangeView` with only a `runId`, and `applyChange` wrote through `FileService`'s *current* root, so a patch captured on project A could land in project B if the user switched before applying. Added `RunStore` (`src/core/agent/run-store.ts`): each run is bound to a `projectId` + `projectRoot` snapshot plus a `baseRevisions` map. `run()` creates the run; `capturePatch` reads the base content from the run's own root and stores its sha256 (a failed read means a new file, so no base); `applyPatch` re-checks run freshness (30-min TTL), that the active project still matches, and that the file hash is unchanged (and a new file is still absent) before writing into `run.projectRoot` — never the live root. `FileService` gained `resolveSafeAt`/`readAt`/`writeAt`; `ProjectFiles extends RunFileIO`. `AppServices` owns the `RunStore` (`runs`) and injects it. 10 real-FS tests in `test/core/run-isolation.test.ts`. Note: the checklist path `src/shared/types/agent-run.ts` was intentionally not used — the type is main-only and lives in core, consistent with `session-store.ts`/`job-store.ts`.
- `[DEV-DEPS]` **v2.5.2 — component-test tooling is sanctioned.** `@testing-library/react`, `@testing-library/dom` and `jsdom` are **approved devDependencies** for renderer tests (no new *runtime* deps). Component tests opt into the DOM with a per-file `// @vitest-environment jsdom` docblock (the default vitest environment stays `node` for core tests). Do not add `@testing-library/jest-dom`; assert plain DOM properties (e.g. `button.disabled`) instead of custom matchers.
- `[AUTO-DECISION]` **v2.5.2 — transparent tool detail (Phases 1–5).** Make Chat transparent about what the agent does on VPS/local projects. Data flows as: executor result → structured `AgentToolResult` fields (`command/serverId/cwd/path/stdout/stderr/exitCode` + `recovery`) → `buildToolDetail` (`src/core/agent/tool-detail.ts`, redacts every string via `redact()` then caps stdout 10KB / stderr 2KB / 50 lines) → `tool:result` `AgentEvent` (plus the same fields on the existing `action.ok/error` log). The store now builds inline `role:'tool'` messages from `tool:result` **only** (logs feed the timeline/diagnostics, never the chat) — this separation is deliberate. `ToolCallView`/`ToolResultView` live in `shared/ui.ts`; `ToolResultCard` renders command preview + exit-code badge + expandable stdout/stderr/target/cause/recovery, and stays backward-compatible with the legacy `{name, ok, detail}` props. `Phase 6` (remote diff) and `Phase 7` (crash diagnosis) are deferred to the next milestone. Tests: `test/core/tool-details.test.ts`, `test/core/tool-detail.test.ts`, `test/renderer/tool-detail-ui.test.tsx`.
- `[RELEASE]` **v2.5.2 merged and pre-released.** Tool details UI complete. Merged to `master` (`15c7dfc`, release bump `7442d9e`) and tagged `v2.5.2`; a GitHub **pre-release** is published at https://github.com/Arashtahmasbi3/ai-desktop/releases/tag/v2.5.2. Windows artifacts built from Linux via Wine 10.0 (`npm run build:win`, exit 0): `AI.Desktop.Setup.2.5.2.exe`, `AI.Desktop.2.5.2.Portable.exe`, `SHA256SUMS.txt`; GitHub's server-side asset digests match the local hashes. Binaries are unsigned (SmartScreen may warn — noted in the release). 1044 tests pass (1 skipped). Pending user testing on Windows before starting v2.5.3 (Diagnostic Mode).
- `[AUTO-DECISION]` **v2.5.2 — phase + recovery transparency.** `buildTimeline` (`src/renderer/src/lib/timeline.ts`) carries `phase` on steps and adds a `recovery` step kind for `recovery.*` logs (retry/switch/stop, attempts, from→to); `ProgressTimeline` shows them as a muted second line. `LoopStopCard` is now context-aware via `buildLoopStopModel` (`src/renderer/src/lib/loop-stop.ts`): a per-reason hint, the stuck command and VPS host extracted from `recentActions` (e.g. `remote_shell(server_id=…, command=…)`), the recommended action highlighted, and Continue disabled after a `failure_streak`.


- `[AUTO-DECISION]` **v2.5.3 Fix 4 - Diagnostic Mode is READ-ONLY end to end.** The policy (Fix 1) widened `enforceProjectPath` for any caller, so once enabled a `remote_write_file`/routed `write_file` could overwrite an exposed system path (`/etc/os-release`) and a shell command (`echo x > /etc/os-release`, `sed -i`) could write it. Two gates added: (1) `enforceProjectPath(path, root, diagnostic, mode)` now takes `mode: 'read' | 'write'` (default `'read'`) and the diagnostic branch only fires for reads; `remote-fs-tools.containPath` passes `'write'` from `writeFile`, and `routeToolCall`'s `guarded()` passes `'write'` for the `write_file` case. (2) For the shell, `enforceCommandPaths` only honours a `source:'diagnostic'` path when the whole command is read-only via `isDiagnosticReadOnlyCommand` (new in `command-whitelist.ts`): a single command or `|`-pipeline whose every segment is in `DIAGNOSTIC_READ_ONLY_COMMANDS` (`cat/head/tail/grep/journalctl/dmesg/stat/ls/wc/...`) with NO chaining/substitution/redirection metacharacters (`; & $ ( ) { } < > \` newline`); globs are allowed since they only widen a read. Writers deliberately excluded (`sed -i`, `sort -o`, `find -delete/-exec`, `tee`, `cp`, `mv`, `rm`, `chmod`, `chown`, `truncate`, `tar`). Wiring: `AppServices` owns the in-memory policy (`getDiagnosticPolicy`/`diagnosticStatus`/`enableDiagnosticMode`/`disableDiagnosticMode`, TTL 30 min, broadcast `diagnostic:status`), `AgentService` reads it once per run and threads it into `planRemoteRuntime` (shell + fs deps) and the routing context, and sets orchestrator `diagnosticMode: () => Boolean(this.getDiagnosticPolicy())` so the system prompt matches the enforced posture. IPC `diagnostic:status|enable|disable`, preload `window.api.diagnostic`, store slice `diagnostic` + `refreshDiagnostic`/`setDiagnosticMode`, UI `DiagnosticModeSection` (Settings -> Connections -> SSH) and a `DiagnosticBadge` in the chat header. Tests: `test/security/diagnostic-readonly.test.ts` (read-only gate) and `test/core/diagnostic-mode-wire.test.ts` (policy reaches the executors; write blocked). Full suite 1086 passed | 1 skipped; typecheck/build green.
- `[AUTO-DECISION]` **v2.5.3 Fix 5 - never retry a target policy already refused.** A refused path/command can only be refused again, so the loop detector now remembers it. `AgentToolResult` gained an optional `blocked?: boolean`; `RemoteShellToolExecutor`/`RemoteFsToolExecutor` set it whenever the underlying result was a policy refusal (`result.blocked`). `LoopDetector` holds `blockedPaths`/`blockedCommands`: `afterToolCall(toolName, result, args?)` records the refused target (normalised with the same `normalizePath`/`normalizeCommand` used by `computeLoopHash`), and `beforeToolCall` returns `{ allow:false, action:'block', reason }` for a repeat so **only that call is skipped, not the whole run** (the reason tells the model to try an alternative or ask for Diagnostic Mode). A policy block is deliberately **not** counted as a broken tool — it never increments the failure streak nor adds to `blockedTools`. `reset()` clears both sets. Rejected alternative considered: returning `allow:false` without `action:'block'` (as the ticket sketched) would have stopped the entire run on the first repeat; `'block'` matches the A.3 tool-skip semantics and is the correct granularity. Tests: `test/core/retry-strategy.test.ts` (8 scenarios).
- `[AUTO-DECISION]` **v2.5.3 - "Continue" reopens blocked targets (per-run state).** `AgentOrchestrator.run()` builds a **fresh** `LoopDetector` per run, so a user "Continue" (which starts a new run after `needs_input`) starts with empty `blockedPaths`/`blockedCommands`. Containment will refuse an off-limits target again if it is still off-limits, but the block is never carried across runs. This satisfies the ticket's "Continue temporarily reopens the path" requirement **by construction**, so no extra API was added; within a single run a refused target stays blocked (the desired behaviour). Covered in `test/core/retry-strategy.test.ts` ("a fresh run (Continue) starts with no blocked targets").
- `[AUTO-DECISION]` **v2.5.3 Smarter Prompt - concrete context is injected, not just described.** Fix 3 already added discovery/blocked-path/Diagnostic-Mode guidance; the context-awareness half only said "shown in the chat header", which still invited a tool call. Now `buildRemoteGuidance(diagnosticEnabled, context?)` renders an explicit `Context awareness (already known - do NOT spend tool calls re-discovering)` block with `- Project / - Path / - VPS / - Environment`, falling back to the old generic hint when no context is passed (so existing callers/tests are unaffected). `RemotePromptContext` flows through `SystemPromptOptions.remoteContext` → `AgentOrchestratorOptions.remoteContext` → `buildSystemPrompt`; `AgentService.run` builds it from the active project (name, path, vpsId, environment) and a new `resolveVpsName` option, wired in `AppServices` from the SSH server store. Advice on "which project am I on?" is now answerable without `remote_list_dir`/`remote_read_file`/`remote_shell`. Tests: extended `test/core/remote-guidance.test.ts` (+4).
- `[RELEASE]` **v2.5.3 - Diagnostic Mode + Smarter Prompt (PUBLIC).** Fixes 1–5 + Smarter Prompt complete on `feature/v2.5.3-diagnostic-mode` (`ca182c3`→`c85c0e0`, docs `bcaa446`); `package.json` bumped `2.5.2`→`2.5.3`. Integration coverage: `test/e2e/v2.5.3-integration.test.ts` (context answer with zero tool calls; blocked path refused on retry with the executor reached only once; Diagnostic ON reads `/etc/os-release`; Diagnostic OFF rejects it). Full suite **1102 passed | 1 skipped**; `typecheck` + `build` green. **Merged** to `master` (`4a083a8`, `--no-ff`), **tagged** `v2.5.3`, Windows artifacts built from Linux via Wine 10.0 (`npm run build:win`, exit 0) and published as a **public (non-prerelease, latest)** GitHub Release: https://github.com/Arashtahmasbi3/ai-desktop/releases/tag/v2.5.3 → `AI.Desktop.Setup.2.5.3.exe`, `AI.Desktop.2.5.3.Portable.exe`, `SHA256SUMS.txt`; all three assets `uploaded` and GitHub's server-side asset digests match the local hashes. Binaries are unsigned (SmartScreen may warn — noted in the release). **v2.5.3 released. Diagnostic Mode + Retry Strategy complete. 1102 tests pass.** Pending user testing on Windows.
- `[AUTO-DECISION v2.5.3]` Blocked path returns `action:'block'` not stop-run. Block does not increment failure streak. Better UX for retry strategy.



## Sprint v2.5.4 — Usage Settings + Context Preview Toggle
- `[AUTO-DECISION v2.5.4]` Token counter kept in Composer for backward compat with v2.5.2. Usage recorded per-run (aggregate identical to per-call sum).
- `[ALREADY-DONE]` Task 1.1 — context preview toggle (implemented in v2.5.2). `showContextBeforeSend` lives in `store.ts` (persisted under `ai-desktop:show-context-before-send`, default ON), the toggle is in `SettingsPanel.tsx`, and the dialog is `ContextPreviewCard.tsx`. v2.5.4 only extracted the composer's submit branch into `src/renderer/src/lib/context-gate.ts` (`decideSend`) and added `test/renderer/context-preview-toggle.test.tsx` (4 scenarios: preview on, preview off, immediate store apply, restart persistence).
- `[DECISION]` Task 1.2 — keep the live composer token counter. The ticket said "remove the token counter from the Composer", but that counter is a v2.5.2 feature (`showTokenCount`, toggle in Settings → Memory) and the hard rule says v2.5.2 features must not break. The full token accounting (input/output/cost, per-provider, per-model, 7-day chart, reset, CSV) moved to Settings → Usage; the lightweight live estimate stays. The overflow warning is untouched.
- `[DECISION]` Task 1.2 — usage is aggregated **per run**, not per raw LLM call. `AgentOrchestrator` already sums `Usage` across every LLM call in a run; the renderer records one `UsageRecord` per `run:end` (provider/model + prompt/completion tokens). This keeps the contract change to a single optional `usage` field on `run:end` instead of a new streaming event, and the numbers are identical to per-call rows summed.
- `[DECISION]` Task 1.3 — the "Agent" indicator is driven by `worker.online` (per approved decision). Tooltip shows the worker state and the remote `host:port` when remote access is enabled; `remote: host:port` and the VPS indicator remain separate.
- Files: `src/shared/ui.ts` (run:end usage), `src/main/agent-service.ts` (emit usage), `src/renderer/src/lib/usage.ts` (new), `src/renderer/src/lib/context-gate.ts` (new), `src/renderer/src/store.ts` (usage slice + `recordUsage`/`resetUsage`), `src/renderer/src/components/SettingsUsage.tsx`, `src/renderer/src/components/StatusBar.tsx`, `src/renderer/src/components/ChatPanel.tsx`, i18n `en`/`fa`.
- Tests: `test/renderer/context-preview-toggle.test.tsx` (4), `test/renderer/usage.test.tsx` (10), `test/renderer/statusbar-agent.test.tsx` (2) = 16 new. Full suite **1118 passed | 1 skipped**; `typecheck` + `build` green. NOTE: renderer tests that import `store.ts` must be `.tsx` — `.ts` files land in `typecheck:node`'s program and fail on DOM globals.
- Commits: `b8e374f` (1.1), `ff5ea32` (1.2), `1778539` (1.3). Branch `feature/v2.5.4-usage-preview`.

## Sprint v2.5.5 — Approval UX
- `[DECISION]` Task 2.1 — skip approval for whitelisted read-only commands. `src/core/remote/command-whitelist.ts` gained `isReadOnlyShellCommand`, a **conservative** classifier: a single command or a `|` pipeline where every segment is allow-listed, refusing redirection, `tee`, command substitution and chain metacharacters; subcommand gates for `systemctl`/`docker`/`pm2`/`kubectl`/`node`/`npm`/`python`. `src/main/approval-gate.ts` bypasses the prompt only for those commands (deny list still always asks).
- `[DECISION]` Task 2.2 — "Trust this plan for 30 minutes". Approving (or editing) a plan with the new trust checkbox stores an `ApprovedPlan` (`src/core/agent/approved-plan.ts`, `createApprovedPlan`/`isPlanActive`/`planIncludesStep`/`shouldAutoApprove`) keyed by run id in `AgentService.planTrust`. A trusted plan's own step ids auto-approve for `PLAN_TRUST_TTL_MS` (30 min); a **deny-listed** command is never auto-approved, and the trust is cleared when the run ends or the user clicks the header chip (`PlanTrustChip`, IPC `agent:stopPlan`). Prompts that still appear carry a `reason` (`outside_plan`/`write`/`dangerous`/…) shown in the dialog.
- `[DECISION]` Task 2.3 — the approval dialog now explains *why* and *what*: structured rows for **Reason** (`not_whitelisted`/`outside_plan`/`write`/`dangerous`), **Tool**, **Server**, **Working dir** and a **Category** badge (`Read`/`Write`/`Destructive`; shell and writes count as write). The command/args block is LTR. i18n keys `approvalTool`/`approvalCommand`/`approvalCategory*`.
- `[DECISION]` Task 2.4 — clearer safety copy. The cannot-remember message now reads "…requires explicit approval each time. It cannot be remembered because it can modify the system.", and a **no-undo** warning ("Changes will be applied directly to the server. No undo available.") is shown for write/shell/dangerous prompts.
- Files: `src/core/remote/command-whitelist.ts`, `src/main/approval-gate.ts`, `src/shared/approval.ts`, `src/core/agent/approved-plan.ts` (new), `src/shared/plan.ts`, `src/shared/ui.ts`, `src/main/agent-service.ts`, `src/main/approval-broker.ts`, `src/main/app-services.ts`, `src/main/ipc.ts`, `src/preload/index.ts`/`index.d.ts`, `src/renderer/src/store.ts`, `src/renderer/src/components/{PlanCard,PlanTrustChip,ApprovalDialog,ChatPanel}.tsx`, i18n `en`/`fa`.
- Tests: `test/main/approval-whitelist.test.ts` (9), `test/core/approved-plan.test.ts` (9), `test/renderer/plan-trust.test.tsx` (4), `test/renderer/approval-dialog.test.tsx` (5). Full suite **1145 passed | 1 skipped**; `typecheck` + `build` green. P0-2 containment untouched.
- Commits: `e438b81` (2.1), `faf4426` (2.2), `c6702df` (2.3), `3f274ad` (2.4). Branch `feature/v2.5.5-approval-ux`.

## Sprint v2.5.6 — Crash Diagnosis + Read-Only Shell Relaxation
- `[DECISION]` Task 3.1 — `isReadOnlyShellCommand` now accepts **compound** read-only commands (`;`, `&&`, `||`, pipelines) and a wider base set (`cd`, `pgrep`, `ping`, `curl`/`wget`, `git`). Safety guards added rather than loose matching: `cd` is admitted only with an **absolute** target (a relative `..` could escape the root without naming a path), any `..` segment is refused, `curl`/`wget` with an output flag (`-o`/`-O`/`--output`/`-P`/…) is a write, `git branch/remote/config` refuse their mutating forms, `find -exec/-delete` still refused, and `sudo`/`sed -i` are explicit write indicators. `enforceCommandPaths` treats such a command as read-only, so a `;`-chained probe may read a Diagnostic-Mode path while a writer still cannot. P0-2 unchanged.
- `[DECISION]` Task 3.2 — `diagnose_crash` is a **fixed, read-only** probe set (`src/core/agent/crash-diagnosis.ts`: `CRASH_PROBES`/`buildCrashProbes`, `runCrashDiagnosis`, `analyzeEvidence`, `formatDiagnosis`). Pure over an injected `exec`, so it is unit-tested without SSH. Causes are derived in order: `pm2_process_error` → `out_of_memory` → `disk_full` → `systemd_service_failed` → `unknown`. Probes that touch a system path (`syslog-errors` → `/var/log/syslog`) are **skipped unless Diagnostic Mode is on** (reusing `isDiagnosticAllowed`). Wired as an `extraTool` in `planRemoteRuntime` (`src/core/tools/crash-diagnosis-tool.ts`), pinned to the selected server, and added to `READ_ONLY_REMOTE_TOOLS` so it never prompts for approval.
- `[DECISION]` Task 3.3 — `buildRemoteGuidance(diagnosticEnabled, context, crashDiagnosis)` gains a **Crash diagnosis workflow** block (call `diagnose_crash` first; report Evidence + Diagnosis with confidence and recommendations; never guess or invent one-liners; ask before reaching further). `buildSystemPrompt` gains `crashDiagnosis`, set from `extraToolNames.has('diagnose_crash')`, and is only injected for remote runs.
- Files: `src/core/remote/command-whitelist.ts`, `src/core/remote/path-guard.ts`, `src/main/approval-gate.ts`, `src/core/agent/crash-diagnosis.ts` (new), `src/core/tools/crash-diagnosis-tool.ts` (new), `src/main/agent-service.ts`, `src/core/agent-orchestrator.ts`.
- Tests: `test/core/read-only-shell.test.ts` (17), `test/core/crash-diagnosis.test.ts` (10), `test/core/crash-diagnosis-prompt.test.ts` (3) = **30 new**. Full suite **1175 passed | 1 skipped**; `typecheck` + `build` green; P0-2 (`test/security` + approval-whitelist) **189 passed**.
- Commits: `03d18c2` (3.1), `012134e` (3.2), `66eb00c` (3.3). Branch `feature/v2.5.6-crash-diagnosis`.
- NOTE: `package.json` is still **2.5.3** (v2.5.4/v2.5.5 did not bump). Version bump for v2.5.6 deferred to the checkpoint pending the user's decision.

## Sprint v2.5.7 — Task Planning + Loop Recovery
- `[AUTO-DECISION v2.5.7]` Loop redirect uses model-based auto-recovery (observation with `code:'redirect'`) instead of manual button. Better UX, no user interruption.
- `[DECISION]` Task 4.1/4.2 — the `TaskPlanner` (`src/core/agent/task-planner.ts`) is **pure over injected `callLLM` + `execute`**, so it is unit-tested without SSH or a real model. `createPlan` asks for 3–7 ordered steps, normalises them (numbered/clamped), and `executePlan` runs each step, retrying a failed step once before recording a `failed` status + reason. Plans are surfaced through new `task:plan` / `task:step` / `task:complete` / `task:failed` events (`src/shared/task-plan.ts`, `src/shared/ui.ts`).
- `[DECISION]` Task 4.3 — the task tracker is a panel **above** the chat transcript (`TaskTracker.tsx`), not a separate window; it renders per-step `data-status`, a progress bar and the Pause/Resume/Stop controls. Plans are kept per run in the store (`taskPlan`, `taskPlans`, `taskPaused`) so a finished plan stays viewable.
- `[DECISION]` Task 4.4 — system prompt guidance (`buildSystemPrompt` + remote guidance) teaches the model to decompose a complex goal and to prefer an alternative from the strategy table instead of repeating a failing call.
- `[DECISION]` Task 4.5 — the loop guard **redirects** instead of stopping. `LoopDetector` gained a `redirect` action: a blocked path/command or a repeatedly-failing tool returns a concrete `StrategyAlternative` (`src/core/agent/strategies.ts`) instead of ending the run. Redirects are handed to the model as an observation (`code:'redirect'`) — the blocked call is never executed — and a redirect step is neutral in `observe()` (it does not count toward the failure-streak/no-progress stops). Only repeating the redirected call verbatim is a hard stop, and a redirect lifts the tool's failure block for the single alternative attempt. `ToolErrorCode` gained `'redirect'`.
- `[DECISION]` Spec asked for a manual "Try alternative" button in the task tracker; since the real path (`TaskTracker.tsx` + orchestrator) already hands the redirect to the model, model-based auto-recovery was implemented instead of a UI button (no UI hack).
- Files: `src/core/agent/task-planner.ts` (new), `src/core/agent/strategies.ts` (new), `src/core/agent/loop-detector.ts`, `src/core/agent-orchestrator.ts`, `src/shared/agent.ts`, `src/shared/task-plan.ts` (new), `src/shared/ui.ts`, `src/renderer/src/store.ts`, `src/renderer/src/components/{TaskTracker,ChatPanel}.tsx`.
- Tests: `test/core/task-planner.test.ts` (12), `test/core/strategies.test.ts` (6), `test/core/task-planning-prompt.test.ts` (2 files, 18), `test/core/loop-redirect.test.ts` (5), `test/renderer/task-tracker.test.tsx` (6), `test/e2e/v2.5.7-integration.test.ts` (3) = **50 new**. Full suite **1211 passed | 1 skipped**; `typecheck` + `build` green.
- Commits: `cbcf8b8` (4.1), `5b62494` (4.2), `ffa98d4` (4.3), `b6a65a5` (4.4), `1dc0fcc` (4.5), `db7e36b` (e2e). Branch `feature/v2.5.7-task-planning`.
- `[RELEASE]` **v2.5.7 released publicly.** All 4 sprints (v2.5.4-v2.5.7) merged. 1211 tests pass. Task Planning, Crash Diagnosis, Approval UX complete. Ready for Windows testing.
- `[RELEASE]` **v2.5.4-v2.5.7 merged and tagged.** Branch topology verified **chained** (`v2.5.4` ⊂ `v2.5.5` ⊂ `v2.5.6` ⊂ `v2.5.7`, all atop `master`), so a single `--no-ff` merge of `feature/v2.5.7-task-planning` into `master` (`600cc27`) carried all 22 commits; no conflicts. Per-sprint annotated tags created at each sprint tip (`v2.5.4`→`5d266de`, `v2.5.5`→`717ba11`, `v2.5.6`→`00d59cc`, `v2.5.7`→`600cc27`). `package.json` bumped `2.5.6`→`2.5.7`. Windows artifacts built from Linux via Wine 10.0 (`npm run build:win`, exit 0): `AI.Desktop.Setup.2.5.7.exe` (sha256 `200316a7dc758a21653f4e8ae796a795374f7402318a244b3ec6e5affa951197`), `AI.Desktop.2.5.7.Portable.exe` (sha256 `6bc84d5e06036812afa4289ef85c02ffdd1d1a9aceed6b1c18de8d5024a1543c`), `SHA256SUMS.txt`. Published as a **public (non-prerelease, latest)** GitHub Release: https://github.com/Arashtahmasbi3/ai-desktop/releases/tag/v2.5.7 — all three assets `uploaded`. Binaries are unsigned (SmartScreen may warn — noted in the release). **Ready for Windows testing.**

## Sprint v2.5.8 — Read-Only Detection Fix + Dialog Centering
- `[AUTO-DECISION v2.5.8]` Pure env assignments (`B=/path`) treated as read-only. Added `=` to segment boundary guard to prevent `..` escape via assignment. Dialog centering fixed with `fixed inset-0 z-50`.
- `[DECISION]` Root cause (debug-verified against the real classifier): `isReadOnlyShellCommand` stripped leading `VAR=value` tokens and then saw an empty token list for a segment that was *only* an assignment, returning `false`. Because `.every()` short-circuits, a single `B=/opt/...` segment poisoned the whole chain, so the user's read-only probe (`B=...; echo; find "$B"; cat "$B"`) asked for approval, rendered a **Write** badge (`categoryOf` maps `shell`→write) and looped. Fix: an all-assignment segment is a read (`hadTokens` guard); a genuinely empty part (`ls |`) is still refused.
- `[DECISION]` The `..` guard regex was widened from `/(^|[\s/])\.\.($|[\s/])/` to also treat `=` as a boundary. Without it, making assignments read-only let `B=../secret; cat "$B"` through — the value never named an absolute path, so P0-2 could not catch it either. This is the security half of the fix, caught by regression test 7.
- `[DECISION]` Fixes 2 (`$VAR` resolution) and 4 (fuzzy plan-trust) from the ticket were **not** needed: test 5 proved `$B` already passes (a `$`-reference is not an absolute path, so the classifier never rejected it), and the `approval-gate.ts:79-80` wiring already calls `isReadOnlyShellCommand`. Verified, not modified.
- `[DECISION]` Approval dialog centring: it used `absolute inset-0`, anchoring it to the ChatPanel `<section>` rather than the window (and clipping on short screens / after panel scroll). Changed to `fixed inset-0 z-50 ... items-center justify-center` (matching `ContextPreviewCard`/`SettingsPanel`/`GitHubSetupDialog`), with `max-h-[90vh] overflow-y-auto` on the panel.
- Files: `src/core/remote/command-whitelist.ts`, `src/renderer/src/components/ApprovalDialog.tsx`.
- Tests: `test/core/read-only-debug.test.ts` (7), `test/approval/read-only-integration.test.ts` (4), `test/renderer/approval-dialog.test.tsx` (+1 centring) = **12 new** (18 counting the new files' scenarios). Full suite **1223 passed | 1 skipped**; `typecheck` + `build` green.
- Commits: `964f77f` (Fix 1), `a88a06f` (dialog). Branch `feature/v2.5.8-readonly-detection`.
- `[RELEASE]` **v2.5.8 released publicly.** Merged to `master` (`bc62945`, `--no-ff`), tagged `v2.5.8`, `package.json` bumped `2.5.7`→`2.5.8`. Windows artifacts built from Linux via Wine 10.0 (`npm run build:win`, exit 0): `AI.Desktop.Setup.2.5.8.exe` (sha256 `9d916bc0581b0c2662753915a47ae5900e1efdd63167b04b2e91f680301a0823`), `AI.Desktop.2.5.8.Portable.exe` (sha256 `e6ba4cb33cf749eb597eb5e883d883cc70b4fa3776cdda591dacf82a3663880b`), `SHA256SUMS.txt`. Published as a **public (non-prerelease, latest)** GitHub Release: https://github.com/Arashtahmasbi3/ai-desktop/releases/tag/v2.5.8 — server-side asset digests match the local hashes. Binaries are unsigned (SmartScreen may warn — noted in the release). **1223 tests pass. Read-Only Detection Fix complete. Ready for Windows testing.**
  - Note: the initial `gh release create` produced a **draft** with only `SHA256SUMS.txt` (the two ~112 MB exe uploads exceeded the command timeout). Recovery: `gh release upload … --clobber` for the two exes (ran ~12 min), then `gh release edit --draft=false --latest`. No re-tag needed.

## Sprint v2.6.0 — UI/UX Major Overhaul
- `[PATTERN v2.6.0]` **Action rows must survive a short window.** Any modal/card whose primary buttons live at the bottom of a scrollable body must (a) keep the header and footer as siblings of the scroll region (not inside it), (b) put `shrink-0` on the footer, (c) give the button row `flex-wrap` + `whitespace-nowrap` on each label, and (d) cap the body with `max-h-*`/`overflow-y-auto`. Root cause of "the buttons are invisible" bugs (C.2, C.3, D.3) was a `nowrap` row clipped by the shared `Modal`'s `overflow-hidden` once the panel narrowed. jsdom has no layout, so the regression tests assert this **structurally** (scroll region does not contain the footer; footer/rows carry `shrink-0`/`flex-wrap`) rather than by pixel geometry.
- `[DECISION]` C.2 Approval dialog: identity (Reason/Tool/Server/cwd) moved to a sticky header; body scrolls; footer wraps; the redundant 4th "Approve all" button was removed (the shared Modal already handles close). `respondApproval(requestId, answer)` — deny sends `false`.
- `[DECISION]` C.3 Plan dialog: every step now renders its command/path (`editableKey` → `command|path|content`) as an LTR mono block even when not editing, plus a "N steps" header chip; actions moved/kept in the non-shrinking footer.
- `[DECISION]` C.1 Tool card: collapsed from a two-row (header + duplicated preview) layout to a **single** header row — `[status icon][name][status][truncating primary flex-1][code][exit][duration][chevron]` — so the meta chips (the "keys" the user could not see) stay visible; removed the now-unused `Wrench`/`Terminal` icons and the duplicate preview row.
- `[DECISION]` D.3 Loop stop card: the three actions (Continue/Correct/Stop) moved **above** the stuck-on/recent detail, and "Recent actions" became a collapsed `<button aria-expanded>` toggle showing the count, so a long list can never push the buttons off-screen.
- `[DECISION]` B.2 Sidebar: project rows gained a per-workspace chat counter (`chats.filter(c => c.workspaceId === project.id)`) and the connection dot gained a `title`/`aria-label` ("Connected"/"Disconnected"/"Path not found"); the Projects heading is now a collapsible group. Also fixed a latent double-plus: `sidebar.newChat` was `"+ New chat"` while the button already renders a `Plus` icon — changed to `"New chat"`. **`archive` from the spec was NOT implemented** (no store/IPC/persistence support) — the existing hover menu (Rename/Duplicate/Export/Delete) stands; flagged to the user rather than faking it.
- `[DECISION]` B.3 Execution bar: the chat header became a **two-line** `ExecutionBar` — line 1 is identity (project / VPS / path, LTR-mono, truncating), line 2 is the contract (git branch+clean/changes via the existing `GitStatusPill`, shared connection chip, approval-mode badge) plus the run controls. The old single-row toolbar was folded into it (now-unused `planMode`/`chatTreeOpen`/`terminalToggle`/`workspacePanel` selectors removed from `ChatPanel`). The badge encodes the mode in **icon + colour + text** (ask = sky + `Lock` "Safe mode", auto-write = grey + `Zap` "Ask before write", full = amber + `LockOpen` "Full access"), and the full-access countdown is real: `setApprovalMode('full')` now stores `fullAccessExpiresAt` (30-min TTL) so both the badge and the red banner tick down via a `formatCountdown` helper. Both lines are `flex-wrap` with `truncate`/`shrink-0`/`whitespace-nowrap`, so a narrow window wraps instead of clipping.
- Files: `src/renderer/src/components/{ApprovalDialog,PlanCard,Sidebar,ProjectBadges,ToolResultCard,LoopStopCard,ExecutionBar,FullAccessToggle,ChatPanel}.tsx`, `src/renderer/src/lib/countdown.ts`, `src/renderer/src/store.ts`, `src/renderer/src/i18n/{en,fa}.json`.
- Tests: `test/renderer/{approval-dialog-sticky,plan-dialog,sidebar-navigation,tool-card-compact,loop-stop-compact,execution-bar}.test.tsx`. Full suite **1291 passed | 1 skipped**; `typecheck` + `build` green.
- Commits: `9633736` (C.2), `c1d7902` (C.3), `3f8dd36` (B.2), `153fc10` (C.1), `a64c7f4` (D.3), `caf11b9` (B.3). Branch `feature/v2.6.0-ui-overhaul`.





## Sprint v2.6.1 — Memory Persistence Fix
- `[DECISION]` Five fixes as one bundle on `feature/v2.6.1-memory-fix`, branched from the tip of `feature/v2.6.0-ui-overhaul` (chained, not from `master`): stable session id per chat, full history resumed via `resumeSessionId`, plan trust scoped+persisted per session, plan/approval decisions pinned in protected history, and memory surfaced/clearable in the Sources tab.
- Files: `src/shared/ui.ts`, `src/main/agent-service.ts`, `src/main/ipc.ts`, `src/preload/{index.ts,index.d.ts}`, `src/core/agent/{plan-trust.ts,session-store.ts,agent-orchestrator.ts}`, `src/renderer/src/{store.ts,components/SourcesList.tsx,i18n/{en,fa}.json}`.
- Tests: `test/agent/{memory-resume,session-metadata,pinned-history}.test.ts`, `test/core/plan-trust.test.ts`, `test/main/agent-memory.test.ts`, `test/renderer/{stable-session-id,resume-session,chat-memory}.test.tsx`, and the end-to-end `test/e2e/v2.6.1-memory.test.ts` (5 scenarios driving the real `AgentService` over a stubbed HTTP boundary). Full suite **1322 passed | 1 skipped**; `typecheck` + `build` green.
- Commits: `7b0a986` (Fix 1), `80ef6d4` (Fix 2), `22764b8` (Fix 3), `6f80e89` (Fix 4), `7bd00ce` (Fix 5), `d68a4bb` (e2e). Branch `feature/v2.6.1-memory-fix`.
- `[RELEASE]` **v2.6.1 released publicly.** Branch topology verified **chained** (`feature/v2.6.0-ui-overhaul` ⊂ `feature/v2.6.1-memory-fix`, both atop `master`@`7818598`), so a single `--no-ff` merge of `feature/v2.6.1-memory-fix` into `master` (`86ca591`) carried v2.6.0 + v2.6.1; no conflicts. `package.json`/`package-lock.json` bumped `2.5.8`→`2.6.1` (v2.6.0 was never separately bumped), release bump commit `8ff364c`, `CHANGELOG.md` gained a `[2.6.1]` section. Windows artifacts built from Linux via Wine 10.0 (`npm run build:win`, exit 0): `AI Desktop Setup 2.6.1.exe` (sha256 `2d817db15c014c628f1671eada66ef3e4e4de00e5dbd9d5edc9b81657379a6b8`), `AI Desktop 2.6.1 Portable.exe` (sha256 `a2d56270ba3fd680f55b77a50483439f1a33511eca6ed1c9c34f848c6215313f`), `SHA256SUMS.txt`. Published as a **public (non-prerelease, latest)** GitHub Release: https://github.com/Arashtahmasbi3/ai-desktop/releases/tag/v2.6.1. Binaries are unsigned (SmartScreen may warn — noted in the release). **[RELEASE] v2.6.1 released. Memory persistence + UI overhaul complete. 1322 tests pass.**


## Sprint v2.6.2 — Collaborative Design (Session Profile + Secret Path Guard)
- `[DECISION]` **Topic 1 / P0-5 — the `full` approval grant moves into main.** Before v2.6.2 the TTL lived in the renderer store, so a renderer reload/crash silently *restored* `full` (effectively permanent). `SessionProfileService` now owns a scoped, environment-TTL-bounded `ElevationGrant` (development 60m / staging 30m / production 15m), re-arms its timer for a grant persisted before launch, drops lapsed/out-of-scope grants, and never persists `full` as a bare preference — `full` is *derived* only while a valid grant matches the active (project, VPS, environment) scope. A persisted `full` with no grant clamps to at most `auto-write` (production clamped harder). `AgentService` reads the effective mode from the profile, never from the renderer.
- `[DECISION]` `@shared/profile` is dependency-free and pure: it *decides* (approvalMode/planMode/tool exposure/environment policy) but enforcement stays in main. Investigate/read-only uses an **allowlist** (`isReadOnlyTool`) passed as `AgentOrchestrator.toolPolicy`, so a newly added mutating tool is hidden by default rather than leaking.
- `[DECISION]` **§5 — one canonical Secret Path Guard.** `@shared/secret-paths` (`inspectSecretPath`, `findSecretPathsInCommand`) blocks `.env*` by default (real `.env`, `.env.local`, `.env.production`, …), private keys/keystores, credential files, `~/.ssh`/`~/.aws`/`~/.gnupg`/`~/.kube`/`~/.docker`, `/etc/shadow`+`sudoers`, unconditionally and independent of Approval mode / Session Profile. Wired into sandbox tools, remote-fs tools, remote shell, `routeToolCall` (before root containment) and the local shell; `context-preview.ts` delegates to it so the preview can never disagree. `LocalShellResult` gained `blocked`.
- `[DECISION]` Allowlist for .env templates (`.env.example`, `.env.sample`, `.env.template`, `.env.dist`). Real `.env` always blocked, even in Elevated. Closed, exact-basename, case-sensitive set (`ENV_TEMPLATE_ALLOWLIST`); a name that merely *contains* `.env.` (`My.env.example.txt`) is not a template and stays blocked. Enumerated case-by-case in `test/security/secret-paths.test.ts`.
- Files: `src/shared/{profile,secret-paths}.ts`, `src/main/{session-profile-service,app-services,agent-service,ipc,local-shell}.ts`, `src/preload/index.ts`, `src/core/{agent-orchestrator,agent/persistence,agent/remote-routing,agent/tools,tools/remote-fs-tools,tools/remote-shell-tool}.ts`, `src/shared/{ui,context-preview}.ts`.
- Tests: `test/shared/profile.test.ts`, `test/agent/session-profile-service.test.ts`, `test/agent/tool-policy.test.ts`, `test/security/secret-paths.test.ts`, `test/security/secret-guard-wire.test.ts` (**59 new**; real code paths, no mocks). Full suite **1381 passed | 1 skipped**; `typecheck` + `build` green.
- Commits: `68e9dbf` (§5 Secret Path Guard), `423672f` (Topic 1 Session Profile / P0-5). Branch `feature/v2.6.2-session-profile`.
- `[STATUS v2.6.2]` Topic 1 (Session Profile + P0-5) ✅ complete. Topic 2 (Explore Mode) ✅ complete — T2.1 (Investigate tool sets), T2.2 (plan-only as the zero-tool sub-flag) `524e36a`, T2.3 (named read-only diagnostics) `ee161c0`, T2.4 (environment-aware enforcement) `e631dc8`. Topic 4 (Goal/Plan/Run) ✅ complete (commits `5a1a4c8`, `75ce8d7`, `6ced00f`, `1cc076a`). Topic 3 (Trace) ✅ complete — T3.1/T3.2 `a084607`, T3.3 `7d4f74a`. Remaining: Topic 5 (UI).
- `[DECISION]` **Topic 3 / T3.3 — audit mode is a per-project hash-chained JSONL.** `@core/agent/audit-trail` writes one redacted line per decision (`seq`, `prevHash`, `hash` = SHA-256 over the canonical JSON incl. predecessor), so edits, reorders and dropped lines are all detectable by `verify()`. Line derivation (`auditLineFromDecision`) and the pure `AuditVerifyResult` shape live in `@shared/trace` so preload/renderer need no `node:*` imports. `AgentService` appends fire-and-forget (a write failure never blocks a run) and exposes `audit:path`/`audit:verify` over IPC; `SettingsAudit.tsx` (Settings → Advanced → Audit) shows the file and verifies on demand. Local projects audit under `<root>/.ai-desktop/audit.log`; remote projects never write to the VPS — they use app-data `projects/<id>/audit.log`. Tests: `test/core/audit-trail.test.ts` (14), `test/renderer/settings-audit.test.tsx` (4), `test/e2e/v2.6.2-integration.test.ts` (6). Full suite **200 files, 1546 passed | 1 skipped**; `typecheck` + `build` green. Appends are serialized (promise tail) because decision sinks fire-and-forget — otherwise concurrent appends reuse the same `lastSeq` and corrupt the chain.
- `[DECISION]` **Topic 2 / T2.3 — named diagnostics are the production read surface.** `@core/tools/diagnostics-tools` adds `get_service_logs` (systemd → journald → PM2), `get_disk_usage` (du + df), `get_system_health` and `get_process_list`. Each command is built in-process from a validated `service`/`path`/`filter` (conservative charsets, `shellQuote`) and then re-checked against the secret guard + deny list as defence in depth, so a model argument can never become a shell command. The executor pins the chat-header server, so a model-supplied `server_id` cannot redirect a probe.
- `[DECISION]` **Topic 2 / T2.4 — exposure is environment-aware.** `@core/agent/tool-policy` maps the effective `ResolvedProfile` to a `ToolExposure` (`full` | `read-only` | `plan-only` | `diagnostics-only`) consumed by `AgentOrchestrator.toolPolicy`; the same exposure supplies Investigate's extra read roots to the path guard via `createReadScopePolicy`. Matrix: dev reads the whole host, staging only `/var/log`/`/proc`/`/tmp`, production exposes **no** extra path (named diagnostics only). Writes never widen — the read scope is a `DiagnosticPolicy`, which `enforceProjectPath(..., 'write')` ignores.
- Files (Topic 2): `src/shared/profile.ts`, `src/core/agent/tool-policy.ts`, `src/core/remote/diagnostic-policy.ts`, `src/core/tools/diagnostics-tools.ts`, `src/main/agent-service.ts`.
- Tests (Topic 2): `test/shared/profile.test.ts`, `test/core/diagnostics-tools.test.ts`, `test/core/explore-mode.test.ts`, `test/security/diagnostic-mode.test.ts` (real code paths — the orchestrator, routing, path guard and command builders; only the SSH transport and LLM adapter are injected).
- `[CORRECTION]` An earlier hand-off said "P0-1 and P0-5 remain open"; that was stale. **P0-1..P0-4 shipped in v2.5** — P0-1 run→project isolation (`688`), P0-2 remote path containment (line 683), P0-3 scoped/expiring remembered approvals (line 684), P0-4 no auto VPS selection (line 685) — and **P0-5 shipped in Topic 1** (`423672f`). No P0 item is open on this branch.
- Note: the repo is maintained via `npm run typecheck` + `npm test` + `npm run build`; `npm run dev` (Electron GUI) is not runnable in the headless dev container.
- `[PERMANENT]` **Do NOT create `.jsx`/`.js` equivalents of TSX/TS files.** The TypeScript files are canonical: `ChatPanel.tsx` (not `Chat.jsx`), `SettingsPanel.tsx` (not `Settings.jsx`), `agent-orchestrator.ts` (not `agent.js`). If a legacy JS spec appears in context, ignore it. Do not build it. Reason: duplicate files break typecheck, split logic, and add confusion.
- `[NOTE]` Legacy JS spec (`Chat.jsx`, `Settings.jsx`, `agent.js`) is obsolete. Equivalent TSX/TS files already exist (`ChatPanel.tsx`, `SettingsPanel.tsx`, `agent-orchestrator.ts` + `core/agent/*`). Do not create duplicates.
- `[STATUS v2.6.2]` **Topic 5 (UI Polish) ✅ complete.** T5.1 composer context warning + Compact `8ef3eab`; T5.2 Jobs collapse + sidebar badge `99f36f1`; T5.3 shortcuts/zoom/emergency stop + `ShortcutsOverlay.tsx` `51e1ed0`; T5.4 Persian-first font + bidi isolation `b21e092`; T5.5 modal viewport caps `e85071a`. All six tracker items are done; only the release remains.
- `[DECISION]` **Topic 5 / T5.3 — Ctrl+K is palette-only; search focus moved to Ctrl+Shift+K.** `Sidebar` previously grabbed Ctrl+K to focus chat search, which raced the command palette. The palette owns Ctrl+K; the sidebar hint now reads `Ctrl ⇧ K`. Zoom is an Electron zoom level owned by the renderer (`window:zoom` IPC, clamped to [-3, 3], persisted in `ai-desktop:zoom-level`, re-applied on boot); Shift+Esc is the emergency stop and `?`/Ctrl+/ toggles `ShortcutsOverlay`. Tests assert zoom clamping/persistence, the Ctrl+K vs Ctrl+Shift+K split, and the cheat sheet.
- `[DECISION]` **Topic 5 / T5.4 — Persian leads the stack, direction is isolated per run.** `:root[lang='fa']` puts Vazirmatn first across body/form controls and relaxes leading; `.chat-markdown` uses `unicode-bidi: isolate` with the existing `dir=auto`, `.bidi-ltr` fences Latin runs, and `:root[dir='rtl'] input[type=password|url|email]` stays LTR. Tests read the real stylesheet + drive `i18n.changeLanguage` so `<html dir/lang>` is exercised.
- `[DECISION]` **Topic 5 / T5.5 — every dialog is viewport-capped.** Shared `Modal` already caps height; the remaining hand-rolled dialogs (Git setup, migration, onboarding, code search) gained `max-h-[calc(100vh-2rem)]` (or `70vh` for the top-anchored search) with a scroll region and a `92vw` width cap, so a short window scrolls instead of clipping the actions.
- `[RELEASE v2.6.2 — prep]` Version bumped `2.6.1`→`2.6.2` (`package.json` + lockfile), `CHANGELOG.md` gained a `[2.6.2]` section and compare links, and `AGENTS.md` records Topic 5. Typecheck + full suite (incl. `test/e2e/*`) + `build` are green. Remaining release steps per §Release process: `build:win` (Wine), checksums, merge to `master`, tag `v2.6.2`, push, and publish the GitHub Release.
- `[RELEASE]` **v2.6.2 released.** `feature/v2.6.2-session-profile` merged into `master` with a `--no-ff` merge commit (`9bf732e`); no conflicts (master was a straight ancestor). Annotated tag `v2.6.2` created and pushed. Windows artifacts built from Linux via Wine (`npm run build:win`, exit 0) and hashed: `AI.Desktop.Setup.2.6.2.exe` (sha256 `dc6bedd6f823053767df8507ab973510f86e2d9bd609e1097e7f2c6125c4ea34`, 112,507,037 B), `AI.Desktop.2.6.2.Portable.exe` (sha256 `b1e71d13a74cb07047659ca4c8139a0f38134ae84a32ce4b863b640190976ed6`, 112,224,211 B), `SHA256SUMS.txt` (dotted names, so `sha256sum -c` works against the published files). Published as a **public (non-prerelease, latest)** GitHub Release: https://github.com/Arashtahmasbi3/ai-desktop/releases/tag/v2.6.2 — all three assets uploaded (`AI.Desktop.Setup.2.6.2.exe`, `AI.Desktop.2.6.2.Portable.exe`, `SHA256SUMS.txt`). Binaries are unsigned (SmartScreen may warn — noted in the release). **[RELEASE] v2.6.2 released. Session Profile, Explore Mode, Goals, Trace and UI Polish complete. 1569 tests pass.**


## Sprint v2.6.3 — UI Refinement + Inline Trace + Preflight Fix
- `[DECISION]` **Topic 3 / T3.2 — a blocked preflight is an interactive, audited decision, not a dead end.** `@core/agent/preflight-override` is the single, I/O-free rule set: `buildPreflightOptions(tier)` (block → cleanup/override/cancel, critical → retry/cancel), `canOverrideTier` (only `block` may proceed), `isPreflightChoiceAllowed` (broker + orchestrator both validate, so a tampered renderer cannot send `proceed` for a critical result) and bounded retries (`MAX_PREFLIGHT_RETRIES = 2`, 5s apart). `AgentOrchestrator.preflightOverride` receives the block and resolves it; without a callback the old hard-block behavior is unchanged.
- `[DECISION]` **The broker fails closed.** `PreflightBroker.request()` emits `preflight:request` and resolves to `cancel` on timeout, on `cancelAll()` (run abort) and on any dropped renderer, mirroring `ApprovalBroker`/`PlanBroker`. `AgentService` wires `requestPreflight`/`cancelPreflights` and, when an active project exists, wraps the answer so every decision is appended to the project's hash-chained audit trail (`auditLineFromPreflightOverride`: `proceed` = approved, everything else denied; reason via `extractPreflightReason`). Audit fields are additive/backward-compatible.
- `[DECISION]` **Renderer answers through one narrow channel.** `store.pendingPreflight` is set by `preflight:request`, cleared by `preflight:resolved`/`run:start`/run end/error, and `respondPreflight(choice)` calls `window.api.agent.respondPreflight(id, choice)`. The `PreflightOverrideDialog` renders only the options the tier supplies, shows the failed checks + a countdown, and auto-cancels on expiry. No new `.jsx`/`.js` equivalents were introduced — `PreflightOverrideDialog.tsx` is the canonical file.
- Files: `src/shared/preflight.ts`, `src/core/agent/preflight-override.ts`, `src/main/{agent-orchestrator,preflight-broker,agent-service,app-services,ipc}.ts`, `src/preload/{index.ts,index.d.ts}`, `src/renderer/src/{store.ts,components/{PreflightOverrideDialog,ChatPanel}.tsx,i18n/{en,fa}.json}`.
- Tests: `test/agent/preflight-override.test.ts`, `test/main/preflight-broker.test.ts`, `test/core/audit-trail.test.ts`, `test/renderer/preflight-override.test.tsx` (store wiring + tier-aware dialog + fail-closed auto-cancel). Full suite **213 files, 1650 passed | 1 skipped**; `typecheck` + `build` green.
- Commits: `80a35b2` (broker), `d083ea5` (orchestrator override + cleanup), `85c7f27` (audit), IPC/preload/renderer wiring. Branch `feature/v2.6.3-trace-ui`.
- `[DECISION v2.6.3]` **Raw tool rows hidden when grouped in InlineTrace.** A `role: 'tool'` message is dropped from the chat flow when the same `runId` + `toolCall.step` already has a trace decision (the `✓ tool ok` line was pure duplication of the card); rows with no matching step, or from another run, still render so nothing is ever silently lost. Toggle **`showRawToolRows`** in Settings → General for debugging (default: off). Toggle + filter live in `store.showRawToolRows` / `lib/tool-rows.ts` (`isGroupedInTrace`, `visibleChatMessages`); `ChatPanel` renders the filtered list. Persisted per the existing renderer-preference convention (`localStorage` key `ai-desktop:show-raw-tool-rows`), consistent with `showContextBeforeSend`/`showJobsPanelAlways`, rather than main `settings.json`.
- `[DECISION v2.6.3]` **InlineTrace shows the newest 3, expands to 30.** The chat trace opens as a 3-decision preview with a `Show all (N more)` control instead of dumping the whole bounded window; `Show less` collapses it back. `LiveStatus` now names the step's action when the tool is known (Reading / Searching / Writing / Running) and falls back to the phase label otherwise.
- Files (Topic 2 conformance): `src/renderer/src/components/{InlineTrace,LiveStatus,ChatPanel,SettingsPanel}.tsx`, `src/renderer/src/{store.ts,lib/tool-rows.ts}`, `src/renderer/src/i18n/{en,fa}.json`.
- Tests: `test/renderer/{chat-with-decisions,live-status,hide-raw-tools}.test.tsx`. Full suite **214 files, 1664 passed | 1 skipped**; `typecheck` + `build` green.
- Commits: `f6deda3` (InlineTrace + tool-aware status) and the hide-raw-tool-rows commit. Branch `feature/v2.6.3-trace-ui`.

### v2.6.3 Topic 1 - Chat Layout (T1.1)
- `[DECISION v2.6.3]` **T1.1 - one measure for messages and composer.** Both cap at `CHAT_MAX_WIDTH` (820) with `mx-auto px-4`. The composer's outer bar was `p-3`; it is now `py-3` so its sole horizontal inset is the inner `px-4`, matching the message gutter exactly (leaving `p-3` would inset the composer 12px further than the messages and break the shared left/right edge). `data-testid="chat-composer"` added for structural tests.
- Files (T1.1): `src/renderer/src/components/ChatPanel.tsx`. Tests: `test/renderer/chat-layout.test.tsx` (3 structural cases).

### v2.6.3 Topic 1 - Chat Layout (T1.2)
- `[DECISION v2.6.3]` **T1.2 - the sidebar has two distinct controls.** `sidebarCollapsed` (Ctrl+B) hides it entirely and always wins; `sidebarPinned` (persisted, default on) keeps it expanded. A pinned sidebar holds its width down to `MIN_CHAT_WIDTH` (560); an unpinned sidebar only stays expanded while the chat can claim its full `CHAT_MAX_WIDTH` (820), so a mid-size window (e.g. 1000px) favors the conversation. This is the co-designer reading of "respect the pin, but not below MIN_CHAT_WIDTH": it keeps the pin visible/meaningful instead of being a no-op, and `pinned=true` reproduces the prior shipping behavior exactly. `resolveLayout` now takes both flags.
- `[DECISION v2.6.3]` **T1.2 - the tree overlay is dismissable.** Extracted the chat's dock/overlay tree into `components/ChatTree.tsx` so the overlay path (backdrop click + header X) is unit-testable without mounting the whole app. Overlay mode renders a `bg-black/40` backdrop that closes the drawer and passes `onClose` to `FileExplorer`; docked mode renders neither.
- Files (T1.2): `src/renderer/src/{App.tsx,lib/layout.ts,store.ts}`, `src/renderer/src/components/{Sidebar,FileExplorer,ChatTree}.tsx`, `src/renderer/src/i18n/{en,fa}.json`.
- Tests: `test/renderer/layout.test.ts` (pure math, updated for the new inputs + pinned-vs-unpinned threshold) and `test/renderer/layout-responsive.test.tsx` (7 DOM cases: rail, expanded, forced rail, pin persist, pin-from-rail, overlay backdrop/X, docked no-backdrop).

### v2.6.3 Topic 1 - Chat Layout (T1.3)
- `[DECISION v2.6.3]` **T1.3 - one column, always-visible STATUS.** The chat is now a single centered column: the fixed right-hand `ProgressTimeline` column is gone; when toggled it renders `embedded` at the top of the message column (`w-full`, `max-h-72`). A new `StatusCard` shows `{phase, lastDecision}` at the top of the column at all times — `Idle`/`No decision recorded yet` (i18n `chat.statusIdle` / `chat.statusUnknown`) before the first decision, otherwise the latest trace decision's phase + summary. The live "thinking" row (`LiveStatus`) is right-aligned (`justify-end`) so it reads bottom-right like Codex. The redundant row wrapper around the scroll area was removed.
- Files (T1.3): `src/renderer/src/components/{ChatPanel,ProgressTimeline,LiveStatus,StatusCard}.tsx`, `src/renderer/src/i18n/{en,fa}.json`.
- Tests: `test/renderer/chat-conformance.test.tsx` (6 DOM cases: idle status, phase+decision, unknown fallback, composer in column, embedded timeline only after toggle, right-aligned live row).

### v2.6.3 Topic 1 - Compact Tool Cards (T1.3)
- `[DECISION v2.6.3]` Compact tool cards: header 13px, chips 10-11px. Error cards auto-expanded (`useState(!ok)`). Success one-line.
  - Why: an error is the only case where the hidden body matters, so opening it by default removes a click and matches the Codex/Claude "expanded error" pattern; a successful call stays a single line. `hasBody` now also gates the body (`open && hasBody`) so a body-less failed card never renders an empty bordered area.
  - Hierarchy: `13px` applies to the header's text (tool name + the truncated command preview), while chips (exit/duration/code) stay `10px` and the ok/error badge stays `10px`. This is the "header > chips" size hierarchy; padding went `px-3 py-1.5 → px-2.5 py-1`.
  - This deliberately changes the old "always collapsed" default for failures, so `test/renderer/tool-detail-ui.test.tsx` cases 2-3 were updated to assert the expanded-by-default behavior instead of encoding the superseded default.
- Files (T1.3): `src/renderer/src/components/ToolResultCard.tsx`.
- Tests: `test/renderer/tool-card-compact.test.tsx` (now 7 cases: header row, single collapsed row, truncation, expand, one-line success, error auto-expand, size hierarchy).
- `[RELEASE]` **v2.6.3 released.** `feature/v2.6.3-trace-ui` merged into `master` with a `--no-ff` merge commit (`c1e1ffb`); no conflicts (master was a straight ancestor). Annotated tag `v2.6.3` created and pushed. Windows artifacts built from Linux via Wine (`npm run build:win`, exit 0) and hashed: `AI.Desktop.Setup.2.6.3.exe` (sha256 `4505502af47e9ffc1ff61f1c3ea201e948ad051d8b88215d88ecd10177009333`, 112,511,938 B), `AI.Desktop.2.6.3.Portable.exe` (sha256 `0fadc0f7496f502e45969c19ad5911feb149d2ddef0ef37ba7763f726bb0d949`, 112,229,098 B), `SHA256SUMS.txt` (dotted names, so `sha256sum -c` works against the published files). The `gh release create` first pass hit an `EOF` uploading the two ~112 MB assets, leaving a **draft** with only the checksum; the assets were re-uploaded with `gh release upload --clobber` (exit 0) and the release was published (non-draft, non-prerelease, latest): https://github.com/Arashtahmasbi3/ai-desktop/releases/tag/v2.6.3 — all three assets present. Binaries are unsigned (SmartScreen may warn — noted in the release). **[RELEASE] v2.6.3 — Inline Trace, Preflight Override, Centered Chat Layout. 1681+ tests pass. Ready for user testing on Windows.**

## Sprint v2.6.4 — Critical Bugs + Multi-Project UX + Design Polish

Branch `feature/v2.6.4-critical-fixes`.

### Fix B — Per-server VPS connection state (`eddc2b0`)
- `[DECISION v2.6.4]` The connected-server set is exposed over IPC (`vps:connected`) and every UI surface derives each project's indicator from that set, so a global status change on one host no longer flips another project to "Not connected". The run's routing host and tool host are reconciled to the same reachable server.
- Files: `src/core/agent/vps-resolver.ts`, `src/main/agent-service.ts`, `src/main/ssh/ssh-manager.ts` (`serverStates`/`states()`), `src/main/vps-ipc.ts`, `src/renderer/src/lib/connection-status.ts`, `vps-state.ts`, `store.ts`.
- Tests: `test/main/ssh-manager.test.ts`, `test/renderer/connection-status.test.tsx`, `test/security/vps-resolver.test.ts`.

### Fix C — Multi-connection: every remote project stays connected (`c152554`)
- `[DECISION v2.6.4]` `SshManager` owns a `Map<serverId, ConnectionEntry>`, so every remote project's host can be connected at once; `disconnect(serverId)` only drops its own server. A terminal panel closing/unmounting calls `closeTerminal(serverId, sessionId)` — never `disconnect` — so it tears down only its own shell (a stale session id is ignored rather than closing the wrong shell). A startup keepalive (`App.tsx`, every 30s) brings up **every** remote project's host via `ensureVpsConnected`, which never moves the chat-header selection. `openProject`/`switchProject` never call `disconnect`.
  - Why: the user's model is "each project = independent context", so switching projects must be instant and must not interrupt another project's running work.
- Files: `src/main/ssh/ssh-manager.ts`, `src/main/vps-ipc.ts`, `src/preload/index.ts` + `index.d.ts`, `src/renderer/src/App.tsx`, `components/Vps/VpsTerminal.tsx`, `lib/vps-state.ts`, `store.ts`.
- Tests: `test/main/ssh-manager.test.ts` (`multi-connection (v2.6.4)`: keep every server connected, second server connects without disturbing the first, closing a terminal keeps the connection up), `test/renderer/vps-state.test.ts` (`remoteVpsIds`).

### Fix D — Chat transfer on project switch
- `[DECISION v2.6.4]` Switching to another project no longer silently orphans the open chat. When the current session has at least one user message we prompt with `ProjectSwitchDialog` (link / move / keep+new); an empty session switches silently. `ChatStore.linkProject` re-points a chat at the new `workspaceId` **in place** (same file, id, title and full message history), rather than copying it — the backend used to duplicate history on a project change.
  - Why link-not-copy: a copy would fork the conversation and double the stored history; re-pointing keeps one canonical transcript while letting the chat "belong" to the new project.
  - Preference: `chatTransferPreference` (`ask` default | `link` | `move` | `new`) persisted in `localStorage`, surfaced in Settings → General; a "remember my choice" checkbox writes it.
  - `move` = link then `newSession()`; `new` = leave the chat where it is and start a fresh one in the target project.
- Files: `src/main/chat-store.ts` (`linkProject`), `src/main/ipc.ts` (`chats:linkProject`), `src/preload/index.ts` + `index.d.ts`, `src/renderer/src/lib/chat-transfer.ts`, `src/renderer/src/components/ProjectSwitchDialog.tsx`, `App.tsx`, `store.ts`, `SettingsPanel.tsx`, `i18n/{en,fa}.json`.
- Tests: `test/main/chat-store.test.ts` (2 cases), `test/renderer/chat-transfer.test.ts`, `test/renderer/project-switch.test.tsx`. Commit `e24fa95`.

### Fix E — Context-filling warning is opt-in (default off)
- `[DECISION v2.6.4]` The composer's near-limit "context is filling up" nudge is only useful for older, small-context models, so it is hidden by default. `showContextWarning` preference (default `false`, persisted) gates it; `contextWarningVisible(enabled, nearLimit)` in `@shared/memory` is the single predicate. The full accounting still lives in Settings → Usage and "View context" is untouched.
  - This keeps modern long-context sessions quiet while leaving an explicit opt-in for older models.
- Files: `src/shared/memory.ts`, `src/renderer/src/store.ts`, `ChatPanel.tsx`, `SettingsPanel.tsx`, `i18n/{en,fa}.json`.
- Tests: `test/renderer/context-warning-opt-in.test.tsx`, added case in `test/shared/memory.test.ts`. Commit `4eb963f`.

### Fix F — Shared type scale (no re-layout)
- `[DECISION v2.6.4]` Added size-only `fontSize` tokens `text-2xs`/`text-3xs`/`text-4xs` (11/10/9px, no line-height) and migrated 326 arbitrary `text-[Npx]` classes to them, plus `leading-[14px] → leading-3.5`. Size-only on purpose: a token with a line-height would shift layout, which this polish must not do.
  - Left as-is (documented): `text-[12px]` (3×) and `text-[13px]` (2×) — 12px has no line-height-neutral Tailwind equivalent (`text-xs` carries 16px), and 13px sits between tokens; changing either would move layout. Revisit only with a deliberate spacing pass.
- Files: `tailwind.config.js`, all renderer components using the dense sizes; `test/renderer/tool-card-compact.test.tsx` assertions updated. Commit `65df132`.

### Sprint status
- Fix A (`92205f0`), Fix B (`eddc2b0`), Fix C (`c152554`), Fix D (`e24fa95`), Fix E (`4eb963f`), Polish F (`65df132`) complete. Full suite: 221 files, 1724 passed | 1 skipped; builds green.
- `[RELEASE]` **v2.6.4 released.** `feature/v2.6.4-critical-fixes` merged into `master` with a `--no-ff` merge commit (`8e12e9e`); no conflicts (master was a straight ancestor). Annotated tag `v2.6.4` created and pushed. Windows artifacts built from Linux via Wine (`npm run build:win`, exit 0) and hashed: `AI.Desktop.Setup.2.6.4.exe` (sha256 `f1bec3aaadc2bea37b4515effd58e33f74280ef8fdb205016ad89542fba14f6e`, 112,514,057 B), `AI.Desktop.2.6.4.Portable.exe` (sha256 `3e9351925b6a862d8c38f0b455a908cbf5d1c5b8af5857e6fb34dc30b617201a`, 112,231,216 B), `SHA256SUMS.txt` (189 B, dotted names so `sha256sum -c` works against the published files). Published as a public (non-prerelease, non-draft) GitHub Release: https://github.com/Arashtahmasbi3/ai-desktop/releases/tag/v2.6.4 — all three assets present. Binaries are unsigned (SmartScreen may warn — noted in the release). **[RELEASE] v2.6.4 — Multi-Project & Polish. 1724 tests pass | 1 skipped (Docker-conditional). Ready for user testing on Windows.**

## Pattern: Design tokens and embedded surfaces

Where our brutalist system stops (v4.2). Two rules, because the first one is a promise we would otherwise break
without noticing.

- **Our tokens own our shell.** Zero radius, 2px borders, one hard offset shadow with no blur, instant linear
  motion, uppercase micro-labels and monospace data are the language of AI Desktop's own window, and
  `test/renderer/brutal-tokens.test.ts` enforces it.
- **A surface rendered inside someone else's product inherits THEIR tokens.** The official Claude MCP Apps
  guidelines require host style variables for every structural element — backgrounds, text, borders, radii, weights
  — and allow brand colour only for accents. A UI we hand to a host must look native there, not like our app
  embedded in it. Concretely: 0.5px borders, 4–12px radii and soft shadows are CORRECT inside an MCP App and
  forbidden inside our window. Both facts are true at once; only the boundary separates them.
- **Consequences for the code:** any component that may be rendered in both places takes its structural values from
  a prop or a CSS variable layer, never from our Tailwind tokens directly. The moment a shared component imports
  `brutal-card`, it can no longer be embedded.
- **Progressive disclosure is the host's pattern too.** Inline card (a summary, at most two actions, no menus) →
  expanded → full screen (the composer stays visible). Our trace and file-change surfaces should follow the same
  three levels rather than showing everything at once (U3-2 in the audit checklist).

## Pattern: No interface for a capability that does not exist

The Plugins page taught this (v4.0): seven switches persisted `plugins.enabled`, and nothing in the code read it,
so every control reported a state change that never happened. The rule now:

- a switch, chip or button must be backed by one call site that reads what it writes, or it must not ship;
- an informational row must say where the setting actually lives, and its button must land on that tab;
- a capability that is planned but absent is reported as absent (the Sources panel shows web search disabled rather
  than pretending), never rendered as a control that silently does nothing.
