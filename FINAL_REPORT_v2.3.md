# Final Report — Sprint v2.3 “Codex-Like UX & Approval System”

- **Version:** 2.2.0 → **2.3.0**
- **Branch:** `feature/v2.3-codex-ux`
- **Sprint doc:** [`SPRINT_v2.3_CODEX_UX.md`](./SPRINT_v2.3_CODEX_UX.md)
- **Date:** 2026-10-05

---

## 1. Summary

Sprint v2.3 delivered a Codex-style workspace across four areas: critical bug fixes, an
approval system that learns, a UI/UX redesign, and advanced chat capabilities. All code tasks
(A.1–A.2, B.1–B.3, C.1–C.5, D.1–D.6) are implemented and covered by the automated suite.

## 2. Task status

| Task | Description | Status |
| --- | --- | --- |
| A.1 | Loop detection & prevention | ✅ done (carried from earlier commit) |
| A.2 | “Path not found” recovery (flag + re-locate) | ✅ done |
| B.1 | Improved approval dialog | ✅ done |
| B.2 | Full access toggle under composer | ✅ done |
| B.3 | Smart approval (remember tool) | ✅ done |
| C.1 | Sidebar redesign | ✅ done |
| C.2 | Composer redesign | ✅ done |
| C.3 | File changes panel in chat | ✅ done |
| C.4 | Empty state | ✅ done |
| C.5 | Codex-style Settings (two-column, categorized) | ✅ done |
| D.1 | Chat templates | ✅ done |
| D.2 | Code block runner | ✅ done |
| D.3 | Session fork | ✅ done |
| D.4 | Voice input | ✅ done |
| D.5 | Multi-window support | ✅ done |
| D.6 | Progress timeline | ✅ done |

## 3. Key changes

- **Bug fixes (A):** loop detection/warnings plus missing-project flagging with a Settings
  re-locate flow.
- **Approvals (B):** a clearer approval dialog, an inline full-access toggle, and
  tool-remembering suggestions backed by the approved-commands store.
- **UI/UX (C):** redesigned sidebar, composer (inline model switcher, auto-resize, keyboard
  send), a file-changes panel with diff review, a project-aware empty state, and a
  two-column Codex-style Settings panel with new pages (Plugins, Browser, Code Review,
  Connections, Approval, Memory, Usage, Developer).
- **Advanced (D):** chat templates, in-chat code block runner, session fork, Web Speech
  voice input, `Ctrl+Shift+N` multi-window with sender-scoped IPC and broadcast settings,
  and an animated, collapsible progress timeline.

## 4. Verification

| Check | Result |
| --- | --- |
| `npm run typecheck` (node + web) | ✅ green |
| `npm test` (vitest) | ✅ 76 files, 529 passed, 1 skipped |
| `npm run build` | ✅ green |
| New tests | `markdown-code` (3), `timeline` (4), `speech` (3), `prefs`/`catalog` (4) |

## 5. Files added (highlights)

- Renderer: `CodeBlock.tsx`, `ProgressTimeline.tsx`, `MicButton.tsx`, `ProvidersSection.tsx`,
  `ApprovedCommandsSection.tsx`, `SettingsPlugins.tsx`, `SettingsBrowser.tsx`,
  `SettingsConnections.tsx`, `SettingsCodeReview.tsx`, `SettingsApproval.tsx`,
  `SettingsMemory.tsx`, `SettingsUsage.tsx`, `SettingsDeveloper.tsx`.
- Libs: `lib/markdown-code.ts`, `lib/timeline.ts`, `lib/speech.ts`, `lib/prefs.ts`,
  `lib/catalog.ts`.
- Main/preload: `window:new` IPC + `shell.exec` plumbing already present; multi-window
  window-control IPC is now sender-scoped and settings events broadcast to all windows.

## 6. Deferred / follow-ups

- **Installer + GitHub pre-release:** not produced in this environment (no Windows runner).
  Run `npm run build:win` and publish `AI Desktop Setup 2.3.0.exe` / portable build.
- **Before/after screenshots** (`docs/screenshots/v2.3/`): require a GUI session; the
  directory is scaffolded with a note.
- **Manual Windows pass:** follow [`TESTING_GUIDE_v2.3.md`](./TESTING_GUIDE_v2.3.md).
