# AI Desktop

An Electron desktop AI assistant — a local, Codex-like companion that connects to the
DeepSeek API, VPS servers (SSH), GitHub (Git), and your local files.

> Status: **Stage 1 — skeleton**. The app currently opens a window and verifies the
> main ↔ renderer IPC bridge. Feature work (chat, agent loop, SSH, Git) comes in later stages.

## Requirements

- Node.js 20 LTS or newer (tested on Node 24)
- npm 10+
- Windows 10/11 for the NSIS installer target (dev works cross-platform)

## Getting started

```bash
npm install
npm run dev     # opens the Electron window
```

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Run the app in development (HMR) |
| `npm run build` | Build main/preload/renderer to `out/` |
| `npm run typecheck` | Type-check the Node and Web TypeScript projects |
| `npm test` | Run the test suite (Vitest) |
| `npm run build:win` | Package a Windows NSIS installer into `release/` |

## Project layout

```
src/
  main/       Electron main process (window, IPC)
  preload/    contextBridge bridge (window.api)
  renderer/   React UI (Vazirmatn, RTL, dark theme)
test/         Vitest tests
```

See [`AGENTS.md`](./AGENTS.md) for architecture notes and conventions.

## License

MIT
