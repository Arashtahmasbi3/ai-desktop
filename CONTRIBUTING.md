# Contributing to AI Desktop

Thanks for your interest in improving AI Desktop. This guide covers the local setup, the
conventions the codebase follows, and how to build a release.

## Prerequisites

- **Node.js 20 LTS or newer** (tested on Node 24) and npm.
- Optional: **Docker** for the hardened sandbox provider (the app falls back to a local
  sandbox when Docker is unavailable).
- Optional: **Wine** — only needed to produce the Windows installer from Linux/macOS.

## Setup

```bash
git clone https://github.com/Arashtahmasbi3/ai-desktop.git
cd ai-desktop
npm install
npm run dev
```

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Electron + renderer with HMR |
| `npm run build` | Build main, preload and renderer into `out/` |
| `npm run typecheck` | Type-check the node and web projects |
| `npm test` | Run the full Vitest suite once |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run pack` | Build an unpacked app with electron-builder (into `release/`) |
| `npm run build:win` | Build the Windows NSIS installer + portable exe |

## Project layout

- `src/main/` — Electron main process: window, IPC handlers, services, stores.
- `src/preload/` — the `contextBridge` API (`window.api`) and its type declarations.
- `src/core/` — provider-agnostic logic: `agent-orchestrator`, LLM adapters, sandbox, agent
  context/session/recovery. Lives outside Electron so it stays testable.
- `src/renderer/` — React UI (components, Zustand store, non-UI libs).
- `src/shared/` — types shared across processes.
- `test/` — Vitest tests, including `test/e2e/`.

See [`AGENTS.md`](./AGENTS.md) for the detailed architecture and the rules the code follows.

## Conventions

- **TypeScript everywhere**, `strict` on. Prefer `node:` import prefixes in the main process.
- **Renderer talks to the system only through `window.api.*`.** Never enable `nodeIntegration`;
  keep `contextIsolation: true`. New IPC channels require three edits: `ipcMain.handle` in
  `src/main/`, an entry in `src/preload/index.ts`, and a type in `src/preload/index.d.ts`.
- **Never call a provider SDK directly.** Go through `BaseLLMAdapter`; pick the implementation
  with `registry.ts`. Provider-specific translation lives in the adapter, shared plumbing
  (HTTP, retry, SSE, errors) in `base.ts` / `http.ts` / `sse.ts` / `errors.ts`.
- **Never execute rendered code by spawning processes directly.** Use `SandboxManager`
  (`createSandbox`, `executeCommand`, `writeFile`, `readFile`, `destroySandbox`).
- **Path handling** must go through `src/core/sandbox/paths.ts`; reject workspace escapes.
- Import via the path aliases `@shared/*`, `@core/*`, `@main/*`, `@preload/*`, `@renderer/*`.
- Keep the dark theme tokens (`bg-bg-primary`, `bg-bg-secondary`, `border-border`,
  `text-accent`, …) when adding UI; the chat content is RTL, menus are English.

## Tests

`npm test` runs the whole suite. Please add tests with any behavior change:

- **Unit** tests live next to their subject in `test/`; LLM adapters mock the HTTP boundary
  (a fake `fetch` injected via `config.fetchImpl` or `test/helpers/mock-fetch.ts`).
- **Sandbox** tests run command execution and file round-trips against the local driver for
  real; the Docker driver is tested with an injected `CommandRunner`.
- **End-to-end** tests live in `test/e2e/` and drive the real local sandbox with a scripted
  `BaseLLMAdapter` (only the LLM boundary is faked). Keep them deterministic — no network,
  no Docker — so they run everywhere.

Before opening a pull request, make sure these pass:

```bash
npm run typecheck
npm test
```

## Commits and pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat(core): …`,
  `fix(renderer): …`, `test(e2e): …`, `docs: …`, `chore: …`.
- Branch off `master` with a descriptive name (e.g. `feat/ssh-remote`).
- Open one pull request per change, describe the behavior change and how you tested it, and
  keep unrelated refactors out of it.
- Update `CHANGELOG.md` for user-visible changes.

## Release build

```bash
npm run build:win
```

This produces `release/AI Desktop Setup <version>.exe` (NSIS) and
`release/AI Desktop <version> Portable.exe`, plus the unpacked app under
`release/win-unpacked/` (useful for a smoke test).

**Code signing** is applied automatically when a certificate is provided; without one the
build is simply unsigned:

```bash
# Windows / CI, with a base64 .pfx or a file path:
CSC_LINK=/path/to/cert.pfx CSC_KEY_PASSWORD=secret npm run build:win
```

To cut a release: bump the version in `package.json`, move the `[Unreleased]` notes in
`CHANGELOG.md` under the new version, commit, and tag it `v<version>`.
