# Final Report — v2.3.1 (Critical Fixes & Security Hardening)

Sprint: `SPRINT_v2.3.1_CRITICAL_FIXES.md`
Branch: `feature/v2.3.1-critical-fixes` (base `master` @ `7003227`)

## 1. Completed tasks

### Section A — Critical fixes

| Task | Change | Commit |
| --- | --- | --- |
| A.1 | Fuzzy per-tool-call sliding-window loop detection (warn then stop) | `7e38936` |
| A.2 | Explicit local vs remote workspace type + legacy POSIX-path migration | `83abd5f` |
| A.3 | DeepSeek V4 catalog + legacy model-selection migration | `0cc1606` |
| A.4 | Centralized VPS connection state + auto-reconnect/keepalive | `56bacac` |
| A.5 | Full Access global-state sync via shared approval helpers | `fed6a54` |

### Section B — Security hardening

| Task | Change | Commit |
| --- | --- | --- |
| B.1 | `core/agent/redact.ts`; wired into logger, audit log, UI errors | `32c98ba` |
| B.2 | Mandatory host-key verification test suite (implementation pre-existed) | `ad48bbf` |
| B.3 | Per-host command policy: engine, persistence, enforcement, UI, chat surfacing | `a444ac6` |

### Section C — Verification

| Task | Result | Commit |
| --- | --- | --- |
| C.1 | Regression: typecheck + full suite + build green after every task | — |
| C.2 | Integration: approval→apply→audit, loop stop, VPS connect→chat→remote_shell | `bf950e3` |
| C.3 | Security suites: redaction, host-key, policy-engine | `32c98ba`, `ad48bbf`, `a444ac6` |
| C.4 | Headless Linux smoke test + screenshot (`docs/screenshots/v2.3.1/01-chat-empty.png`) | `bf950e3` |

### Section D — Delivery

| Item | Status |
| --- | --- |
| `CHANGELOG.md` v2.3.1 section | ✅ |
| `AGENTS.md` new patterns (Loop, Workspace Type, Redaction, Host Policy) | ✅ |
| `README.md` Troubleshooting | ✅ |
| `TESTING_GUIDE_v2.3.1.md` | ✅ |
| `FINAL_REPORT_v2.3.1.md` | ✅ (this file) |
| `package.json` version → 2.3.1 | ✅ |

## 2. Test statistics

| Metric | Value |
| --- | --- |
| Test files | 86 |
| Tests | **648 passed | 1 skipped** |
| New v2.3.1 suites (security + vps-state + approval + e2e) | 8 files / 89 tests |
| Typecheck (node + web) | ✅ |
| Production build (`npm run build`) | ✅ |

New test files:

- `test/security/redaction.test.ts`
- `test/security/host-key.test.ts`
- `test/security/policy-engine.test.ts`
- `test/renderer/vps-state.test.ts`
- `test/shared/approval.test.ts`
- `test/e2e/v2.3.1-critical-fixes.e2e.test.ts`

## 3. Commits and release

```
7e38936 fix(loop): fuzzy per-tool-call sliding-window loop detection
83abd5f fix(workspace): local vs remote project separation (Task A.2)
0cc1606 feat(models): DeepSeek V4 catalog + legacy migration path (Task A.3)
56bacac fix(vps): central VPS connection state + auto-reconnect (Task A.4)
fed6a54 test(approval): lock full-access global-state sync (Task A.5)
32c98ba feat(security): secret redaction for logs, audit and UI errors (Task B.1)
ad48bbf test(security): verify mandatory host-key verification (Task B.2)
a444ac6 feat(security): per-host command policy (Task B.3)
bf950e3 test(v2.3.1): integration coverage + Linux smoke screenshot (Tasks C.2, C.4)
f31d4a8 docs(release): v2.3.1 changelog, patterns, troubleshooting and testing guide (Section D)
```

Release:

- Merge commit **`4c88b0b`** `Merge v2.3.1: Critical Fixes & Security` on `master`
  (PR [#1](https://github.com/Arashtahmasbi3/ai-desktop/pull/1), merged).
- Annotated tag **`v2.3.1`**.
- **GitHub Release v2.3.1** (full, not pre-release):
  <https://github.com/Arashtahmasbi3/ai-desktop/releases/tag/v2.3.1> with assets
  `AI.Desktop.Setup.2.3.1.exe`, `AI.Desktop.2.3.1.Portable.exe` and `SHA256SUMS.txt`.
- `3c2c3d5` docs(agents): v2.3.1 released. Sprint complete. Next: user testing on Windows.

## 4. Smoke test (C.4)

Ran the packaged main entry under `xvfb-run` on Linux:

```
xvfb-run -a --server-args="-screen 0 1366x860x24 -ac" /tmp/smoke.sh
```

Result: Electron window rendered (1200×800 content area), only benign D-Bus/X
warnings, no renderer errors. Screenshot saved to
`docs/screenshots/v2.3.1/01-chat-empty.png`.

## 5. Windows build (Wine)

`npm run build:win` completed successfully on Linux via Wine 10.0
(electron-builder 26.15.3):

| File | Size (bytes) | SHA-256 |
| --- | --- | --- |
| `AI Desktop Setup 2.3.1.exe` | 112,445,537 | `07cba756...f86bde64` |
| `AI Desktop 2.3.1 Portable.exe` | 112,162,700 | `4984bff1...ccbcc2` |
| `SHA256SUMS.txt` | 189 | - |

Verify with `sha256sum -c SHA256SUMS.txt`.

## 6. Remaining

- **Clean Windows install/run test** by the user
  ([`TESTING_GUIDE_v2.3.1.md`](./TESTING_GUIDE_v2.3.1.md)).

## 7. Suggested work for v2.4

- Interactive approval prompt for host-policy `requiresApproval` (today it fails
  closed with a clear message rather than prompting).
- Per-command allow-list UX with a "remember this command" action backed by the
  audit log.
- Signed Windows builds and automatic update checks.
- Persist loop-detection warnings into the timeline so users can review them.
