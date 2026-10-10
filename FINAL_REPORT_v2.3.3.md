# Final Report — Sprint v2.3.3 “Git-Aware Agent + Self-Diagnosis”

**Branch:** `feature/v2.3.3-git-aware`
**Version:** `2.3.2` → `2.3.3`
**Date:** 2026-10-05

## 1. Result

The agent is now **git-aware and self-diagnosing**. When a remote project is
connected it detects whether the folder is a git repository, adapts its system
prompt to use `git` commands (or plain file tools), blocks a tool that keeps
failing and reroutes to an alternative, shows git status in the UI, offers an
opt-in “Setup Git?” flow for non-repo folders, diagnoses the host’s environment
and can install missing tooling behind an explicit, sudo-aware approval.

All tasks were executed without skipping.

## 2. Tasks & commits

| Task | Deliverable | Commit |
| --- | --- | --- |
| A.1 | Remote git detection (`detectWorkspace`, `vps:workspaceInfo`, `WorkspaceBadge`) | `ea7c567`, `b85b52f` |
| A.2 | Dynamic git-aware system prompt (`buildWorkspaceSystemHint`) | `03cae99`, `b85b52f` |
| A.3 | Smarter loop detector (per-tool blocking) | `a378bf3` |
| B.1 | Auto git-setup planner + `GitSetupDialog` | `1e7b7bc`, `e613a41` |
| B.2 | Remote git status parser + `GitStatusPill` | `bb110ce`, `e613a41` |
| C.1 | Environment health check (`getSystemHealth`) | `138c162`, `e613a41` |
| C.2 | Diagnostics panel (`DiagnosticsPanel`) | `e613a41` |
| C.3 | Installation assistant + approval gate | `cb4460b`, `e613a41` |
| D.1/D.2 | Integration + security e2e, `runRemoteCommands`, `assertInstallAllowed` | `1d4471e` |
| D.3 | Version, CHANGELOG, AGENTS.md, guides, report | this commit |

## 3. Files

**Core (pure, injected boundaries)**
- `src/core/remote/workspace-detect.ts`, `git-setup.ts`, `git-status.ts`,
  `system-health.ts`, `run-commands.ts`
- `src/core/agent/workspace-prompt.ts`, `install-recipes.ts`, `loop-detector.ts`
- `src/shared/workspace-info.ts`, `system-health.ts`

**Main / preload**
- `src/main/agent-service.ts` (detection cache + prompt wiring)
- `src/main/vps-ipc.ts` (`vps:workspaceInfo|gitStatus|gitStatusParsed|systemHealth|gitSetup|installTool`)
- `src/preload/index.ts`, `src/preload/index.d.ts`

**Renderer**
- `WorkspaceBadge.tsx`, `GitStatusPill.tsx`, `DiagnosticsPanel.tsx`,
  `GitSetupDialog.tsx`; wired into `ChatPanel.tsx`, `Sidebar.tsx`,
  `ProjectsSection.tsx`, `Vps/VpsPanel.tsx`.

## 4. Tests

```bash
npm run typecheck   # clean
npx vitest run      # 108 files · 815 passed · 1 skipped
npm run build       # electron-vite production build OK
```

- Targeted v2.3.3 suites: **62 tests** (8 files).
- e2e `v2.3.3-git-aware`: 6 integration + 3 security scenarios.
- Bugs caught and fixed by tests during the sprint:
  - `.gitignore` heredoc quoting in `git-setup`;
  - empty-input fallbacks in the `system-health` parsers.

## 5. Security

- Every install requires explicit approval; sudo recipes require a **separate**
  root confirmation (`assertInstallAllowed`). Nothing auto-executes.
- `runRemoteCommands` aborts on the first failing command and surfaces the exact
  error (e.g. an invalid git token), instead of continuing blindly.
- Git detection is advisory only — it never weakens host policy or approvals.

## 6. Notes / follow-ups

- `npm run build:win` (NSIS + portable exe) must run on **Windows**; this
  environment is Linux, so the installer was not produced here. Run it on the
  Windows host and attach the artifacts + `SHA256SUMS.txt` to the GitHub release.
- `GitStatusPill` refreshes every 30s while a remote project is connected; a
  manual refresh can be added later if needed.
