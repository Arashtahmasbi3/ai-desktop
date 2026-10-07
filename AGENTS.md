# AGENTS.md

Persistent memory / operating guide for AI agents working in this repository.

## Project

**AI Desktop** — an Electron desktop AI assistant. Long-term goal: behave like Codex and
connect to DeepSeek API, VPS servers (SSH), GitHub (Git), and the local desktop (file I/O).

**Repository**: https://github.com/Arashtahmasbi3/ai-desktop (private, independent).
Default branch `master`; remote `origin` tracks it. Push after every committed change.

Current state: **Stage 4 — agent orchestrator**. Stage 1 skeleton (Electron + React 18 +
TypeScript), Stage 2 LLM adapters (OpenAI/Anthropic/DeepSeek/Google) and Stage 3
code-execution sandbox are in place. Stage 4 adds `AgentOrchestrator`
(`src/core/agent-orchestrator.ts`): it runs the Planning → Execution → Observation →
Reflection loop against a provider-agnostic adapter, executes tools inside a
`SandboxManager`, detects loops (repeated actions / no progress) and recovers from tool
and LLM failures with provider fallback. The chat UI, SSH and Git come next.

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
| `npm run build:win` | Build + package a Windows NSIS installer into `release/` |

## Structure

```
src/
  main/index.ts          Electron main process (window + IPC handlers)
  preload/index.ts       contextBridge API exposed as window.api
  preload/index.d.ts     window.api type declarations
  shared/types.ts        provider-agnostic LLM types (ChatMessage, ToolCall, ...)
  shared/sandbox.ts      sandbox types (SandboxManager, limits, ExecResult, ...)
  shared/agent.ts        agent types (AgentStep, AgentRunResult, LoopWarning, policies)
  core/
    agent-orchestrator.ts  AgentOrchestrator — plan/execute/observe/reflect loop
    agent/
      context-manager.ts   conversation history + character budget
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
- UI: dark theme only. Use the Tailwind theme tokens `bg-bg-primary` `#0a0a0a`,
  `bg-bg-secondary` `#141414`, `bg-bg-tertiary` `#1e1e1e`, `border-border`, `text-accent`.
- Menus/labels in English; chat content is RTL (`dir="rtl"`), font Vazirmatn.
- Keep the Content-Security-Policy in `src/renderer/index.html` in sync with any new
  external resource (fonts, network calls to the DeepSeek API, etc.).

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
