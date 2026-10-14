> ⚠️ **SUPERSEDED — this document describes v1.0.0 only.** The application is now at
> **v2.6.4**; see `AGENTS.md` (Status) and `CHANGELOG.md` for the current state, and the
> versioned `*_v2.3.x.md` documents for later testing guides. Kept for history; do not treat
> its counts, feature list or limitations as current.
# Testing Guide â€” AI Desktop v1.0.0

This guide walks through validating the `v1.0.0` **pre-release** on a **clean Windows machine**
before we promote it to a full release. It is aimed at the volunteer testers running the VM.

- **Build under test:** `v1.0.0` (pre-release)
- **Release page:** https://github.com/Arashtahmasbi3/ai-desktop/releases/tag/v1.0.0
- **Target OS:** Windows 10 (1909+) or Windows 11, 64-bit
- **Time needed:** ~20â€“30 minutes
- **Known limitations:** see [`KNOWN_ISSUES.md`](./KNOWN_ISSUES.md)

> **Start from a truly clean VM.** Ideally a fresh Windows install or a snapshot with no prior
> AI Desktop install, no leftover `%APPDATA%\AI Desktop` and no `node_modules`. Record the
> Windows build (`winver`) and whether Docker is installed.

---

## 1. Download & verify integrity

Download from the release page:

- `AI Desktop Setup 1.0.0.exe` (installer)
- `AI Desktop 1.0.0 Portable.exe` (portable)
- `SHA256SUMS.txt` (checksums)

**Expected SHA-256 (v1.0.0):**

```
74422356ec9883cb3e0675cc27aff601ba928e6021416dd722ce4ee7e123ab95  AI Desktop Setup 1.0.0.exe
71af42f0e2fd403ef0a1b5a106bcb2dcbd8f4d43461b70e1431ac9bb5f15981a  AI Desktop 1.0.0 Portable.exe
```

### Verify with PowerShell

Open **PowerShell** in the download folder and run:

```powershell
Get-FileHash ".\AI Desktop Setup 1.0.0.exe"    -Algorithm SHA256 | Format-List
Get-FileHash ".\AI Desktop 1.0.0 Portable.exe" -Algorithm SHA256 | Format-List
```

Compare each `Hash` with the values above. To check automatically:

```powershell
$expected = @{
  "AI Desktop Setup 1.0.0.exe"    = "74422356ec9883cb3e0675cc27aff601ba928e6021416dd722ce4ee7e123ab95"
  "AI Desktop 1.0.0 Portable.exe" = "71af42f0e2fd403ef0a1b5a106bcb2dcbd8f4d43461b70e1431ac9bb5f15981a"
}
foreach ($f in $expected.Keys) {
  $actual = (Get-FileHash ".\$f" -Algorithm SHA256).Hash.ToLower()
  if ($actual -eq $expected[$f]) { "PASS  $f" } else { "FAIL  $f`n  expected $($expected[$f])`n  actual   $actual" }
}
```

- [ ] Both hashes **PASS**.

---

## 2. Installer â€” setup

- [ ] Run `AI Desktop Setup 1.0.0.exe`.
- [ ] Windows SmartScreen appears (expected â€” unsigned build). Click **More info â†’ Run anyway**.
- [ ] The NSIS wizard opens with the **AI Desktop** icon in the header.
- [ ] The license/choose-directory page appears and the install path is **editable**
      (`allowToChangeInstallationDirectory`). Choose a custom path, e.g. `C:\Tools\AI Desktop`.
- [ ] Installation completes and offers to run the app.

Notes to record: did Windows Defender/SmartScreen block or quarantine anything? Any
elevation prompt (UAC)?

---

## 3. First launch

- [ ] App launches and shows the **AI Desktop** window (dark theme, RTL chat area, Vazirmatn).
- [ ] Title bar renders with the window controls; no blank/white window.
- [ ] Open **DevTools** (Ctrl+Shift+I) and confirm the **Console has no red errors**.
      *(Dev builds only; if the packaged build hides DevTools, note that.)*
- [ ] No "Failed to load renderer" or `ERR_FILE_NOT_FOUND`.

---

## 4. Desktop & Start Menu shortcuts

- [ ] A **Desktop** shortcut named **AI Desktop** exists and launches the app.
- [ ] A **Start Menu** entry under **AI Desktop** exists and launches the app.

---

## 5. Portable build

- [ ] Run `AI Desktop 1.0.0 Portable.exe` from a folder (e.g. Downloads or a USB stick).
- [ ] It launches **without installing** and reuses/applies the same dark UI.
- [ ] Confirm it does not require admin rights.
- [ ] (Optional) Move the exe to a different folder and run it again â€” it should still work.

---

## 6. Settings, API key & a real chat

- [ ] Open **Settings** (gear icon).
- [ ] DeepSeek section: paste a valid **API key**, click **Save**.
- [ ] Relaunch the app and reopen Settings â€” the key persists and is stored encrypted
      (never plaintext in `%APPDATA%\AI Desktop`). Optionally check the file on disk.
- [ ] Model dropdown lists the provider's models; selecting one updates `activeModel`.
- [ ] Send a simple message (e.g. *"Ø³Ù„Ø§Ù…ØŒ ÛŒÚ© ØªØ§Ø¨Ø¹ ÙÛŒØ¨ÙˆÙ†Ø§Ú†ÛŒ Ù¾Ø§ÛŒØªÙˆÙ† Ø¨Ù†ÙˆÛŒØ³"*).
- [ ] The reply **streams** token-by-token in the chat; Markdown/code renders correctly and
      the assistant message is left-aligned while the user message is right-aligned (RTL).
- [ ] **Enter** sends; **Shift+Enter** inserts a newline.
- [ ] The "typingâ€¦" indicator shows while a response is streaming, and it auto-scrolls.

---

## 7. Projects & local files

- [ ] In Settings â†’ **Projects**, add a project: name + a real local folder path.
- [ ] The project appears in the list; the explorer shows its files.
- [ ] Open a file in the code viewer; make a small edit and confirm a **diff** is shown.
- [ ] Ask the assistant to read/write a file inside the project and confirm the change lands
      on disk and is reflected in the viewer.
- [ ] Remove the project with the delete button; confirm it disappears from the list.
- [ ] Confirm the app **cannot** read/write outside the project path (path-escape guard).

---

## 8. Sandbox / code execution

- [ ] With **Docker running**: ask the assistant to run a snippet; execution succeeds in the
      sandbox and the output is shown in the task/log panel.
- [ ] With **Docker stopped/absent**: confirm the app falls back to the **local** sandbox and
      still runs commands (see [`KNOWN_ISSUES.md`](./KNOWN_ISSUES.md)).
- [ ] Run a command that fails (non-zero exit) and confirm the error/stderr is surfaced, not
      swallowed, and the app stays responsive.
- [ ] Run a long command and confirm the 30 s timeout is enforced and reported.
- [ ] Confirm no orphaned sandbox workspaces remain after a run, and that stopping the app
      cleans up its own workspaces **without** deleting your project folder.

---

## 9. Uninstall (installer build only)

- [ ] Settings â†’ Apps â†’ **AI Desktop** â†’ **Uninstall** (or the Start Menu uninstaller).
- [ ] The app folder (including a custom install path) is removed.
- [ ] Desktop and Start Menu shortcuts are removed.
- [ ] User data is **kept** by default (`deleteAppDataOnUninstall: false`) â€” confirm
      `%APPDATA%\AI Desktop` still exists and contains your encrypted settings, so a reinstall
      keeps your API key/projects.
- [ ] Reinstall and confirm your settings/projects are restored.
- [ ] (Optional) Delete `%APPDATA%\AI Desktop` manually for a full reset.

---

## 10. Error & edge cases

- [ ] Launch with **no network** â†’ app opens; a chat request fails gracefully with a clear
      error (no crash, no infinite spinner).
- [ ] Use an **invalid API key** â†’ an auth error is shown; the app falls back / reports clearly.
- [ ] Rapidly send several messages â†’ no UI freeze, no duplicate responses.
- [ ] Resize the window / maximize â†’ layout stays correct.
- [ ] Leave the app open for a while and background/foreground it â†’ no crash, memory stable.
- [ ] Close and reopen the app â†’ previous session/transcript is restored (resume).

---

## 11. Suggested manual test scenarios (summary)

| # | Scenario | Expected |
| --- | --- | --- |
| T1 | Clean install via `Setup.exe` | Installs, launches, shortcuts created |
| T2 | Portable launch | Runs with no installation/admin |
| T3 | SHA-256 verify | Both hashes match |
| T4 | Add API key, restart | Key persists, encrypted |
| T5 | Streamed chat reply (Persian + code) | Streams, Markdown + RTL correct |
| T6 | Add project, read/write file | File changes on disk + diff shown |
| T7 | Path-escape attempt (write outside project) | Rejected |
| T8 | Run code with Docker on | Runs in sandbox |
| T9 | Run code with Docker off | Local fallback works |
| T10 | Command failing / timing out | Error surfaced, app stable |
| T11 | No network | Graceful error, no crash |
| T12 | Invalid API key | Clear auth error |
| T13 | Uninstall (keep data) then reinstall | Data restored |
| T14 | Resume after restart | Transcript restored |

---

## 12. Bug report template

Copy the block below into a new GitHub issue
([file one here](https://github.com/Arashtahmasbi3/ai-desktop/issues/new)) and fill it in.

```markdown
### Summary
<!-- One line: what went wrong -->

### Build
- Version: v1.0.0 (pre-release)
- Artifact: [ ] Setup.exe   [ ] Portable.exe
- SHA-256 verified: [ ] yes  [ ] no
- Windows version (`winver`): 
- Docker installed/running: [ ] yes  [ ] no  [ ] n/a
- Provider/model in use: 

### Steps to reproduce
1. 
2. 
3. 

### Expected behavior
<!-- What you expected -->

### Actual behavior
<!-- What actually happened -->

### Screenshots / screen recording
<!-- Drag files here, optional but very helpful -->

### Logs
<!--
Where to find them:
- Renderer console: Ctrl+Shift+I â†’ Console (dev builds)
- App data: %APPDATA%\AI Desktop (do NOT paste API keys)
Paste any error text below:
-->

### Severity
- [ ] Blocker (cannot install / cannot launch)
- [ ] Major (core feature broken)
- [ ] Minor (cosmetic / edge case)

### Anything else
<!-- Workarounds tried, frequency (always/intermittent), etc. -->
```

**âš ï¸ Never paste API keys, tokens or secrets** in an issue or its logs.

---

## 13. Reporting results

When your pass is complete, reply with:

1. The **checklist sections** completed and any that **failed** (with the section number).
2. Any **new bugs** filed (issue links).
3. Overall verdict: **installable & runnable / blocked**, and whether you'd recommend promoting
   `v1.0.0` from pre-release to a full release.

Thank you for testing! ðŸ™
