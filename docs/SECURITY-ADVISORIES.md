# Dependency advisories: current state and the one deliberate exception

Last reviewed: 2026-11-08, at v4.3.7 development, against `npm audit`.

## State

| | before the audit fixes | now |
|---|---|---|
| high | 2 (`electron`, `undici`) | **0** |
| moderate | 10 | **6** |
| total | 12 | **6** |

Shipped runtime dependencies are exactly **`["ssh2"]`**. Everything else in the audit is build-time or test-time
tooling, so none of it is in `app.asar`.

## Fixed

- **`electron` 44.6.0 → 44.10.2.** Below 44.9.1 the intermediate-certificate advisory
  ([GHSA-jr5w-w6x2-84p9](https://github.com/electron/electron/security/advisories/GHSA-jr5w-w6x2-84p9)) allows TLS
  forgery — a real risk for an app that talks to APIs and SSH. 44.10.2 is the newest of the same major, which is the
  smallest step that clears it. Verified by launching the app: `verify-ui` 6/6 invariants, screenshots unchanged, and
  `run-scenarios` 3 passed / 3 skipped.
- **`undici` 6.29.0 → patched** (pulled in through `node-gyp` inside `@electron/rebuild`). An unbounded-memory
  denial of service in the EventSource parser.
- **`vitest`, `@vitest/mocker`, `fast-uri`, `postcss-selector-parser`, `electron-builder-squirrel-windows`** — all
  patched by `npm audit fix` without a major bump. 33 packages changed; typecheck clean, 377 files / 3616 tests green,
  the production build succeeds and `npm run pack` still produces a working unpacked app.

## The deliberate exception: the `electron-builder` chain

Six advisories remain, all inside **`electron-builder`** and its sub-packages (`app-builder-lib`, `dmg-builder`,
`@electron/universal`, `electron-builder-squirrel-windows`, `minimatch`). They are:

- **not shipped.** `dependencies` is exactly `["ssh2"]`; these packages are build tooling, run on a developer machine
  at packaging time and never loaded by the app at runtime.
- **reported as fixable only by a downgrade.** `npm audit` points at `electron-builder@25.1.0`, while the project is on
  **26.15.3**. The advisory's own range (`>=25.1.2`) means the current version is affected *and* the suggested version
  is older than the one in use. Following it would replace a newer packaging tool with an older one to silence a
  warning about that tool's glob and archive handling.
- **in the category where a false sense of security is worse than a recorded decision.** Running `npm audit fix --force`
  here is how a release pipeline breaks quietly: the next `npm run build:win` would fail somewhere inside
  `app-builder-lib`, and the failure would look unrelated to the dependency change.

Decision: **stay on 26.15.3** and revisit when `electron-builder` publishes a version outside the advisory range. The
trigger to re-check is a new minor or major of `electron-builder`, or a change in the advisory's range.

## Reproducing

```
npm audit                    # expect: 6 moderate, 0 high
npm audit --json | node -e "…"   # per-advisory detail
npm run typecheck && npm test
npm run pack                 # proves the bumped toolchain still packages
```

## What this document is not

It is not an argument that six moderate advisories are harmless. It is a statement of where they live, what they can
reach, and what the alternative costs — so the next person can decide differently with the same facts instead of
discovering the exception in a lockfile diff.
