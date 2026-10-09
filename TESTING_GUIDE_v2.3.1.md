# Testing Guide — v2.3.1 (Critical Fixes & Security Hardening)

This guide covers what to verify for the v2.3.1 sprint. Run the automated suite
first, then the manual checklist on Windows.

## 1. Automated regression

```bash
npm run typecheck   # tsc for node + web
npm test            # full Vitest suite
npm run build       # electron-vite production build
```

Expected (current tree): **86 test files, 648 passed | 1 skipped**; typecheck and
build clean.

## 2. Targeted suites added in v2.3.1

```bash
npx vitest run test/security                 # redaction + host-key + policy engine
npx vitest run test/renderer/vps-state.test.ts
npx vitest run test/shared/approval.test.ts
npx vitest run test/e2e/v2.3.1-critical-fixes.e2e.test.ts
```

| Suite | Files | Focus |
| --- | --- | --- |
| `test/security/redaction.test.ts` | 1 | API keys/tokens/passwords/PEM are scrubbed before logs, audit and UI |
| `test/security/host-key.test.ts` | 1 | First-use approval, match, mismatch/MITM, pin persistence, audit |
| `test/security/policy-engine.test.ts` | 1 | Intent classification, mode/approval/allow/deny/path precedence, coercion |
| `test/renderer/vps-state.test.ts` | 1 | Central VPS state + reconnect selection |
| `test/shared/approval.test.ts` | 1 | Full-access global-state sync helpers |
| `test/e2e/v2.3.1-critical-fixes.e2e.test.ts` | 1 | chat→tool→approval→apply→audit, loop stop, VPS connect→chat→remote_shell |

Combined (`test/security` + the three named suites): **8 files, 89 tests**.

## 3. Manual checklist (Windows)

### 3.1 Loop detection (A.1)
1. Ask the agent to do something that repeats the same tool call (e.g. read a
   missing file repeatedly).
2. Expect a warning first, then the run stops with a "got stuck" message instead
   of exhausting every step.

### 3.2 Workspace type (A.2)
1. With a settings file from ≤ v2.3.0 that stores a POSIX path, start the app.
2. The project should be treated as **remote** and prompt for a VPS, not report
   "Path not found".

### 3.3 DeepSeek V4 (A.3)
1. Open **Settings → Providers** and confirm the current model list.
2. Choose a new model, restart, and confirm the selection persisted.

### 3.4 VPS state + auto-reconnect (A.4)
1. Connect a VPS; unplug the network for a few seconds and restore it.
2. The status bar, sidebar and settings should agree, and the connection should
   recover without re-adding the server.

### 3.5 Full Access (A.5)
1. Toggle Full Access in the composer and confirm the status bar reflects it
   (and vice versa); open a second window and confirm it stays in sync.

### 3.6 Secret redaction (B.1)
1. Run a task that logs a command containing a fake key
   (e.g. `curl -H "Authorization: Bearer sk-test" ...`).
2. Open the log / audit trail and confirm the value is redacted.

### 3.7 Host-key verification (B.2)
1. Connect to a new host; confirm it asks before trusting the fingerprint.
2. Reconnect: no prompt. Simulate a changed key and confirm it **fails** with a
   MITM warning and does not connect.

### 3.8 Per-host policy (B.3)
1. **Settings → Connections → SSH → <server>**.
2. Set the mode to **Read-only** and save. In chat, ask the agent to create a
   directory on that host — expect `Blocked by policy: …`.
3. Switch to **Staging** and confirm writes are allowed again; set approval to
   **Ask for writes** and confirm a write returns
   `Approval required by host policy: …`.

### 3.9 Smoke test screenshot
Captured headlessly on Linux for CI use:
`docs/screenshots/v2.3.1/01-chat-empty.png`.

## 4. Reporting a failure

Include the exact command, the full error text, and whether it reproduces after
`npm run build && npm run preview`.
