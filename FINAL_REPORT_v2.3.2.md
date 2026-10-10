# Final Report — v2.3.2 (Remote-First Architecture & Security Alignment)

Sprint: `SPRINT_v2.3.2_SECURITY_ALIGNMENT.md`
Branch: `feature/v2.3.2-security` (base `master`)

## 1. Completed tasks

### Phase A — Critical fixes

| Task | Change | Commit |
| --- | --- | --- |
| A.1 | Remote-first file routing (`routeToolCall` + orchestrator seam) | `f98f693` |
| A.2 | Remote-aware project status; no false "Path not found" | `9d0c24d` |
| A.3 | Context-aware host policy (read/write command lists) | `ec3763a` |
| A.4 | Per-command timeouts with kill | `e0f7cc3` |
| A.5 | Plan Mode — approve before mutating tool calls | `815df44` |

### Phase B — Security & transparency

| Task | Change | Commit |
| --- | --- | --- |
| B.1 | Back up files before destructive remote writes | `ec1dad6` |
| B.2 | Post-deploy health checks | `3d31c19` |
| B.3 | rsync dry-run before a real migration | `cae73e1` |
| B.4 | Context preview before send | `185c913` |
| B.5 | `~/.ssh/config` import (paths only) | `234b453` |

### Phase C — Project isolation

| Task | Change | Commit |
| --- | --- | --- |
| C.1 (data) | Per-project metadata schema v3 | `ab0b6de` |
| C.1 (UI) | Expandable project metadata editor | `368c023` |
| C.2 | Sidebar badges + policy-mismatch warning; chat pre-approval warning | `a29cb92`, `a219bf3` |

### Phase D — Verification & release

| Task | Result | Commit |
| --- | --- | --- |
| D.1 | Integration suite, 7 scenarios | `379a0ce` |
| D.2 | Security suite, 5 scenarios + `allowedPaths` traversal fix | `cc6e374` |
| D.3 | Docs, version bump, merge, tag, build, release | (this file) |

## 2. Test statistics

| Metric | Value |
| --- | --- |
| Test files | **101** |
| Tests | **763 passed | 1 skipped** |
| Typecheck (node + web) | ✅ |
| Production build (`npm run build`) | ✅ |

New test files in this sprint:

- `test/e2e/v2.3.2-security.e2e.test.ts` — 8 tests / 7 scenarios
- `test/security/v2.3.2.test.ts` — 7 tests / 5 scenarios
- `test/renderer/sidebar-projects.test.tsx` — 4 tests
- `test/renderer/chat-policy-warning.test.tsx` — 3 tests
- `test/renderer/settings-projects.test.tsx` — 6 tests
- `test/helpers/fake-ssh.ts` — shared SSH fakes

## 3. Security finding fixed

D.2.2 (path traversal) uncovered a real bypass in the host policy: with
`allowedPaths: ['/srv/app']`, the command `cat /srv/app/../../etc/passwd` was
**allowed** because containment compared raw strings. `evaluateHostPolicy` now
lexically normalises `.`/`..` before comparing (new pure helpers
`normalizeAbsolutePath` / `isWithin`), and fails closed when a path climbs above
the root. Local resolution (`normalizeSandboxPath`, `FileService.resolveSafe`)
already rejected `..`; both are now covered by regression tests.

## 4. Commits and release

See `git log master..feature/v2.3.2-security`. Merge, tag and release details:

- Merge commit: `_pending_`
- Tag: `v2.3.2` (annotated)
- GitHub Release: `_pending_`

## 5. Windows build (Wine)

`_pending_` — filled in after `npm run build:win`.

| File | Size (bytes) | SHA-256 |
| --- | --- | --- |
| `AI Desktop Setup 2.3.2.exe` | _pending_ | _pending_ |
| `AI Desktop 2.3.2 Portable.exe` | _pending_ | _pending_ |
| `SHA256SUMS.txt` | _pending_ | - |

## 6. Remaining

- **Clean Windows install/run test** by the user
  ([`TESTING_GUIDE_v2.3.2.md`](./TESTING_GUIDE_v2.3.2.md)).

## 7. Suggested work for v2.4

- Interactive approval prompt for host-policy `requiresApproval` (today it fails
  closed with a clear message rather than prompting).
- Enforce host-policy `allowedPaths` inside the remote-fs (`remote_*`) tools, not
  only for shell commands.
- Git worktree multi-task support (sprint C.3, intentionally deferred).
- Signed Windows builds and automatic update checks.
