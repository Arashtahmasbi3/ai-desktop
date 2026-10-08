# Testing Guide — AI Desktop v2.0.0

This guide walks through validating the **v2.0.0 pre-release** on a **clean Windows machine**.
It covers every Sprint shipped since v1.0.0 (v1.1 → v2.0), so you can test the whole app in one
pass. Work through the checklists top to bottom and tick each box.

- **Build under test:** `v2.0.0` (pre-release)
- **Release page:** https://github.com/Arashtahmasbi3/ai-desktop/releases/tag/v2.0.0
- **Target OS:** Windows 10 (1909+) or Windows 11, 64-bit
- **Time needed:** ~30–45 minutes
- **Known limitations:** see [`KNOWN_ISSUES_v2.0.0.md`](./KNOWN_ISSUES_v2.0.0.md)

> **Start from a truly clean VM.** Ideally a fresh Windows install or a snapshot with no prior
> AI Desktop install, no leftover `%APPDATA%\AI Desktop` and no `node_modules`. Record the
> Windows build (`winver`) and whether Docker is installed.
>
> **⚠️ The build is unsigned** — expect a SmartScreen warning (see
> [§13 Troubleshooting](#13-troubleshooting)).

---

## 1. Download & verify integrity

Download from the release page:

- `AI Desktop Setup 2.0.0.exe` (installer)
- `AI Desktop 2.0.0 Portable.exe` (portable)
- `SHA256SUMS.txt` (checksums)

**Expected SHA-256 (v2.0.0):**

```
14f3135937e53f055b398d11fade2fe9ff4579e843fc32058033ef819a8602c9  AI Desktop Setup 2.0.0.exe
2b5d95528dd080a6a3e4cecea7d89d8c87689c096a19620ec06aa6b3d7710edf  AI Desktop 2.0.0 Portable.exe
```

### Verify with PowerShell

Open **PowerShell** in the download folder and run:

```powershell
Get-FileHash ".\AI Desktop Setup 2.0.0.exe"    -Algorithm SHA256 | Format-List
Get-FileHash ".\AI Desktop 2.0.0 Portable.exe" -Algorithm SHA256 | Format-List
```

Compare each `Hash` with the values above. To check automatically:

```powershell
$expected = @{
  "AI Desktop Setup 2.0.0.exe"    = "14f3135937e53f055b398d11fade2fe9ff4579e843fc32058033ef819a8602c9"
  "AI Desktop 2.0.0 Portable.exe" = "2b5d95528dd080a6a3e4cecea7d89d8c87689c096a19620ec06aa6b3d7710edf"
}
foreach ($f in $expected.Keys) {
  if (-not (Test-Path ".\$f")) { "MISSING  $f"; continue }
  $actual = (Get-FileHash ".\$f" -Algorithm SHA256).Hash.ToLower()
  if ($actual -eq $expected[$f]) { "PASS  $f" } else { "FAIL  $f`n  expected $($expected[$f])`n  actual   $actual" }
}
```

The release also ships `SHA256SUMS.txt`; you can cross-check it with:

```powershell
Get-Content .\SHA256SUMS.txt
```

- [ ] Both hashes **PASS**.

> **Private repo note:** if `curl`/browser shows a 404 on the download URL, you are signed out.
> The repository is private — sign in to GitHub (or use the API with a token) to download assets.

---

## 2. Installer — setup

- [ ] Run `AI Desktop Setup 2.0.0.exe`.
- [ ] Windows SmartScreen appears (expected — unsigned build). Click **More info → Run anyway**.
- [ ] The NSIS wizard opens with the **AI Desktop** icon in the header.
- [ ] The choose-directory page appears and the install path is **editable**. Choose a custom
      path, e.g. `C:\Tools\AI Desktop`.
- [ ] Installation completes and offers to run the app (`runAfterFinish`).

Notes to record: did Windows Defender/SmartScreen block or quarantine anything? Any elevation
prompt (UAC)?

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

- [ ] Run `AI Desktop 2.0.0 Portable.exe` from a folder (e.g. Downloads or a USB stick).
- [ ] It launches **without installing** and shows the same dark UI.
- [ ] Confirm it does not require admin rights.
- [ ] (Optional) Move the exe to a different folder and run it again — it should still work.
- [ ] Confirm the portable build and the installed build can coexist (or document what happens
      with shared `%APPDATA%` settings).

---

## 6. Base app: Settings, API key & streaming chat

- [ ] Open **Settings** (`Ctrl+,`).
- [ ] DeepSeek section: paste a valid **API key**, click **Save**.
- [ ] Relaunch the app and reopen Settings — the key persists and is stored encrypted
      (never plaintext in `%APPDATA%\AI Desktop`). Optionally inspect the file on disk.
- [ ] Model dropdown lists the provider's models; selecting one updates the active model.
- [ ] Send a simple message (e.g. *"سلام، یک تابع فیبوناچی پایتون بنویس"*).
- [ ] The reply **streams** token-by-token; Markdown/code renders correctly; the assistant
      message is left-aligned while the user message is right-aligned (RTL).
- [ ] **Enter** sends; **Shift+Enter** inserts a newline.
- [ ] The "typing…" indicator shows while streaming, and the view auto-scrolls.

---

## 7. Projects & local files

- [ ] In Settings → **Projects**, add a project: name + a real local folder path.
- [ ] The project appears in the list; the explorer shows its files.
- [ ] Open a file in the code viewer; make a small edit and confirm a **diff** is shown.
- [ ] Ask the assistant to read/write a file inside the project and confirm the change lands on
      disk and is reflected in the viewer.
- [ ] Remove the project with the delete button; confirm it disappears from the list.
- [ ] Confirm the app **cannot** read/write outside the project path (path-escape guard).

---

## 8. Sprint 1 — v1.1 (model & UX)

### 8.1 Model switcher in chat

- [ ] The chat header shows a **provider/model dropdown**.
- [ ] Switch the model and send a message — the reply uses the newly selected model (the
      effective model is reported back on completion).
- [ ] Switch to a **custom provider** from the "Other" group and confirm it is used.

### 8.2 Central model catalog

- [ ] Settings' provider select and the chat model picker list the **same** models/tags
      (`cheap` / `fast` / `powerful`).

### 8.3 Custom providers

- [ ] In Settings, add an OpenAI-compatible provider: base URL + model + optional headers.
- [ ] Click **Test connection** — a success/latency result is shown (and a bad endpoint fails
      gracefully without crashing).
- [ ] The custom provider appears in the model picker and a chat message works through it.
- [ ] Confirm the custom provider's API key is stored encrypted (never plaintext).

### 8.4 Onboarding

- [ ] On a fresh profile, the four-step wizard appears (welcome + model suggestion → connect a
      provider → add a project → summary).
- [ ] The suggested model matches your use case; the wizard can be **skipped**.
- [ ] Completion is persisted (it does not reappear after restart).

---

## 9. Sprint 2 — v1.2 (preview & browser)

### 9.1 Split diff

- [ ] Open a file, make an edit, and enable **split (side-by-side) diff** — each changed line is
      paired with its replacement and color-coded.

### 9.2 Markdown preview

- [ ] Open a `.md` / `.markdown` / `.mdx` file and confirm the rendered document appears next to
      its source.

### 9.3 Internal browser (Ctrl+4)

- [ ] Press `Ctrl+4` to open the **Browser** view.
- [ ] Enter a `https://` URL — the page loads; back/forward/reload and the history chips work.
- [ ] Try a bare host (e.g. `example.com`) — it is normalized to `https://`.
- [ ] Try `file://`, `javascript:` or `data:` — navigation is **denied**.
- [ ] Confirm the webview never gets Node access / the preload (View → the page cannot read
      `window.api`), and popups are blocked.

---

## 10. Sprint 3 — v1.3 (GitHub)

- [ ] Press `Ctrl+5` to open the **GitHub** view.
- [ ] Paste an OAuth App **client ID**, start the device flow, authorise in the browser, and
      confirm the app signs in (token stored encrypted, never shown in the renderer).
- [ ] The view shows the active project's git status: branch, ahead/behind, changed files.
- [ ] **Commit** (stage all) a change, then **Pull** (fast-forward) and **Push**.
- [ ] **Clone** a repository to a local folder.
- [ ] List your **open pull requests** and **issues**; the links open on GitHub.
- [ ] Pick a repository from the account list, and (alternative) type `owner/repo` manually.
- [ ] Confirm `git` not on PATH produces a clear error (not a crash).

---

## 11. Sprint 4 — v2.0 (VPS / Remote)

> Use a **throwaway** server for this section. You own the server, so the manual terminal is
> intentionally unrestricted (see [§13](#13-troubleshooting) and the v2.1 TODO).

### 11.1 Add a server & connect

- [ ] Press `Ctrl+6` to open the **VPS** view.
- [ ] Add a server using **key auth** (path to a private key) and a second using **password**.
- [ ] Connect: on the **first** connection a `SHA256:` host-key fingerprint is shown and must be
      **approved** before connecting.
- [ ] Disconnect and reconnect — the pinned key is accepted without re-prompting.
- [ ] Confirm a **changed** host key is **rejected** (simulate by editing the pinned key or
      connecting to a different host on the same entry).
- [ ] Confirm a missing key file / missing password **blocks** the connection instead of warning.

### 11.2 Live terminal

- [ ] Open the **Terminal** tab and run a command (e.g. `uname -a`, `ls -la`).
- [ ] Interactive commands work (e.g. `top`, then `q`) and the terminal resizes with the window.

### 11.3 Remote files (SFTP)

- [ ] Open the **Files** tab, browse directories, open and edit a file, and save it — the change
      lands on the server.

### 11.4 Security guards

- [ ] Run a dangerous command **through the agent's `remote_shell` tool** (e.g. `rm -rf /`) and
      confirm it is **blocked** with a clear reason.
- [ ] Fire >100 commands within a minute through the tool and confirm the **rate limit** kicks in.
- [ ] Open the **Audit** tab and confirm `connect` / `exec` / `blocked` / `rate_limited` events
      are logged.
- [ ] Leave a connection idle past 30 minutes (or shorten the clock in a dev build) and confirm
      it auto-disconnects.
- [ ] Confirm no password/passphrase is ever written to disk in plaintext and private keys are
      only referenced by path.

---

## 12. Uninstall & edge cases

### 12.1 Uninstall (installer build only)

- [ ] Settings → Apps → **AI Desktop** → **Uninstall** (or the Start Menu uninstaller).
- [ ] The app folder (including a custom install path) is removed.
- [ ] Desktop and Start Menu shortcuts are removed.
- [ ] User data is **kept** (`%APPDATA%\AI Desktop` still exists), so a reinstall keeps your
      API key/projects.
- [ ] Reinstall and confirm your settings/projects are restored.
- [ ] (Optional) Delete `%APPDATA%\AI Desktop` manually for a full reset.

### 12.2 Error & edge cases

- [ ] Launch with **no network** → app opens; a chat request fails gracefully (no crash, no
      infinite spinner).
- [ ] Use an **invalid API key** → a clear auth error is shown (with provider fallback where
      applicable).
- [ ] Rapidly send several messages → no UI freeze, no duplicate responses.
- [ ] Resize/maximize the window → layout stays correct.
- [ ] Leave the app open for a while and background/foreground it → no crash, memory stable.
- [ ] Close and reopen the app → the previous session/transcript is restored (resume).

---

## 13. Troubleshooting

Common issues and how to get past them. Full list in
[`KNOWN_ISSUES_v2.0.0.md`](./KNOWN_ISSUES_v2.0.0.md).

### 13.1 SmartScreen / Defender warning

- **Symptom:** *"Windows protected your PC"*; Defender may delay first launch.
- **Cause:** the build is **unsigned**.
- **Fix:** verify the SHA-256 ([§1](#1-download--verify-integrity)), then **More info → Run
  anyway**. To stop the warning on a test VM only: right-click the exe → Properties → **Unblock**.
- **Do not** disable Defender globally.

### 13.2 App launches but chat fails / "no key" errors

- **Cause:** AI Desktop bundles **no models** — it needs a provider key.
- **Fix:** Settings (`Ctrl+,`) → paste a valid **DeepSeek / OpenAI / Anthropic / Google** key →
  **Save**. Without a key (or without network) the assistant cannot respond. A wrong key shows a
  clear auth error.

### 13.3 Docker sandbox / code execution

- **With Docker running:** commands run in a hardened container (`--network none`, read-only
  rootfs, CPU/mem/PID limits).
- **Without Docker:** the app falls back to a **local** sandbox and still runs commands — this is
  a convenience fallback and **not** a security boundary. Only run trusted code.
- **Fix:** install/start Docker Desktop for stronger isolation. In automated tests the Docker
  case is the one **skipped** test when no daemon is present.

### 13.4 SSH connection problems

- **`git`/`ssh` not found:** GitHub repo operations need `git` on `PATH`; SSH needs a valid
  private key file path (or password).
- **Host-key prompt:** expected on first connect — approve only if the fingerprint matches your
  server. A changed key is always rejected (possible MITM).
- **Permissions:** on Windows, ensure the private key file is readable by your user and is not
  itself encrypted without a passphrase you have entered.

### 13.5 Maintainer: Windows build fails on Linux/macOS

- **Symptom:** NSIS step fails with `spawn wine ENOENT` / `wine32 is missing` /
  `failed to load .../ntdll.dll`.
- **Cause:** electron-builder runs the 32-bit installer once (for the uninstaller); its bundled
  Wine is 64-bit-only.
- **Workaround:** install `wine32:i386` + i386 deps and run `wineboot -u`.
- **v2.0 note:** `npmRebuild: false` is set in `electron-builder.yml` so the optional native
  `ssh2`→`cpu-features` module (which cannot be cross-compiled from Linux) is skipped; `ssh2`
  falls back to pure JS. See [`KNOWN_ISSUES_v2.0.0.md`](./KNOWN_ISSUES_v2.0.0.md) §4.

---

## 14. Suggested manual test scenarios (summary)

| # | Scenario | Expected |
| --- | --- | --- |
| T1 | Clean install via `Setup.exe` | Installs, launches, shortcuts created |
| T2 | Portable launch | Runs with no installation/admin |
| T3 | SHA-256 verify | Both hashes match |
| T4 | Add API key, restart | Key persists, encrypted |
| T5 | Streamed chat reply (Persian + code) | Streams, Markdown + RTL correct |
| T6 | Add project, read/write file | File changes on disk + diff shown |
| T7 | Path-escape attempt (write outside project) | Rejected |
| T8 | **v1.1** switch model mid-session | Next reply uses new model |
| T9 | **v1.1** add custom provider + Test connection | Works; bad endpoint fails gracefully |
| T10 | **v1.1** fresh profile onboarding | 4-step wizard, skippable, persisted |
| T11 | **v1.2** split diff | Changed lines paired + color-coded |
| T12 | **v1.2** Markdown preview | Rendered doc beside source |
| T13 | **v1.2** browser URL policy | `https` loads; `file:`/`js:` denied |
| T14 | **v1.3** device-flow sign-in | Signed in, token encrypted |
| T15 | **v1.3** commit / pull / push | Git status + operations succeed |
| T16 | **v1.3** list PRs & issues | Lists render, links work |
| T17 | **v2.0** connect with key & password | Connects after host-key approval |
| T18 | **v2.0** changed host key | Rejected |
| T19 | **v2.0** live terminal | Interactive + resizes |
| T20 | **v2.0** SFTP edit/save | Change lands on server |
| T21 | **v2.0** `rm -rf /` via agent tool | Blocked + audited |
| T22 | **v2.0** >100 cmds/min | Rate-limited |
| T23 | **v2.0** 30-min idle | Auto-disconnect |
| T24 | No network / invalid key | Graceful error, no crash |
| T25 | Uninstall (keep data) then reinstall | Data restored |
| T26 | Resume after restart | Transcript restored |

---

## 15. Bug report template

Copy the block below into a new GitHub issue
([file one here](https://github.com/Arashtahmasbi3/ai-desktop/issues/new)) and fill it in.

```markdown
### Summary
<!-- One line: what went wrong -->

### Build
- Version: v2.0.0 (pre-release)
- Artifact: [ ] Setup.exe   [ ] Portable.exe
- SHA-256 verified: [ ] yes  [ ] no
- Windows version (`winver`):
- Docker installed/running: [ ] yes  [ ] no  [ ] n/a
- Provider/model in use:
- Feature area: [ ] chat  [ ] projects  [ ] preview/browser  [ ] GitHub  [ ] VPS/SSH  [ ] other

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
- Renderer console: Ctrl+Shift+I → Console (dev builds)
- App data: %APPDATA%\AI Desktop (do NOT paste API keys or SSH credentials)
Paste any error text below:
-->

### Severity
- [ ] Blocker (cannot install / cannot launch)
- [ ] Major (core feature broken)
- [ ] Minor (cosmetic / edge case)

### Anything else
<!-- Workarounds tried, frequency (always/intermittent), etc. -->
```

**⚠️ Never paste API keys, tokens, SSH passwords or private keys** in an issue or its logs.

---

## 16. Reporting results

When your pass is complete, reply with:

1. The **checklist sections** completed and any that **failed** (with the section number).
2. Any **new bugs** filed (issue links).
3. Overall verdict: **installable & runnable / blocked**, and whether you'd recommend promoting
   `v2.0.0` from pre-release to a full release.

Thank you for testing! 🙏
