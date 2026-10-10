# Testing Guide — v2.3.2 (Remote-First Architecture & Security Alignment)

This guide covers what to verify for the v2.3.2 sprint. Run the automated suite
first, then the manual checklist on Windows.

## 1. Automated regression

```bash
npm run typecheck   # tsc for node + web
npm test            # full Vitest suite
npm run build       # electron-vite production build
```

Expected (current tree): **101 test files, 763 passed | 1 skipped**; typecheck and
build clean.

## 2. Targeted suites added in v2.3.2

```bash
npx vitest run test/e2e/v2.3.2-security.e2e.test.ts   # 7 integration scenarios
npx vitest run test/security/v2.3.2.test.ts           # 5 security scenarios
npx vitest run test/renderer/sidebar-projects.test.tsx
npx vitest run test/renderer/chat-policy-warning.test.tsx
npx vitest run test/renderer/settings-projects.test.tsx
```

| Suite | Tests | Focus |
| --- | --- | --- |
| `test/e2e/v2.3.2-security.e2e.test.ts` | 8 | routing, read allow, write approval, timeout, Plan Mode, backup→restore, rsync dry-run |
| `test/security/v2.3.2.test.ts` | 7 | deny-list whitespace bypass, path traversal, command injection, mid-session mode change, background timeout |
| `test/renderer/sidebar-projects.test.tsx` | 4 | environment dot, type badge, scope, policy-mismatch warning |
| `test/renderer/chat-policy-warning.test.tsx` | 3 | warning derivation + banner Proceed/Cancel |
| `test/renderer/settings-projects.test.tsx` | 6 | per-project metadata editor |

## 3. Manual checklist (Windows)

### 3.1 Remote-first routing (A.1)
1. Add a **remote** project (a folder on a connected VPS) and make it active.
2. Ask the agent to read a file in the project. Expect a `remote_read_file` call,
   never a local read. Disconnect the VPS and retry: expect a clear
   "VPS not connected" error, not a local `sandbox_error`.

### 3.2 Context-aware policy (A.3)
1. **Settings → Connections → SSH → <server>**, set mode **Read-only**.
2. `ls` succeeds; `mkdir` is blocked. Switch to **Staging**: `mkdir` needs
   approval. Switch to **Production**: writes are refused, reads pass.

### 3.3 Per-command timeout (A.4)
1. Run a command that hangs (e.g. `sleep 300`). Expect it to be killed after 60s
   with a "timed out after 60000ms" message, and the app stays responsive.

### 3.4 Plan Mode (A.5)
1. With Plan approval on, ask for a change that writes a file. A plan card appears
   before anything runs. **Approve** → it executes; **Cancel** → nothing is written.

### 3.5 Backup + restore (B.1)
1. Overwrite an existing file on a remote project. Confirm a
   `<path>.backup-<timestamp>` file exists with the old contents.

### 3.6 Health check (B.2)
1. Configure a process/port/HTTP check for a project and run a deploy. A failing
   check is reported with its name.

### 3.7 rsync dry-run (B.3)
1. Run `migrate_project`. It prints a dry-run summary first; the real transfer only
   runs when the tool proceeds. No `--delete`.

### 3.8 Context preview (B.4)
1. With "show context before send" on, send a message. Confirm the preview lists
   provider/model, estimated tokens, included and withheld files.

### 3.9 `~/.ssh/config` import (B.5)
1. **Settings → Connections → SSH → Import from `~/.ssh/config`**. Confirm hosts are
   listed and only paths (never key contents) are imported.

### 3.10 Project metadata + isolation UI (C.1, C.2)
1. Expand a project card; set environment, audit log path, ports, domains and a
   policy override.
2. Sidebar shows the matching 🟢/🟡/🔴 dot, 🖥️/☁️ badge, VPS name and a ⚠️ when the
   project policy differs from the host policy.
3. Trigger a command outside the policy: an amber banner appears in the approval
   dialog **before** approval, with **Proceed anyway** / **Cancel**.

### 3.11 Path-traversal hardening (security)
1. With a host policy whose allowed paths include `/srv/app`, run
   `cat /srv/app/../../etc/passwd`. Expect `Blocked by policy:` (category `path`).
2. Confirm a local project rejects `../` paths with "Path escapes the project root".

### 3.12 Smoke test screenshot
Captured headlessly on Linux for CI use:
`docs/screenshots/v2.3.2/01-chat-empty.png`.

## 4. Reporting a failure

Include the exact command, the full error text, and whether it reproduces after
`npm run build && npm run preview`.
