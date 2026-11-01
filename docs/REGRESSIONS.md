# Regression ledger

One row per bug that was **fixed and later came back**. Not per bug fixed. A row exists because the fix did not hold,
and it names the test that now fails if it comes back — so "we fixed that in v2.8.0" can never again be the whole
answer.

This document is the answer to a specific failure in this project's history: v2.8.0 reported "multiple simultaneous VPS
connections solved (single status slot + reaper)", and in 4.3.1 **both original causes were back**, with no test that
could say "this is the same bug as before". A green suite of 3196 tests did not notice. A ledger that names the guard
does, because the guard is a test that fails on the *behaviour*, not on the version number.

## The table

| bug | fixed in | came back in | guarded by |
|---|---|---|---|
| several VPS sessions at once (single status slot) | v2.8.0 | v4.3.0 | `test/renderer/vps-multi-connect.test.tsx` `every connected server reads as connected even though the slot names the last one` |
| the idle reaper closing a session in use | v2.8.0 | v4.3.0 | `test/main/vps-pins.test.ts` `advances 35 virtual minutes and both servers are still connected` |
| the updater feed skipped the whole 4.2 and 4.3 line | v4.2.0 | never fixed until v4.3.5 | `test/ops/publish-feed.test.ts` `targets the repository the updater actually reads` |
| a script a test imports had no type declaration, so typecheck went red behind a green vitest | v4.2.0 | v4.3.5 | `test/ops/script-declarations.test.ts` `has a sibling .d.mts, because typecheck is what the release runs` |
| a failed transfer was reported as a loop instead of its cause | - | 4.3.5 | `test/core/verdict-patterns.test.ts` `names rsync present on the far side but not executable there` |
| a runtime scenario reported FAILED for a bug that was fixed, because the matcher ignored the quotes verify-ui prints | - | 4.3.6 | `test/ops/run-scenarios.test.ts` `matches a PASS line even though verify-ui quotes the strings it asserted` |
| a dead session reported as connected | — | 4.3.1 | `test/main/session-liveness.test.ts` `probes the held handle, transitions it to disconnected, and reconnects exactly once` |
| `Cost unknown` for an unpriced model | — | 4.3.0 | `test/renderer/status-line.test.tsx` `7. an unpriced model renders a lower bound, never "Cost unknown"` |
| the `Remote: … (connected)` banner | claimed removed in 4.3.0 | still there in 4.3.1 | `test/renderer/project-status.test.ts` `remote project with a connected VPS shows no banner at all (R6)` |
| a tool card rendering ok for a non-zero exit | — | — | `test/renderer/tool-card-outcome.test.tsx` `3. the logged bug: ok with a failed exit is not a success card` |
| one quoting rule, seven copies | — | — | `test/security/shell-quote.test.ts` `no module other than shared/shell-quote defines it` |
| a disconnected remote project reported as "Path not found" | v2.9.2 | — | `test/renderer/project-status.test.ts` `remote project never reports a missing path while the VPS is connected` |
| one verdict for "connected" re-derived by every surface (the header, the bar and the cards disagreeing) | v2.6.0 (D.1) | v4.3.0 | `test/renderer/connection-status.test.tsx` `7. (v2.6.4) a remote project stays connected while another host changed last` |
| a destroyed sandbox deleting the user's own project folder | v2.9.1 | — | `test/sandbox/manager.test.ts` `keeps a caller-supplied workspace on destroy` |
| the transcript printing a source note above every message (a JSX comment in the children position) | v4.0.1 | — | `test/renderer/message-bubble.test.tsx` `renders the message and NOTHING else — no stray source note in the transcript` |
| chat history in one flat list instead of grouped under its project | v2.8.0 | — | `test/renderer/sidebar-chat-grouping.test.tsx` `renders ONE tree: each project appears once, with its own chats nested under it` |
| a settings upgrade silently dropping every API key after the first | v3.1.1 | — | `test/agent/persistence.test.ts` `resolves both an old single-key file and a new pool file (v3.1)` |

**Rows: 17. Marked `MISSING`: 0** — every row above names a test that exists today.

## How to read a row

- **bug** — the behaviour a user saw, in the words of the report, not the internal cause. A cause can be fixed twice;
  the behaviour is what returns.
- **fixed in** — the release whose notes claim it was fixed. `—` means the bug was found by a test or an audit rather
  than by a report, so no release ever announced it.
- **came back in** — the release where it was seen again. `—` means it has not returned *yet*; it is still a bug whose
  fix did not hold once, which is why it has a row.
- **guarded by** — `path` + the **exact name of the test**. The path is checked, and so is the name, by
  `test/docs/regression-ledger.test.ts`.

## `MISSING` is the point of this document

If a regression comes back and **no test would notice**, its row says `MISSING` in the guard column. That is not a
formatting detail: `test/docs/regression-ledger.test.ts` fails on a `MISSING` row, so an unguarded regression cannot
quietly become "known and accepted". It stays a red build until a test names the behaviour.

The current count is zero because every row here already has its guard. The moment one does not, this paragraph is the
one that matters.

## What this ledger cannot do

- **It only remembers what was seen.** A bug nobody has hit yet has no row. That is the difference between "we have
  tests" and "we saw this once and wrote it down".
- **A named test is not a scenario.** A unit test pins the decision; the decision can still be wired to the wrong
  surface. The page-level check for that is `node scripts/verify-ui.mjs`, which launches the app and reads the live
  DOM — and which did not exist while 3196 unit tests were green and the window showed a green dot next to a dead
  session.
- **The names are checked, not the strength.** A test can be weakened without being renamed. The ledger makes a
  regression *visible*; it cannot make a weak test strong.

## Adding a row

1. The bug came back: reproduce it, write the failing test **first**, and let it fail for the reason the user saw.
2. Add the row with the bug in the user's words, both versions, and the new test's exact name.
3. Run `npx vitest run test/docs/regression-ledger.test.ts`. It fails while the name or the file is wrong, and while a
   row says `MISSING`.
