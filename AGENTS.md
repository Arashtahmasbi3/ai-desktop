# AGENTS.md

Persistent memory / operating guide for AI agents working in this repository.

## Project

**AI Desktop** — an Electron desktop AI assistant. Long-term goal: behave like Codex and
connect to DeepSeek API, VPS servers (SSH), GitHub (Git), and the local desktop (file I/O).

Current state: **Stage 1 — project skeleton** (Electron + React 18 + TypeScript, no features yet).

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
  renderer/
    index.html
    src/
      main.tsx           React entry
      App.tsx            root component
      assets/main.css    Tailwind entry + Vazirmatn font
      components/        UI components (added in later stages)
      lib/               non-UI logic (llm, agent, ...)
test/                    Vitest tests
```

## Conventions

- TypeScript everywhere, `strict` on. Prefer `node:` import prefixes in the main process.
- Renderer talks to the system only through `window.api.*` (preload). Never enable
  `nodeIntegration`; keep `contextIsolation: true`.
- New IPC channels: add `ipcMain.handle('<ns>:<action>')` in `src/main/index.ts`, expose it
  in `src/preload/index.ts`, and declare its type in `src/preload/index.d.ts`.
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
