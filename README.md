# AI Desktop

An Electron desktop AI assistant — a local, Codex-like companion that connects to the
DeepSeek API, VPS servers (SSH), GitHub (Git), and your local files.

> Status: **Stage 5 — context & state management**. The app ships a provider-agnostic LLM
> abstraction (OpenAI, Anthropic, DeepSeek, Google), a sandboxed code-execution layer
> (`SandboxManager`: Docker-backed by default with local/Windows fallbacks), an
> `AgentOrchestrator` that runs the Planning → Execution → Observation → Reflection loop
> (with loop detection and failure recovery), and context/state management: token-budgeted
> history with automatic 80% compaction via LLM summarization, a context compressor, on-disk
> session persistence with resume, and encrypted (OS `safeStorage`) API-key storage. The chat
> UI, SSH and Git come in later stages.

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
  main/       Electron main process (window, IPC, safeStorage cipher)
  preload/    contextBridge bridge (window.api)
  shared/     provider-agnostic LLM + sandbox + agent types
  core/       LLM adapters + sandbox module + agent orchestrator & context/state
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

### Agent orchestrator

```ts
import { AgentOrchestrator } from '@core/agent-orchestrator'

const agent = new AgentOrchestrator({
  sandbox: manager,
  providers: [{ provider: 'deepseek', adapter, config: { apiKey, model: 'deepseek-chat' } }]
})

const result = await agent.run('Create a Node script that prints the first 10 primes and run it.')
console.log(result.status, result.finalAnswer, result.steps.length, result.warnings)
```

The orchestrator loops Planning → Execution → Observation → Reflection: it asks the model
for the next tool call, runs it in the sandbox (`write_file`, `read_file`, `list_dir`,
`run_command`), feeds the observation back and stops when the model answers without tool
calls. It warns after an action is repeated more than three times, pauses with
`needs_input` after repeated no-progress steps, retries transient sandbox failures and
falls back to the next provider on auth/config errors. Pass an `AbortSignal` via
`agent.run(task, { signal })` to cancel.

### Context, sessions and settings

The orchestrator keeps the prompt inside a token budget and compacts history automatically:

```ts
import { AgentOrchestrator, createAdapterSummarizer } from '@core/agent-orchestrator'
import { FileSessionStore, Persistence, resolveUserDataDir } from '@core/agent'

const agent = new AgentOrchestrator({
  sandbox: manager,
  providers: [{ provider: 'deepseek', adapter, config }],
  contextWindowTokens: 32_000,   // default: provider contextWindow − max output
  compactionThreshold: 0.8,      // compact at 80% of the budget
  summarizer: createAdapterSummarizer({ provider: 'deepseek', adapter, config }),
  sessionStore: new FileSessionStore(`${resolveUserDataDir({ appName: 'AI Desktop' })}/sessions`),
  sessionId: 'chat-1'
})

await agent.run('Refactor src/app.ts')

// After an app restart, resume the stored conversation:
await agent.run('Continue', { resumeSessionId: 'chat-1' })
```

Old messages may also be compressed (comments/blank lines stripped, duplicate code blocks
dropped) before being sent; the stored history is untouched. API keys are encrypted with the
OS keystore (`safeStorage`) via `Persistence` and never written in plaintext:

```ts
import { Persistence } from '@core/agent'
import { createSafeStorageCipher } from '@main/secure-cipher'

const settings = new Persistence({
  file: `${resolveUserDataDir({ appName: 'AI Desktop' })}/settings.json`,
  cipher: createSafeStorageCipher()
})
await settings.setApiKey('deepseek', apiKey)
```

See [`AGENTS.md`](./AGENTS.md) for architecture notes and conventions.

## License

MIT
