# Known Issues & Limitations — AI Desktop v1.0.0

This document lists the known limitations of the **v1.0.0 pre-release**. None of these are
surprises — they are tracked here so testers know what to expect. See
[`TESTING_GUIDE.md`](./TESTING_GUIDE.md) for how to validate the build and
[`FINAL_REPORT.md`](./FINAL_REPORT.md) for full verification details.

Severity key: **⚠️ Expected** (by design / environment), **ℹ️ Limitation** (planned for a
future release), **🐞 Bug** (unintended, please report).

---

## 1. No code signing → SmartScreen warning ⚠️

The installer and portable executable are **not code-signed** (no signing certificate is
configured for this build).

- **Symptom:** Windows shows *"Windows protected your PC"* / SmartScreen may also delay or
  warn on first run. Some antivirus engines may flag an unknown publisher.
- **Impact:** Cosmetic/friction only — the binaries are the ones we built (verify the SHA-256,
  see the testing guide).
- **Workaround:** Click **More info → Run anyway**.
- **Fix (maintainers):** provide a code-signing certificate; the build signs automatically when
  `CSC_LINK` / `CSC_KEY_PASSWORD` (or an OS certificate) are set. No code change required.

---

## 2. An API key is required ⚠️

AI Desktop has **no bundled models** — it calls a hosted provider.

- **Symptom:** Chat does nothing / shows an auth error until a key is set.
- **Requirements:** a valid **DeepSeek** API key (primary), or an **OpenAI**, **Anthropic**, or
  **Google** key. Keys are entered in **Settings** and stored encrypted via the OS keystore.
- **Impact:** Without a key (and network access), the assistant cannot respond.
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

## 4. Clean-machine install not yet verified 🐞 → please test

Packaging and the installer were verified **structurally** (valid NSIS3 build, uninstaller,
UAC/dir dialogs, correct payload), but installing and running on a genuine clean Windows
machine has **not** been confirmed by the team yet.

- **Impact:** this is the main reason `v1.0.0` is a **pre-release**.
- **Action:** run [`TESTING_GUIDE.md`](./TESTING_GUIDE.md) on a clean VM and report back before
  we promote to a full release.

---

## 5. SSH/VPS and GitHub/Git are agent-driven, not UI features ℹ️

The assistant can work with remote VPSes (SSH), GitHub (Git) and local files **through its
tool layer**, but there are no dedicated UI panels for them yet.

- **Impact:** no host manager, no saved SSH keys UI, no interactive terminal, and no hosted
  GitHub OAuth flow. Operations are driven by the agent.
- **Planned:** first-class SSH/VPS panel and GitHub integration UI are on the v1.1 roadmap.

---

## 6. Remote-access server is localhost-only ℹ️

A background server exposes local tooling over the loopback interface.

- **Impact:** it is not exposed to the network and has **no authentication/transport security**
  for remote exposure. Do not bind it to a public interface.
- **Planned:** auth and TLS are candidates for a future release if remote access is desired.

---

## 7. Renderer ships as a single JS chunk ℹ️

The renderer bundle is one ~321 KB minified chunk (plus ~25 KB CSS); there is no
code-splitting.

- **Impact:** negligible for a desktop app loading from disk; noted for completeness.
- **Planned:** lazy-loading the settings/editor routes in a future release.

---

## 8. Windows-target builds on Linux/macOS need 32-bit Wine ⚠️

Only relevant to **maintainers** cross-building the Windows installer off Windows.

- **Symptom:** the NSIS step fails with `spawn wine ENOENT`, then `wine32 is missing`, then
  `failed to load .../ntdll.dll`.
- **Cause:** electron-builder runs the 32-bit installer once to generate the uninstaller;
  electron-builder's bundled Wine is 64-bit-only.
- **Workaround:** install `wine32:i386` (with its i386 deps) and initialize the prefix
  (`wineboot -u`). Documented in [`AGENTS.md`](./AGENTS.md).

---

## 9. Other notes ℹ️

- **User data is kept on uninstall** (`deleteAppDataOnUninstall: false`) so a reinstall keeps
  your settings/projects. To fully reset, delete `%APPDATA%\AI Desktop` manually.
- **Persian/RTL:** only the **chat content** is RTL; menus and labels are English. Full UI
  localization (fa/en string catalogs) is not implemented.
- **First-run cost/latency:** streaming depends on the provider's network latency and rate
  limits; rate-limit and timeout errors are surfaced in the UI.

---

## Reporting

Found something not listed here, or one of the above behaving differently than described?
Please open an issue using the template in
[`TESTING_GUIDE.md`](./TESTING_GUIDE.md#12-bug-report-template). **Never include API keys or
tokens in a report.**
