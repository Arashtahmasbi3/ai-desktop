# Known Issues & Limitations — AI Desktop v2.0.0

This document lists the known limitations of the **v2.0.0 pre-release**. None of these are
surprises — they are tracked here so testers know what to expect. See
[`TESTING_GUIDE_v2.0.0.md`](./TESTING_GUIDE_v2.0.0.md) for how to validate the build and
[`FINAL_REPORT_v2.0.0.md`](./FINAL_REPORT_v2.0.0.md) for full verification details.

Severity key: **⚠️ Expected** (by design / environment), **ℹ️ Limitation** (planned for a
future release), **🐞 Bug** (unintended, please report).

---

## 1. No code signing → SmartScreen warning ⚠️

The installer and portable executable are **not code-signed** (no signing certificate is
configured for this build).

- **Symptom:** Windows shows *"Windows protected your PC"*; SmartScreen may also delay or warn
  on first run. Some antivirus engines may flag an unknown publisher.
- **Impact:** Cosmetic/friction only — the binaries are the ones we built (verify the SHA-256 in
  [`TESTING_GUIDE_v2.0.0.md`](./TESTING_GUIDE_v2.0.0.md#1-download--verify-integrity)).
- **Workaround:** **More info → Run anyway** (or right-click → Properties → **Unblock** on a test
  VM).
- **Fix (maintainers):** provide a code-signing certificate; the build signs automatically when
  `CSC_LINK` / `CSC_KEY_PASSWORD` (or an OS certificate) are set. No code change required.

---

## 2. An API key is required ⚠️

AI Desktop has **no bundled models** — it calls a hosted provider.

- **Symptom:** chat does nothing / shows an auth error until a key is set.
- **Requirements:** a valid **DeepSeek** API key (primary), or an **OpenAI**, **Anthropic**, or
  **Google** key. Keys are entered in **Settings** and stored encrypted via the OS keystore
  (`safeStorage`) — never in plaintext, never exposed to the renderer.
- **Impact:** without a key (and network access) the assistant cannot respond.
- **Notes:** usage may incur provider costs; a wrong/invalid key produces a clear auth error and
  triggers provider fallback where applicable.

---

## 3. Docker is optional for the sandbox ⚠️

Code execution prefers a **Docker** sandbox but has a **local fallback**.

- **With Docker running:** commands run in a hardened container (resource limits, `--network none`,
  read-only rootfs).
- **Without Docker:** the app transparently falls back to the **local** sandbox and still runs
  commands.
- **Impact / caution:** the local fallback runs with your user's privileges and is **less
  isolated** — only run code you trust. Prefer Docker for untrusted code.
- **Automated tests:** the Docker integration test is skipped when no Docker daemon is present
  (that's the one skipped test in the suite).

---

## 4. `ssh2` native dependency & Linux cross-build ⚠️

SSH support uses **`ssh2`**, the only runtime dependency. It ships a pure-JS fallback, but also
has an **optional native** module, `cpu-features`.

- **Cross-building on Linux/macOS:** `cpu-features` **cannot be cross-compiled** to Windows from
  Linux, so the build sets `npmRebuild: false` in [`electron-builder.yml`](./electron-builder.yml).
  `cpu-features` is **not packaged**; `ssh2` uses its JS fallback at runtime. No user-facing
  impact — noted for maintainers.
- **Legacy Wine note:** cross-building the NSIS installer still needs 32-bit Wine
  (`wine32:i386` + `wineboot -u`), because electron-builder runs the 32-bit uninstaller once.

---

## 5. TODO v2.1 — opt-in deny list for the manual terminal ℹ️

The dangerous-command **deny list** is enforced on the agent's `remote_shell` tool and the
`exec`/rate-limited paths — but **not** on commands you type **manually** in the VPS terminal.

- **Reason:** you own the server; the manual terminal is intentionally unrestricted, like any
  normal SSH client.
- **Planned (v2.1):** a Settings toggle — *"Apply deny list to the manual terminal"* —
  **default off**. When enabled, typed input is checked against the same rules.
- Tracked in [`AGENTS.md`](./AGENTS.md) → **Backlog**.

---

## 6. Clean-machine install not yet verified 🐞 → please test

Packaging and the installer were verified **structurally** (valid NSIS3 build, uninstaller,
UAC/dir dialogs, the packaged payload includes `ssh2` + transitive deps) and the built app was
smoke-tested on Linux under `xvfb` (window loads, `window.api` complete, IPC handlers respond,
no console errors). However, installing and running on a **genuine clean Windows machine** has
**not** been confirmed yet.

- **Impact:** this is the main reason `v2.0.0` is a **pre-release**.
- **Action:** run [`TESTING_GUIDE_v2.0.0.md`](./TESTING_GUIDE_v2.0.0.md) on a clean VM and report
  back before we promote to a full release.

---

## 7. Remote-access server is localhost-only ℹ️

A background server exposes local tooling over the loopback interface.

- **Impact:** it is not exposed to the network and has **no authentication/transport security**
  for remote exposure. Do not bind it to a public interface.
- **Planned:** auth and TLS are candidates for a future release if remote access is desired.

---

## 8. Renderer ships as a single JS chunk ℹ️

The renderer bundle is one large minified chunk (plus a small CSS file); there is no
code-splitting.

- **Impact:** negligible for a desktop app loading from disk (Vite warns about the 500 KB
  threshold at build time); noted for completeness.
- **Planned:** lazy-loading the settings/editor routes in a future release.

---

## 9. Other notes ℹ️

- **User data is kept on uninstall** (`deleteAppDataOnUninstall: false`) so a reinstall keeps
  your settings/projects. To fully reset, delete `%APPDATA%\AI Desktop` manually.
- **Persian/RTL:** only the **chat content** is RTL; menus and labels are English. Full UI
  localization (fa/en string catalogs) is not implemented.
- **GitHub requires `git` on PATH** and a user-supplied OAuth App client id (device flow, no
  backend). The token is stored with `safeStorage`.
- **First-run cost/latency:** streaming depends on the provider's network latency and rate
  limits; rate-limit and timeout errors are surfaced in the UI.
- **VPS host keys are pinned per-server** after explicit approval; a changed key is always
  rejected. If you legitimately rebuilt your server, remove and re-add the connection to re-pin.

---

## Reporting

Found something not listed here, or one of the above behaving differently than described?
Please open an issue using the template in
[`TESTING_GUIDE_v2.0.0.md`](./TESTING_GUIDE_v2.0.0.md#15-bug-report-template). **Never include
API keys, tokens, SSH passwords or private keys in a report.**
