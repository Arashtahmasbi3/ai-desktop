# AI Desktop

An Electron desktop AI assistant — a local, Codex-like companion that connects to the
DeepSeek API, VPS servers (SSH), GitHub (Git), and your local files.

> Status: **Stage 2 — LLM adapter layer**. The app opens a window and ships a
> provider-agnostic LLM abstraction (`src/core/llm-adapters/`) supporting OpenAI,
> Anthropic, DeepSeek and Google Gemini, with streaming, tool calling and typed error
> handling. Chat UI, the agent loop, SSH and Git come in later stages.

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
  shared/     provider-agnostic LLM types
  core/       LLM adapters (OpenAI, Anthropic, DeepSeek, Google) + registry
  renderer/   React UI (Vazirmatn, RTL, dark theme)
test/         Vitest tests
```

### LLM adapters

```ts
import { createAdapterForConfig } from '@core/llm-adapters'

const adapter = createAdapterForConfig({ provider: 'deepseek', apiKey, model: 'deepseek-chat' })

const stream = adapter.streamChat({ model: 'deepseek-chat', messages, tools }, { apiKey, model })
for await (const event of stream) {
  if (event.type === 'text') process.stdout.write(event.text)
}
```

See [`AGENTS.md`](./AGENTS.md) for architecture notes and conventions.

## License

MIT
