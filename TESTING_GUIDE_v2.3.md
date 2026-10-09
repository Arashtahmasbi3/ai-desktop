# Testing Guide — AI Desktop v2.3.0

Manual validation guide for the **v2.3.0 pre-release** (Sprint v2.3 “Codex-Like UX &
Approval System”). It focuses on the features that changed in v2.3; run the
[`TESTING_GUIDE_v2.0.0.md`](./TESTING_GUIDE_v2.0.0.md) pass first if you want full regression
coverage of the earlier sprints.

- **Build under test:** `v2.3.0` (pre-release)
- **Release page:** https://github.com/Arashtahmasbi3/ai-desktop/releases/tag/v2.3.0
- **Target OS:** Windows 10 (1909+) or Windows 11, 64-bit
- **Time needed:** ~25–35 minutes
- **Known limitations:** see [`KNOWN_ISSUES.md`](./KNOWN_ISSUES.md)

> ⚠️ The build is unsigned — expect a SmartScreen warning.

---

## 0. Prerequisites

- A DeepSeek API key (Settings → Integrations → Providers), or another configured provider.
- At least one project added (Settings → Coding → Projects).
- Optional: a connected GitHub account and/or SSH server for the Code Review and
  Connections checks.

---

## 1. Sidebar (C.1)

- [ ] Workspace switcher shows the active project at the top.
- [ ] Projects list shows connection status dots; hovering a project reveals its menu.
- [ ] Recents list supports rename, duplicate, export and delete.
- [ ] `Ctrl+K` focuses sidebar chat search.

## 2. Composer (C.2)

- [ ] The model switcher sits inside the input and shows a capabilities tooltip.
- [ ] The full-access toggle is visible inline under the input.
- [ ] The textarea auto-resizes up to 200px and `Ctrl/Cmd+Enter` sends.
- [ ] The send button is active with text and grey when empty.

## 3. File changes & approvals (B, C.3)

- [ ] Ask the agent to edit a file; the File changes panel lists each file with `+/-` stats
      and a file-type icon.
- [ ] With more than three files, “Show N more files” expands the list.
- [ ] Clicking a file opens the split diff review modal.
- [ ] Apply all / Reject all / Review individually behave per the active approval mode.
- [ ] Approving the same tool repeatedly triggers the “remember this tool?” suggestion.

## 4. Empty state & templates (C.4, D.1)

- [ ] A new chat greets by active project and shows four quick suggestions.
- [ ] Templates opens a dropdown with six built-ins; a saved template appears afterwards.

## 5. Message rendering & code runner (D.2)

- [ ] Assistant/user messages render Markdown; user bubbles align RTL with accent background.
- [ ] A fenced `bash`/`python`/`js` block shows Copy and Run buttons.
- [ ] In ask mode, Run confirms first; output and exit code render under the block.

## 6. Session fork (D.3)

- [ ] Hovering a message reveals “Fork from here”.
- [ ] Forking creates a new chat titled “(fork)” containing messages up to that point.

## 7. Voice input (D.4)

- [ ] On a supported runtime, a mic button appears in the composer and dictates text.
- [ ] On unsupported runtimes the button is hidden (no error).

## 8. Multi-window (D.5)

- [ ] `Ctrl+Shift+N` opens a second window.
- [ ] Each window keeps its own chat; settings changes in one window appear in the other.
- [ ] Window minimise / maximise / close affect the window that was clicked.

## 9. Progress timeline (D.6)

- [ ] The Activity button in the chat header toggles a vertical timeline.
- [ ] During a run the current step animates and a pending step is shown.
- [ ] Completed steps show a check; errors show a warning.

## 10. Settings redesign (C.5)

- [ ] Settings is two-column with grouped nav: General, Integrations, Coding, Advanced.
- [ ] **Providers / API Keys** — save, remove and select a model per provider.
- [ ] **Plugins** — Plugins / Apps / MCPs tabs, search filters, toggles persist.
- [ ] **Browser** — add a website; new entries default to “Always ask”.
- [ ] **Code Review** — repos list from GitHub with a per-repo “Auto review” toggle.
- [ ] **Connections** — Control this PC / Control other devices / SSH tabs work.
- [ ] **Approval Mode** — radio modes and remembered commands are manageable.
- [ ] **Memory / Usage / Developer** — context bar, session stats and version render.

---

## 11. Troubleshooting

- **Blank window after update** — clear `%APPDATA%\AI Desktop` caches and relaunch.
- **Mic button missing** — the runtime lacks the Web Speech API; expected behaviour.
- **Code Review empty** — connect GitHub (Settings → Integrations → GitHub) first.
