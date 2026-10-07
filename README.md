# AI Desktop

An Electron desktop AI assistant — a local, Codex-like companion that connects to the
DeepSeek API, VPS servers (SSH), GitHub (Git), and your local files.

> Status: **Stage 3 — code-execution sandbox**. The app ships a provider-agnostic LLM
> abstraction (OpenAI, Anthropic, DeepSeek, Google) and a sandboxed code-execution layer
> (`SandboxManager`): Docker-backed by default (resource limits, no network), with local/
> Windows fallbacks, concurrency limits and TTL/idle auto-destroy. Chat UI, the agent loop,
> SSH and Git come in later stages.

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
  shared/     provider-agnostic LLM + sandbox types
  core/       LLM adapters (OpenAI, Anthropic, DeepSeek, Google) + sandbox module
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

### Code sandbox

```ts
import { SandboxManagerImpl } from '@core/sandbox'

const manager = new SandboxManagerImpl({ maxSandboxes: 4 })
const { id } = await manager.createSandbox()            // Docker if available, else fallback

await manager.executeCommand(id, 'echo hello')
await manager.writeFile(id, 'app.js', 'console.log(1)')
await manager.executeCommand(id, 'node app.js')
await manager.destroySandbox(id)
await manager.dispose()
```

Docker sandboxes run with `--network none` (default), a read-only root filesystem, CPU/
memory/PID limits, and only a dedicated workspace bind-mount is writable. Without Docker,
`WindowsSandboxDriver` (Windows) or `LocalSandboxDriver` is used — that path is a
convenience fallback and **not** a security boundary.

See [`AGENTS.md`](./AGENTS.md) for architecture notes and conventions.

## License

MIT
