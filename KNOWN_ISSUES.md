# Known issues

> **This file is a pointer, not a version log.** The unversioned `KNOWN_ISSUES.md` used to describe v1.0.0 and still
> declared the current release to be v2.6.4, eight versions behind — a reader following `README` got a list of
> limitations that no longer existed and missed the ones that did.

Where the current state actually lives:

| Question | Document |
|---|---|
| What the app can do, and what is only partial | [`docs/CAPABILITY_MATRIX.md`](./docs/CAPABILITY_MATRIX.md) |
| Bugs that were fixed and came back | [`docs/REGRESSIONS.md`](./docs/REGRESSIONS.md) |
| Security advisories and why they are not forced away | [`docs/SECURITY-ADVISORIES.md`](./docs/SECURITY-ADVISORIES.md) |
| Release-by-release changes | [`CHANGELOG.md`](./CHANGELOG.md) |
| How agents work in this repository, and the known traps | [`AGENTS.md`](./AGENTS.md) |

## The limitations that are still true today

- **The build is not code-signed.** Windows shows *"Windows protected your PC"* on every install; choose *More info →
  Run anyway*, and verify the file against the release's `SHA256SUMS.txt`.
- **The local sandbox is not a security boundary.** It is a convenience for running the agent's commands with the
  user's privileges. Use Docker for untrusted code.
- **An API key is required.** There are no bundled models.
- **SSH operations need a reachable host.** The app explains a refused or filtered connection; it cannot make a
  firewall allow one.
