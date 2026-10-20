# UI screenshots

`docs/screenshots/<theme>/<shot>.png` — the four surfaces listed in `scripts/lib/screenshot-core.mjs`, captured in
both themes by `node scripts/screenshots.mjs --port <n>` against a running app with the debug port open (see
`--remote-debugging-port` in `docs/` / `AGENTS.md`, item O4-2).

Each capture sits next to a `<shot>.png.baseline` file holding its dimensions and byte length, because the check that
runs in CI compares those rather than pixels:

- a **different window size** is always a real change and fails;
- a **byte length drift beyond 2%** fails (pixels moved);
- a **missing baseline** is reported separately, so the first run seeds rather than fails;
- an **empty capture** fails, because a blank window is not a passing screenshot.

It cannot say *where* the interface changed. It says *that* it changed and leaves the artefact for a human to open.
Pretending to a per-pixel diff this does not do would be worse than stating the limit.

## Seeding

```bash
npm run build
# start the app with the debug port, e.g. --remote-debugging-port=9223
node scripts/screenshots.mjs --port 9223 --baseline
```

Committing a new baseline is a deliberate act: it says "this is the interface now", so the diff of the baseline files
is part of the review.

## The live window (`live-shell.png`)

`node scripts/verify-ui.mjs` stages a packaged-like layout, launches the app and writes `light/live-shell.png` and
`dark/live-shell.png` for the window it just checked, so a failed invariant always has a picture next to it:

```bash
npm run build
node scripts/verify-ui.mjs            # checks the invariants, writes both captures
node scripts/verify-ui.mjs --baseline # same, and seeds the two `.baseline` files
```

Two differences from the four-surface captures above, both deliberate:

- it is **one** surface (the shell a user lands on), because that is the window the invariants are read from;
- the PNG is in **device pixels**, so its width and height depend on display scaling. A baseline captured on a 125%
  display does not match the same window on a 100% CI runner and would be reported as `size-changed`. Seed baselines
  on the machine that will compare them; the CI job runs without `--baseline` and uploads the PNGs.
