# Changelog

All notable changes to **AI Desktop** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [4.3.4] — 2026-10-22

The release where the agent can finally work outside the project it was opened on, and move a real project to a new
server — the two things that had blocked the user's migration for weeks.

### Changed — containment belongs to the file tools, not to a remote shell

The app refused to **read** a directory on a server the user owns as root:

> `Blocked: Path "/opt/zoonestore/apps" is outside project root "/opt/sepehr-motor"`

The exemption for a remote command required the command to be **provably read-only**, and every real diagnostic fails
that proof because of a redirect, a pipe or a loop — so the exemption existed and was unreachable. `enforceCommandPaths`
with `CommandHost = 'remote-host'` now does no path checking at all: the project root is a write-scope for tools that
write on the agent's behalf, not a read-scope for a shell on a host the user is root on. The file tools keep
containment, the `..` rule, the secret guard and the deny list.

A write through `remote_shell` whose path escapes the root is no longer a wall: it goes to the **approval gate**, even
in `full` mode, ignoring remembered approvals and the server grant for that one case, and runs only when approved.

### Added — a refusal that says which rule and what to do

Every refusal now names the rule (`containment`, `deny-list`, `secret-path`, `host-policy`, `approval-required`), offers
at least one runnable alternative ("add <path> as a project", "read it with a remote shell command", "allow this path
once"), and redacts any UUID. A **time-boxed one-shot allow** (10 minutes, one prefix, one server, one project,
read-only, expiry evaluated on read) is checked inside the containment decision and audited as
`allow-scope <path> until <time>`.

### Added — a second project on the same server

The fence was never the blocker and there was no uniqueness rule: `addProject` already allowed two roots on one server.
The root a record *received* was broken — no add-time rule for an absolute path that cannot be local here (the record
changed kind across a restart), a remote re-root that used the local normaliser, a trailing slash that made two roots
out of one, a local folder picker offered for a remote project, and an Add button disabled unless a server was
connected. All fixed, and the error banner now carries a click-only **Add as a project** button that opens the add form
pre-filled from the refused path.

### Added — migrating a project, with the route chosen rather than guessed

Source server + path → target server + path, and the mode comes from the existing three-path reachability report:
`direct` when the source can reach the target, **`relay` through this computer** when only the local path can. Fourteen
preflight facts each PASS/WARN/FAIL — target free space fails, a source over 85 % only warns — default excludes printed
in the exact argv, a baseline before and a 20-file sampled sha256 after with a loud failure on any mismatch. Bytes go to
a staging directory and appear at the destination through a single `mv -T`, so an interrupted run can never leave a
directory that looks complete; staging names are derived, so a re-run resumes. Cancel kills the child. IPv6 targets are
bracketed for `ssh`/`rsync` while the `/dev/tcp` probe writes the bare literal.

### Added — the database and the new host

`migrate_database` dry-runs first (the exact commands and the size, nothing written), then dumps, restores and compares
a baseline: table count, bounded per-table row counts and the dump's sha256. The bring-up checklist is a first-class
flow, not free-form chat: `.env` keys reported **present or missing and never by value**, `npm ci`, build, PM2 for both
apps, the nginx site with `nginx -t`, certbot for both domains, then a health check per app — each step with its
command, its expected result and a PASS/FAIL mark, resumable and cancellable. The database report shares one surface
with the file verification.

### Verified

373 test files / 3586 tests green, typecheck clean, locale parity 1308 keys. Every new command path is exercised through
an injected runner — no test runs `rsync`, `ssh`, `docker`, `psql`, `nginx` or `certbot`, and none touches a network.

### Not verified

Nobody has run a migration against the real pair of servers with this release. The flows are covered by injected
runners and exact-argv assertions, not by bytes crossing the wire; and the relay needs a POSIX `rsync` on this computer.

## [4.3.3] — 2026-10-21

Two bugs the user photographed an hour after 4.3.2, and one test that was asserting the opposite of its own name.

### Fixed — a manual Disconnect is a decision, not an interruption

At 15:04 the user disconnected `spmotor` (red dot, `Connect` button). At 15:05 it was `connected` again without a
click: `reconnectOnce` was the only automatic connect path and it never asked who had asked for the session to be down.

`SshManager.userDisconnected` now records it. `disconnect(id)` — the UI's Disconnect — sets it; the idle reaper, the
liveness probe and a transport failure do **not**; a manual `connect(id)` is the only thing that clears it. While it is
set, `reconnectOnce` and `connectAutomatically` refuse to open, write one audit line, and the tool result tells the
model the session **was disconnected by the user**, that no reconnect was attempted and none will be while it stays
down, so it should ask rather than retry. `vps:connect` now carries a mode and defaults to **automatic** (fail-closed);
the background keep-alive asks for automatic, the Connect button, the banner and the migration dialog ask for manual.
The R3 pins were checked: they keep an *existing* session and never open one.

### Fixed — a success no longer carries the previous attempt's error

The same screen showed `connected` **and** `Timed out while waiting for handshake`: the first attempt timed out, a later
one succeeded, and the older error stayed. The manager's success state is now built fresh (the live-handle branch no
longer spreads the cached state), `normalizeConnectionState` drops `error` and `pendingFingerprint` from any connected
state, and the panel clears its own copy on the transition and never renders it while connected.

### Fixed — a test that contradicted its name

`test/renderer/thread-state.test.ts > never claims one legacy spelling for two different states` keyed by **state** and
required the raw spelling to match — which forbids the synonym map the module documents (`pending`, `scheduled`,
`waiting_to_start` all mean `queued`). Two spellings sharing a state is the feature; one spelling drifting between two
states is the bug. The body now checks the invariant its name states. It was red before this release and nobody was
watching, which is the same failure mode as the red CI job.

### Verified

Proven the way that counts here: twelve source files were backed up with sha256, reverted with the tests kept →
**10 failed, 2 passed**, restored with all twelve hashes re-verified. 354 test files / 3293 tests green, typecheck clean,
locale parity 1212 keys in both languages.

### Not verified

Nobody has yet watched 4.3.3 with a real dying SSH session, and the harness (`scripts/verify-ui.mjs`) checks the shell's
six invariants rather than a live drop. That screenshot is still owed.

## [4.3.2] — 2026-10-20

The release where the app stopped being trusted and started being run.

### Fixed — the half-open session the 4.3.1 screenshot caught

`SessionLivenessExecutor` acted only when the SSH layer held **no** session or a handle reported transport words. A
half-open handle broke both: the manager still held it, so "no session" was false, and the tool's text was
`Not connected`, which was the other branch's vocabulary. Nothing fired — no probe, no transition, no reconnect — and
the header dot kept showing green while every command failed. The user's own log proved it: `steps: 1`, and not one
occurrence of the word `reconnect`.

Now a dropped-session result **while a handle is still held** runs `probeLiveness()`: one `exec('true')` on that
connection with a 2 s deadline, bypassing the deny list, host policy and rate limiter because it is a health check and
not a user command. An answer means alive and nothing is torn down; a rejection or timeout goes through `disconnect()`,
which publishes the per-server liveness event so the header dot, the tree row and the selector flip in the same tick —
and only then does exactly one reconnect run. The result text says which of the three paths fired and how the
reconnect went, and a disconnected tooltip now carries the reason (`ECONNRESET`), not just the machine name.

Proven by reverting the four changed source files with the tests kept: **7 failed, 16 passed**, then restored
byte-identically with the sha256 checked.

### Added — a command that runs the app and refuses to lie about it

The app had 3196 unit tests and still shipped a shell that claimed a dead session was connected, because **no test
ever ran it**. `node scripts/verify-ui.mjs` now does: clear `ELECTRON_RUN_AS_NODE` (the variable that silently made
`electron.exe` run as plain Node and cost three rounds of "no screenshot possible"), stage the layout outside
`Documents` where Defender lets it execute, launch with a debug port, poll for the page, read the DOM over CDP, assert
six invariants (no raw UUID · no `Cost unknown` · no `Remote: … (connected)` · exactly one status bar · a visible
two-option interface switch · the header dot agreeing with the workspace item), screenshot both themes, and exit
non-zero listing what it found. Its decision logic is a pure module with its own tests; the launching half is small and
says so.

`docs/REGRESSIONS.md` records the bugs that were fixed and came back, each with the test that now guards it, and a test
fails when a row names a test that does not exist or a regression nothing guards. That file exists because v2.8.0
recorded "several VPS sessions at once" as fixed and v4.3.0 brought the same two causes back.

### Not verified

Still no live session-drop run **by me** against 4.3.2: the harness asserts the shell's invariants and the behaviour is
covered by injected-transport tests, but nobody has yet watched 4.3.2 with a real dying SSH session. That is one
screenshot away, and it is the user's to take.

346 test files / 3196 tests plus the harness files, typecheck and production build clean.

## [4.3.1] — 2026-10-19

A second session of the same user, three screenshots, and the root cause the last six rounds kept treating as a
symptom.

### The bug that made everything else look broken

Every remote tool failed in 0.00–0.01 s with `Not connected` while the chat header, the banner and the tree dot all
said connected. The stop card then said *"no specific cause: the output matches no known failure pattern"*, and the
drift guard claimed the last two steps had *"re-run probes whose answers it already had"* — the probes never ran.

Two causes, both recorded as fixed in v2.8.0 and both regressed:

- **The watchdog.** `SshManager` disconnects any server not `markActive` for 30 minutes, and only the active project's
  server was being pinged. So a second connection died silently after half an hour. Sessions now carry **pins** (a run,
  an open remote project, or a manual connection) and a pinned session is never swept — while an unpinned idle one
  still closes, so the reaper is not disabled.
- **The single status slot.** The renderer kept a last-writer-wins `vpsStatus` and two surfaces treated it as the set
  of connected servers. `vpsStates` is now the only source of truth, and a `vps:liveness` event per server flips the
  header, the banner and the tree dot in the same tick.

### Fixed

- **A dead session is a fact with a name.** `session-dropped` is now a verdict (weight 88) matching the real strings —
  `Not connected`, `remote_error`, `channel closed`, `ECONNRESET` — with two actions: reconnect and retry, or use
  another server.
- **One reconnect, never two.** Every remote tool that finds its session gone gets exactly one bounded
  `reconnectOnce(serverId, reason)`; the outcome is reported, the failed call is never re-run, and a command that
  merely *prints* "not connected" cannot tear down a healthy session.
- **An infrastructure failure stops the run on the first occurrence**, and is counted as neither progress nor
  "no new information". The matcher lives in one module shared by the verdict and the loop detector.
- **No raw UUID reaches the user.** The diagnostics message named two ids; it names the server now.
- **`Cost unknown` is gone.** An unpriced model reports a lower bound, in those words.
- **The `Remote:` banner is gone** — it had survived a claim that it was removed, and it asserted `(connected)` while
  the session was dead.
- **The simple/advanced switch is visible again** as a segmented control with `aria-pressed`; a menu item is what the
  original U3-1 existed to undo.

### Not verified, stated plainly

**No screenshot pass.** `npm run build` succeeds, but launching `electron.exe` on this machine is cancelled by the OS
(`The operation was canceled by the user`) before a debug port opens, so the shell was not looked at. The evidence for
this release is 346 test files and the build, not a picture of the window. The session fixes are proven against
injected clocks and fake transports; a live cut-session run is still owed.

346 test files / 3188 tests green, typecheck and production build clean.

## [4.3.0] — 2026-10-19

Everything here came from one real session log, not from a review of the code. The user asked four times whether a
project could be migrated between two servers, and the app answered with the same diagnosis each time while the screen
showed contradictory facts. Reading the stored session (94 messages, 6 steps, 4 sessions) turned six guesses into facts.

### The root cause was outside the app, and the app could not say so

Port 22 on the target was blocked **above** the host: ping answered with 0% loss, the target's own `ss -lntp` showed
sshd listening on 0.0.0.0:22 and [::]:22, `ufw` was absent and `iptables` had no rules — yet the TCP connect was
filtered from two independent source networks. The provider blocks it. Nothing in the app, and no model, could transfer
the project until that changes; the two real ways forward are to open the port in the provider's panel, or to route the
copy through the user's own computer.

### Fixed — the five things the app got wrong

- **`offline` meant three things.** `list_servers` reported a server as `offline` when it merely held no SSH session,
  and the user read "the machine is down". Each server now reports `hasSession`, its port fact per path *with the time
  it was observed*, and never prints `offline`. An unobserved path reads `unknown`, never `closed`.
- **Only one path was ever probed.** The local path — a different network by construction, and the one that would have
  decided the question — was never tried. Reachability is now proven from the target itself, from a source server, and
  from this computer, each recorded separately; "local open, source closed" produces the through-this-computer route
  and the provider ticket, in one sentence each.
- **The question gate resolved itself.** After five minutes it told the model "proceed with your best judgement" and
  the run kept stepping while the card stayed on screen. Now the deadline pauses (nothing settles, no tool runs), the
  card offers an explicit "resume with my best assumption", and a second configured ceiling ends the run as
  `needs_input` with a recorded reason.
- **An option was a sentence.** The three options the model sent were 48, 68 and 83 characters with em dashes; the card
  truncated them and RTL reordering produced fragments. An option is now one line, ≤32 characters, ≤5 words, no dash,
  and a violation is refused with the way out.
- **Progress counted activity.** `ip -6 addr` (27.8s) and a project-wide grep (41.5s) were both "productive", so the
  no-progress counter never moved. A step of read-only probes now counts only when it teaches something, and two such
  steps stop the run with what it was doing and what it has ruled out.

### Fixed — three smaller ones from the same log

- `remote_shell` compared every absolute path in a payload with the project root, so `df -h /opt` and `ls /root/.ssh`
  were refused as "outside project root" on the remote host. Containment now stands down for a provably read-only
  remote command and still applies to anything that writes, moves, deletes or redirects.
- A tool card rendered "ok" for a command that exited 2. Four outcomes now — `ok`, `warning` (exit 0 with stderr),
  `failed` (`ok: false` or non-zero exit), `blocked` — and the words ok/success cannot appear for a failure.
- A blocked port with the host proven up is now its own verdict (`upstream-blocked`, weight 78) with two concrete
  actions, instead of "a firewall or security group on the target".

### Added

- **A diagnosis is remembered between sessions.** A per-project ledger records durable verdicts and, for 24 hours, the
  run is told what is already established, with its timestamp, instead of re-running the same probe. The user can
  forget any line.
- **A Linux-desktop shell.** Six redundant surfaces deleted (see the commit): one title bar, one sidebar tree with
  chats nested under projects, one status line, a composer of attach/input/model/send, a bottom-sheet question card,
  and grouped tool rows. The brutalist system is replaced by 1px hairlines, 6px radius, no shadow, system font,
  28px rows and one accent — and `brutal-tokens.test.ts` was rewritten to pin the new contract rather than deleted.

### Known limits, stated rather than hidden

- **No screenshot pass.** This machine refuses to execute a freshly built unsigned exe, so the new shell is verified by
  340 test files and a production build, not by looking at the window.
- **The migration flow (X7) is not built.** A first-class source→target form with the three-path preflight is specified
  in the plan and remains the next piece of work; until then the transfer is still driven through the chat.
- **`View context` has no dedicated button** — it lives in the Sources panel's "View all".
- **The mic stays in the composer**; it was not on the removal list.
- Status colours are still painted as text on older surfaces; the new ones use a dot for state.
- Code signing remains deferred to the public release.

### Numbers

340 test files, 3139 tests, 12 checklist items closed, 1 deferred (X7). Typecheck and production build clean.

## [4.2.0] — 2026-10-19

Thirty-two audit findings, worked in the order they were approved, and the substrate the app was missing: a tool
contract, MCP, skills, and three god files split. Every item below is a commit, and every claim below is a test.

### Added — capabilities that arrive as data, not code

- **MCP servers.** A server configured in Settings publishes tools; they appear to the model as
  `mcp__<server>__<tool>` and run inside every run, including a local one with no VPS. The client speaks the spec's
  newline-delimited JSON over stdio, tolerates a banner before the protocol, negotiates the version instead of
  enforcing it, rejects pending calls when a server dies, and closes every child process in a `finally`. A server's
  tools are **never** silently approved: they get shell semantics and their own dialog label, because the user chose
  "auto-approve writes" for the agent's own tools, not for a process they just installed.
- **`SKILL.md`.** A folder with a markdown file is now a capability: the run discovers it, the system hint carries
  only names and one-line descriptions, and `use_skill(name)` loads a body capped at 8000 characters. Names are
  lookup keys, never path segments, so `../secrets` is simply unknown.
- **A stopped run names its cause** from a table of twelve patterns instead of a chain of `if`s — and the card shows
  it. The old chain reported a **refused** connection as an SSH timeout, because "connect to host" matched its
  timeout test.
- **A usage dashboard** that answers "where did this month's spend go": days, providers, models, against the cap.
- **A debug port in a packaged build**, off by default and bound to loopback, so a user's install can be diagnosed.
- **A release script** (`npm run release -- <version>`) that refuses a dirty tree, a non-master branch, an invalid
  bump or an already-released version, prints its plan, builds outside `Documents` (the Defender trap), writes
  checksums and stops before committing.
- **CI** with a second job that captures the interface in both themes over CDP and reports what changed.

### Changed — the substrate

- **One place assembles a run's tools** (`ToolsetBuilder`). `agent-service` grew a run's tools by pushing into two
  parallel arrays five and six times; a definition without a route is a tool nothing can run, and a route without a
  definition is a tool nothing can call. Neither is visible in a diff.
- **Three files over 2000 lines became thirty-four modules**, none over 800: `store.ts` 2243 → 193 (nine files, and
  no importer changed), `agent-service.ts` 1967 → 744 (ten), `agent-orchestrator.ts` 2072 → 785 (seventeen). The
  orchestrator's split was checked mechanically — 47 log events before and after, 213 long prompt strings still
  present — because a reordered prompt is invisible to a type checker.
- **The network policy covers the ways a command actually reaches a host**: raw TCP, scanners, HTTP clients, DNS,
  remote copies, and inline interpreter sockets. `curl http://localhost:3000` **is** a network action; the dialog now
  names the address. The read-only set did not widen.
- **`ask_user` stopped repairing bad options.** Core used to drop and truncate a model's 8-option list silently, so
  the card showed a set the model never designed. Now it refuses with the way out, and the run continues.
- **Empty and error states** obey one rule through one component: say what is missing, at most two actions.
- **Disclosure**: a file change, a long output and a trace step each have a summary that reads on its own, with the
  detail one action away.

### Fixed

- `connection refused` no longer reported as a timeout (the verdict table above).
- The file-change panel's per-file `+added / −removed` counts, dropped by the disclosure rework and restored — the
  old assertion was kept, the behaviour was fixed.
- A copy of `shellQuote` in seven files became one, with 22 tests that round-trip hostile values through a real shell.
- Two effects with silenced dependency lists: one now has a `useCallback`, the other has a test proving its narrow
  dependency list is deliberate.
- **179 assertions on exact UI copy** are now a ratchet that may only shrink, and the 10 double casts are a budget
  with a reason per file.

### Changed — process

- **Rules that were prose now fail the build**: a settings switch nothing reads, an unregistered capability, a new
  double cast, a new exact-copy assertion, a missing capability-matrix row.
- **`docs/CAPABILITY_MATRIX.md`** states every capability as real / partial / absent with what proves it. Code
  signing and the review queue are listed as **absent** rather than omitted.

### Known limits, stated rather than hidden

- **One invariant of the settings-capability test was lost** when the agent writing it was interrupted; its body was
  cut and left a dangling assertion. It is deliberately not guessed back, because an invented version of that scan
  could pass while checking nothing. The other four invariants are live.
- **The screenshot driver's runtime path is unexercised on this machine**: Defender blocks executing a freshly built
  unsigned exe from `Documents`. Its decision logic has 13 tests; the CI job is where it runs.
- **The debug port's flag is tested, its packaged runtime is not**, for the same reason.
- Code signing remains deferred to the public release, and the review queue needs an explicit product decision.

### Numbers

327 test files, 2971 tests, 34 new modules, 15 commits. Typecheck clean.

## [4.1.0] — 2026-10-18

### Changed — a stopped run now explains itself

Every stop used to end with "It looks like I got stuck", a heading that always claimed "paused to avoid a loop"
(even when the clock had run out), and an offer to Continue / Correct / Stop. The app knew which tool had failed
and why, and said none of it.

- **A deterministic verdict, with no model call.** `LoopStopInfo` now carries the failed observations, the step
  count and any pending question; a verdict built from them names the cause — *"the SSH connection to the target
  timed out"*, *"a path outside the project was refused"*, *"the clock ran out after N steps"* — lists the evidence
  and ends with one concrete next step. Every branch has a next step, asserted for all five reasons.
- **The heading matches the cause**, and a question asked with `ask_user` is a question, not a fault: it no longer
  reads "Stuck on ask_user" and no longer offers a re-run.
- **The turn clock measures idleness.** A 300s budget was being spent on network timeouts (a ping, an `nc` probe,
  two SSH attempts, then a port scan) and the run died while it was making progress. The window now slides forward
  on every productive step, with a hard ceiling of four windows, and the stop message says which limit fired.
- **A reachability failure offers the through-this-computer route** — two streaming commands using the reader's own
  ssh keys. The app does not relay it itself, and the card says why: the remote file API is text-only, so relaying
  a project would corrupt binaries.

### Fixed — two bugs found in the user's own session log

- **A remote payload is not a local path.** `ssh host 'df -h /opt'` was refused with "Path \"/opt\" is outside
  project root", because the guard checked one host's filesystem against another host's project root. The payloads
  of `ssh`/`mosh` are no longer scanned; `bash -c` and `sh -c` still are, since they run locally — otherwise a
  shell wrapper would be a one-line bypass of the workspace boundary.
- **Four approval prompts for read-only diagnostics.** `ping`, `du` and `df` are read-only, but every probe asked,
  because a `;` inside a quoted remote payload invented a phantom segment whose command was a dangling quote, and
  a wrapper's payload arrived still quoted. A quote-aware splitter and a tolerant quote strip fix both; `nc` and
  `/dev/tcp` scans are still asked, now as network actions.

### Added

- **Network actions are their own class.** `/dev/tcp`, `nc`, `nmap` and `telnet` are detected and described, and
  the gate asks about them **before** any read-only shortcut: "this command reaches another host". `curl`,
  `wget`, `ping` and `ssh` are excluded on purpose, so the friction that was just removed does not return.
- **A real per-server connection test.** One TCP connection from this computer, reported as open/timeout/refused/
  unreachable with the latency, a copyable result and an explicit "from this computer" — so the agent never has to
  improvise a port scan again.
- **Simple mode by default.** The terminal, the chat file tree and the model's raw reasoning rest until asked for,
  with one switch to advanced.

### Fixed — presentation

- The execution trace printed `##`, `**` and `|` literally. The chat's markdown pipeline is now shared, so the
  trace, the plan card and the tool card render prose the same way the message bubble does. Labels, tool ids and
  paths stay plain text.
- Right-to-left prose was pinned to LTR in the trace, plan and tool cards: `dir="auto"` on a container resolves
  once, from the container's own first strong character, and the trace starts with an English label. Each prose
  element now decides for itself, while commands and paths carry an explicit `dir="ltr"`.
- A failed tool card showed a middle-truncated prefix of a long compound command while the error named a part far
  to the right. The card now shows the segment the error quotes, matched by whole token.

### Changed — the window

- **One Stop** (in the composer), **one entry point to Sources/Outputs** (the rail's own tabs), **four status
  items** with the rest in a right-click menu, and a chat row that is title, time and one `⋯` menu instead of a
  glyph that read as a checkbox.

**Suite: 296+ test files, ~2500 tests green; typecheck and production build clean.**

## [4.0.1] — 2026-10-16

### Fixed — the chat transcript, which the restyle had missed entirely

Found by reading a **real conversation** instead of the component list. `MessageBubble` used no clay
classes, so the mechanical rename never touched it and it never appeared in a sweep; it is also the
most-used surface in the app. The rendered transcript showed the old language sitting inside the new
one: an assistant message in a soft `rounded-xl` pillow, a user message as a rounded accent lozenge,
and a rounded code block.

- The speaker is now told apart by a **border** rather than a soft fill: the user's own words take the
  accent border, the assistant's take ink, a system notice takes the warning colour — and each keeps
  its own label, so nothing depends on colour alone.
- Inline code is a small bordered chip; the code block has a stated header (an ink rule with an
  uppercase monospace language) instead of a tinted strip with rounded buttons.

### Fixed — a source note that rendered as chat text

While fixing the above I introduced a JSX comment in the **children** position, where a bare
`/* … */` is not a comment but a text node — so the transcript printed my own note above every
message. No assertion caught it; reading the rendered page text did. A test now pins the case: the
bubble must render its message and **nothing else**.

The bubble also gained a `data-testid` per role, because the first version of that test used
`getByText` and matched the `<p>` markdown renders *inside* the bubble — an element with an empty
`className`, so the border assertions were reading the wrong node.

### Fixed — the one untranslated label in the shell

The sidebar's bottom nav had a **hard-coded** "Plugins" string (not even an i18n key), so it kept the
old section name after it became *Surfaces*.

**Suite green at 286 test files / 2414 tests; typecheck and production build clean.**


## [4.0.0] — 2026-10-16

### Changed — a brutalist design language, with the palette untouched

The report was "still cluttered, messy, over-saturated, confusing, and not beautiful". That is about
the layer **under** the colours, so the colours stayed: the warm light and dark ramps, the brand accent
`#6D43FF`, and the WCAG text-contrast contract are all unchanged and still green.

- **Soft clay → hard edges.** Radius 12/18/24px → **0** (2px for inputs and chips). Two blurred
  shadows pretending to be a light source → **one hard offset with zero blur** (`4px 4px 0`).
  Motion 120–320ms with a bezier curve → **60–90ms, linear** — a switch, not a bounce. Labels became
  uppercase tracked micro-labels, data became monospace with tabular figures, and keyboard focus
  became a 2px accent outline offset from the edge.
- **The biggest fix is invisible in a screenshot.** 180 borders used `--border: 228 225 220` on a
  `245 244 241` page — about **1.1:1**. The app was a field of boxes nobody could see, which is what
  "messy" looks like. The border colours were raised into a real hierarchy: 1px for separators and
  dense rows, 2px ink for containers, 2px ink plus the offset shadow for primary surfaces. This is the
  one deliberate palette adjustment — a border nobody can see is a missing edge, not a colour choice.
- **Restraint is enforced, not hoped for.** Brutalism applied everywhere *is* the over-saturation
  complaint, so two rules are pinned by tests: depth is for things you can touch (a static container
  gets a border and no shadow), and a heavy-bordered surface never also takes the accent fill — with
  the approval, plan and preflight dialogs keeping the border and **no** offset shadow, because a
  decision about a destructive command should not look playful. The blurred modal backdrop is gone.
- `clay-tokens.test.ts` is replaced by `brutal-tokens.test.ts`, which pins zero blur on every offset
  shadow, square geometry, per-theme shadow colours, instant linear motion, the surface vocabulary,
  the security-dialog rule, and that no component reaches for a clay class again.

### Fixed — a page of switches that gated nothing

`Settings → Plugins` rendered a switch for all seven catalogue entries and persisted them under
`plugins.enabled` — a key **nothing else in the codebase read**. Every switch reported a state change
that never happened.

- **Real switches** — *Browser*, *Terminal*, *Filesystem*: surfaces that exist and can honestly be
  hidden, owned by a new pure `lib/capabilities.ts` that defaults to **on** and is versioned under a
  new key so the dead map cannot resurrect a stale value. Hiding a surface now also removes the button
  that opens it.
- **No switch** — *DeepSeek* (a provider), *SSH/VPS* (a connection), *GitHub* (an integration), *Git*
  (an operation set). Each row states where it is configured, and **Configure** takes you to that exact
  tab (the store carries a requested tab now; every `configureTab` is asserted to name a real tab).
- The section and its nav entry are retitled *Surfaces*, matching the page's own tab strip.

**Suite green at 285 test files / 2408 tests; typecheck and production build clean.**


## [3.2.1] — 2026-10-16

### Fixed — dropping a file no longer opens it as a project

Two things were wrong, and the second was worse than the gap:

- There was **no paste or drag-drop attachment path** at all.
- The **only** drop handler in the tree treated every dropped item as a **project**, so dropping a
  screenshot onto the window opened a project named `screenshot.png` pointing at a file.

### Added — attach by dropping or pasting

- The composer intercepts its own drops (with `stopPropagation`, which is the line that stops the
  app-level handler from also opening a project), so **dropping onto the chat attaches** while
  dropping elsewhere keeps the existing behaviour. It also shows itself as a drop target while a file
  is held over it.
- **Paste attaches a real file** copied in a file manager, and leaves an ordinary **text** paste
  completely alone so typing behaves exactly as before.
- A bitmap from a screenshot tool carries image data with **no file behind it**, so there is no path
  for main to register. That case is reported rather than dropped silently; supporting it needs main
  to accept renderer-provided bytes, which is a separate, security-relevant change and is not
  pretended otherwise.
- The decision lives in a pure helper, because each direction of getting it wrong is a real bug:
  attaching when the user meant to paste text breaks typing, ignoring a real file loses their action.
  The picker, the drop and the paste all go through one path, and **main remains the only side that
  reads a file** — it stats it, refuses a credential-shaped path and returns an opaque id.

**Suite green at 284 test files / 2393 tests; typecheck and production build clean.**


## [3.2.0] — 2026-10-16

### Added — decision checkpoints

The app already derived, per step, what the agent intended, what evidence it had and what it chose.
What was missing is a judgement about **how much a decision matters**, and a mode that can stop
**before** the action rather than explain it afterwards.

- **Judged by reversibility, not by how alarming a command sounds.** Reading is `routine`; installing
  a package, restarting a service, deploying, or writing a file inside the project is
  `consequential` (it changes state and can be changed back); a recursive delete, a format, `dd`, a
  plain force-push, `git reset --hard`, a database drop, a write that leaves the project, or anything
  touching a credential is `irreversible`. That distinction is what keeps a prompt from becoming
  noise people click through — and `--force-with-lease` is deliberately *not* the destructive case.
- **Unknown is not harmless.** A tool nobody classified is treated as a change: if nothing can say
  what it does, it does not get to be routine.
- **Credentials and production hosts outrank the command**, so reading `.env` is irreversible even
  though reading is routine.
- **A durable, append-only log**, one JSONL per project: a decision record is history, and history
  that can be rewritten is worth less than none. A corrupt line is skipped rather than hiding the
  rest, and one project can never read another's.
- **Three modes, defaulting to off** — a log nothing reads and prompts nobody asked for are not
  features. `record` keeps the log; `confirm` also stops before anything that is not routine.
  Settings → Approval has the control.

Two rules that decide whether this is a safety feature or theatre, both pinned by tests:

- **A standing permission is not consent to the irreversible.** In `confirm` mode an irreversible
  action is put to the user **even inside a granted server window** — "stop asking me about this
  server" is not "you may destroy it without telling me" — while an ordinary command in that same
  window is not re-asked.
- **A trusted plan is consent to the plan, not to the irreversible.** A trusted plan auto-approves its
  own steps before the approval gate is consulted, so an irreversible action is now sent through the
  gate anyway instead of being silently skipped for exactly the runs that mutate the most.

The **record is written before anything can skip the decision**, so a review sees what the app did on
its own and not only the times it asked.

**Suite green at 283 test files / 2384 tests; typecheck and production build clean.**


## [3.1.1] — 2026-10-16

### Fixed — a rate limit no longer kills the run

Two defects, found while implementing key rotation rather than reported by a user. Both turned a
recoverable condition into a failed run:

- **A 429 never moved to another provider.** The recovery planner derived "switch provider" from
  `auth`/`config` only, so a rate-limited provider was retried on the same credential until the run
  died — with a configured fallback sitting right there.
- **`Retry-After` was parsed and then ignored.** The HTTP layer reads the header into the error and
  the recovery plan used its own 200ms→2s backoff anyway, so the app could retry *inside* the window
  the provider had asked it to wait out.

A rate limit now retries the same provider once, then switches; the provider's own `Retry-After` is
honoured instead of our guess; and a wait beyond 30 seconds becomes "move on to the fallback" rather
than something a run sits through.

### Added — several keys per provider, with a circuit breaker

- Keys are handed out **round-robin**; a rate-limited key is parked for **exactly as long as the
  provider asked** (including when that is shorter than our default), and a key that keeps failing is
  parked for longer each time, up to a cap. Success clears the history.
- **Settings → Providers** manages the pool: how many keys a provider holds, add one, remove one.
  Key states (ready / cooling, and until when) are shown; **the keys themselves are never returned to
  the interface or written to a log**, which a test asserts.
- **An upgrade keeps every key.** Settings files written before this release hold a single key and no
  pool: a test writes that old shape by hand and asserts it still resolves, keeps `hasApiKey` true,
  and accepts a second key without dropping the first.

### Fixed — a silent data-loss bug in this very change

The settings migration step rebuilds each provider from the fields it knows, and it did not know the
new key list. The first key survived (it is mirrored into the old field) and **every additional key
vanished on the next read** — configure a credential for rotation, lose it on restart, no error
anywhere. Caught by the upgrade test above, not by review. A test now restarts the app (a fresh store
reading the same file) and asserts both keys are still there.

**Suite green; typecheck and production build clean.**


## [3.1.0] — 2026-10-16

### Added — the app remembers your project

The verified gap: beyond `AGENTS.md`/`AI_CONTEXT.md` truncated to a character budget there was
**no cross-session memory at all** — no embedding, no vector store, no graph anywhere in `src/`.

It is now a **fact ledger**: statements with a validity window. A new observation *supersedes* an
older one instead of overwriting it, so "staging listens on 3001" is not deleted when it becomes
false — it becomes false *from a date*, and both "what is it now" and "what was it then" stay
answerable. The window closes at the same instant the next one opens, so the timeline has no gap
and no overlap.

- Facts are injected into the system prompt as **prior beliefs, with the date each was
  observed**, and framed so a current observation wins: a memory that quietly overrides what the
  agent can see would be worse than none.
- **The ledger is bounded** (1200 characters) so memory can never crowd out the task.
- **Learning is one bounded call** (at most five facts, the last 24 messages, character-capped)
  and can never break a session: a provider error, a junk reply or an empty chat returns
  *why*, not an exception.
- **An invented `supersedes` id cannot invalidate anything** — only ids the model was shown are
  honoured, so a hallucination cannot close somebody else's belief.
- **Settings → Memory** lists what the app believes, newest first, with superseded facts
  de-emphasised but **never hidden** (that history is the point), a per-fact delete, and
  "forget everything" behind a confirm.

### Added — a spend cap that stops a send

Usage and cost were already recorded and shown; what was missing is the part that acts. A daily
cap now warns at a threshold and **refuses the send at the cap, before the call** — checking
afterwards would report a cost already paid. A model with no published price is reported as
making the total a lower bound rather than counted as free. Settings → Usage configures it, the
status bar shows it (only when a cap exists), and a refusal names the number and the way out.

### Fixed

- A flaky sandbox test: it ran `sleep 5` against vitest's default 5s test timeout, so under the
  parallel suite it failed as "Test timed out in 5000ms" rather than as a regression.

**Suite: 276 test files / 2312 tests green; typecheck and production build clean.**


## [3.0.0] — 2026-10-16

### Changed — the whole interface: "Restrained Clay"

The user's verdict on the previous UI was blunt and fair: flat, no depth, no hierarchy, and
motion that was either instant or the browser's default. The restyle answers that without
trading away the density a developer tool needs.

- **A real token layer.** The app had **zero** radius and shadow variables and no motion
  tokens at all. It now has a three-step radius scale (12/18/24), per-theme dual shadows (a
  bright top-left highlight plus a dark bottom-right), a motion scale with a soft easing curve,
  a z-index scale, and icon sizes. Overlays stop guessing with arbitrary `z-[N]`.
- **The neutral ramp warms up.** Clay is a matte physical material; on the cool blue-grey the
  app used, soft shadows read as *concrete*. Both palettes are now warm, with every text token
  hand-recomputed so the existing WCAG contract still passes — verified, not assumed. **The
  brand accent is untouched** at `#6D43FF`, and a test pins that it cannot drift.
- **Depth is applied in tiers.** Full clay on the surfaces a user touches (composer, modals,
  primary buttons, project cards, the empty state); soft clay on cards; and **no clay at all**
  on tables, log/diff viewers, the status bar and every approval/security dialog, where
  seriousness and readability outrank charm. The `clay-press` signature — lift on hover, press
  in on active — is what makes a surface feel physical.
- **Motion honours `prefers-reduced-motion`** at the stylesheet level rather than relying on
  each component to remember.

### Added — the app can update itself

There was no update path whatsoever (`publish: null`, no feed reader, no UI): a user could sit
on an old build indefinitely. The updater is **dependency-free** on purpose — the packaged app
ships exactly one runtime dependency — and it verifies the downloaded installer against the
release's own `SHA256SUMS.txt` **before** running it. A mismatch deletes the file and aborts; a
release that publishes no checksum is offered as *unverified* rather than silently trusted.
Nothing is fetched or installed without a click. The feed is a dedicated **public** repository
holding only binaries and checksums, so the source repository stays private.

### Added — image previews on attachments

An attached image showed only its file name and size, so there was no way to confirm the right
picture had been picked. The preview is generated in **main** (Electron's `nativeImage`) and
crosses the bridge as a small data URL: the desktop path still never reaches the renderer.

### Added — a Sources / Outputs panel

The composer now opens a panel that states what a run may read and what it should produce:
attached files, added folders, a GitHub repository recorded as a source, the existing
"View all" context preview, and a declared output (file / site / folder) that is passed to the
agent as an explicit instruction rather than left implicit. Web search is shown but
deliberately **disabled**: it needs a new agent tool, a network policy and approvals, and
shipping a half-wired one would be worse than naming it as not-yet-available.

### Fixed — a diagnostics probe answered about the wrong server

A user asked for one server's health and got another's hostname and disk back, which reasonably
read as "these two records point at the same machine". They do not. The four named diagnostics
require a `server_id` while the executor deliberately ignores it (a probe must never reach
another host), so a mismatched id was accepted **silently** and the wrong machine's data was
returned as the answer. It is now refused with a message naming both hosts, and the schemas no
longer promise a choice the tools do not have.

### Changed — the repository is safe to publish

Eleven working documents and ~30 test files carried the user's real project and server names,
plus two live VPS IPs. They are replaced with reserved documentation values (RFC 5737 addresses
for the IPs). The git history still contains the old values, which is recorded rather than
silently rewritten: purging it would invalidate every existing tag and release.

**Suite: 267 test files / 2221+ tests green; typecheck and production build clean.**


## [2.9.2] — 2026-10-15

### Fixed — a disconnected remote project looked like a deleted folder

Both of the user's projects showed an amber dot and **"Path not found"** at startup.
Nothing was wrong: they are remote, and their VPS was not connected yet.

Main defines a remote project's `exists` as *"its VPS is connected"* (a remote path is not
on this disk), and the sidebar checked `exists` before its remote branch — so "not
connected" rendered as "missing", with a **Locate** button that opens a local folder picker
for a path that lives on a server. `store.ts` already excluded remote projects from its
missing-path count; the sidebar now applies the same rule. Remote projects report
connected/disconnected; local projects keep the missing-path warning.

**Suite: 264 files / 2177 tests green; typecheck and production build clean.**


## [2.9.1] — 2026-10-14

### Changed — the agent works in your project

- **A local run's workspace is now the project folder itself.** Every run used to get a
  fresh, empty directory under `<userData>/sandboxes/<uuid>`, so the agent could not read
  the project's own files, could not list it, and ran its commands in a temp folder rather
  than the repository — it could only ever see files it wrote itself during that run. For a
  local project whose folder exists, the sandbox is now rooted there: `read_file`,
  `list_dir` and `run_command` (tests, builds) operate in place. Remote projects, a missing
  folder and runs with no project are unchanged.
- **The project is never deleted.** A caller-supplied workspace is not owned by the sandbox,
  so the teardown that ends a run leaves your files alone. This is pinned end to end — the
  failure mode would have been the project being deleted after every run.
- **The change view is honest about what happened.** Writes land on disk immediately, so
  re-reading the file for a "before" would have produced an empty diff; the before/after now
  come from the write itself and the change is marked `applied`. The run summary still says
  "Edited N files +A −R", the pending-changes panel no longer lists it, and no Reject button
  is offered for something already written.
- **The system prompt no longer claims your files are unreachable.** It says the workspace is
  the project folder and that writes take effect immediately, while the rest of the computer
  stays off limits.

The trade-off, plainly: local edits are no longer gated by "review, then Apply" — the agent
writes to your real files. The deny list, remote path containment and the secret-path guard
are untouched, and `..` is still refused.

**Suite: 263 files / 2172 tests green; typecheck and production build clean.**


## [2.9.0] — 2026-10-14

### Fixed — the second round of reported problems

- **Approval prompts for provably read-only work.** Two causes. The four named diagnostics
  (`get_service_logs`, `get_disk_usage`, `get_system_health`, `get_process_list`) were
  missing from both read-only sets — while the app actively tells the model to prefer them
  over free-form shell — so `auto-write` raised a dialog with a **Write** badge for each;
  both sets are now derived from the canonical `READ_ONLY_TOOL_NAMES` so they cannot drift
  again. And the read-only shell classifier is textual and all-or-nothing, so the wrappers
  the agent actually used (`timeout … ssh …`, `for …; do … done`, `bash -c '…'`,
  `env VAR=x …`) made a chain of pure probes count as a write; wrappers are now unwrapped and
  their bodies **re-classified**, never trusted, so `timeout 12 rm -rf /srv` still prompts.
- **Raw tool names and raw commands as the primary label.** Cards read
  `remote_shell ok echo "== sandbox net test =="; timeout 8 bash -c '</dev/…`, the trace chip
  was a bare `remote_shell`, and the transcript said "Used remote shell". A verb headline now
  leads ("Ran a command on the server"), with a short, quote-aware, banner-skipping command
  preview; the verbatim command and the exact tool id moved into the expandable body —
  and `hasBody` gained `command`/`path`, without which a successful shell card was not
  expandable at all and the raw command would have been lost.
- **The agent demanded a server UUID it could have looked up.** Nothing enumerated the saved
  servers: the only id the model could see was the active project's own, every id-taking tool
  resolved by *exact id*, and the UI never displays one. A new read-only `list_servers` tool
  is offered on every remote path (even with no server pinned), and one wrapper canonicalises
  `server_id` / `source_vps_id` / `target_vps_id` from **id, name or host** before dispatch —
  covering all fifteen tools. An ambiguous or unknown reference fails *with the candidate
  list* rather than guessing, and the roster is discovery data only: it can never select the
  host a run targets.

### Added — uploads, and a way out of per-command approvals

- **File and image upload works.** `@<desktop path>` was inert text nothing parsed, main had
  no attachment concept, the agent could not have read an absolute path anyway (a local run's
  workspace is an empty temp directory and `read_file` refuses absolute paths), and there was
  no multimodal path at all. Attachments are now registered in main (secret-path guard and a
  size cap applied), copied into the run's workspace, and described to the model by their
  **workspace-relative** path; images additionally travel as real image parts to vision-capable
  models (OpenAI `image_url`, Anthropic base64 blocks, Google `inlineData`), with an explicit
  "this model cannot see images" instruction instead of a guess. A text-only request body is
  byte-identical to before. The system prompt no longer claims the host filesystem is
  unreachable — that sentence is what the assistant had been paraphrasing back to the user.
- **A scoped server grant.** "Approve every command on THIS server in THIS project for 30
  minutes", offered exactly where a permanent remember is refused (shell and writes), bound to
  one server + one project, expiring, revocable, stored apart from the permanent allow lists.
  It suppresses the *user approval* only: the deny list, host policy, path containment, secret
  guard, rate limiter and audit log all still run.
- **Connecting GitHub is one click.** `gh` was used nowhere in the repo, yet it is commonly
  already installed and authenticated and its scopes cover everything this app does; Settings →
  GitHub now detects that login and offers "Use my GitHub CLI login", which reads the token,
  validates it with `GET /user` and stores it exactly as the manual paths do. A wrong OAuth
  client id used to render an **empty** code box (GitHub answers 200 with an error body) — it
  now fails loudly — and the stored-token decryption error, which was returned but never
  rendered, is displayed instead of a false "connected".
- **The main page reads like a run.** A compact **"Edited N files +A −R"** card with a row per
  file now sits in the transcript (it used to be hidden inside the collapsible trace), the live
  status shows how long the turn has been working, the model's reasoning appears as a one-line
  excerpt under it, and the ongoing goal is visible in the chat instead of only in its panel.
- **The localhost remote-access server is explained.** It is a developer API (127.0.0.1 +
  bearer token, no client shipped), so it moved out of the status bar into Settings →
  Developer with what it is, why nothing ships with it, the URL, the token (masked until
  revealed), the client count and two copyable `curl` examples.

### Changed

- **`list_servers` is read-only** and deliberately absent from `VPS_REQUIRING_TOOLS`, so
  asking which servers exist never itself demands a server.

Test suite: **262 files / 2166 tests green**; typecheck and production build clean.


## [2.8.0] — 2026-10-14

### Fixed — the nine reported problems

- **The token/cost preview no longer gates every send.** The preference defaulted to
  "on" (`readShowContextBeforeSend()` compared `!== '0'`), so anyone who never opened
  Settings got a pre-send dialog forever. It is opt-in now (`=== '1'`); a context-limit
  warning still appears, because that one is real information rather than a toll.
- **Several VPS servers stay connected at once.** Two independent causes. The UI read a
  single global "slot" that each `vps:status` event overwrote, and the per-server map
  added in v2.6.5 was written but never read — so connecting B made A look disconnected
  while its socket was fine. Separately, the 30-minute idle reaper spared only hosts
  derived from remote projects, so a server connected by hand was genuinely closed.
  `vpsStateFor`/keep-alive now derive from the connected set at every call site.
- **Runs no longer wedge in a loop.** Four causes: an ordinary red-test/fix cycle counted
  as a failure streak (a step with any progress now resets it); the per-call block was
  keyed on the tool *name*, so two red commands blacklisted `run_command` for the rest of
  the run and the block could never clear (now keyed on the call and lifted by progress);
  `max_steps` ended a run with no reason and no message; and the Continue button was
  disabled for the most common stop reason.
- **Cross-server migration accepts a target that is not a saved server yet.** The rsync
  runs *on the source* with `BatchMode=yes`, so the destination never had to be saved
  here — requiring an id turned "migrate to 203.0.113.23" into a dead end. `target_host`
  (+ optional user/port) is now accepted, with host/user/port validation, and the
  sensitive-path, deny-list, dry-run, audit and `--delete` guards all still apply.
- **Switching projects no longer raises the chat-transfer dialog.** The default was
  `ask`; it is `new`, and the dialog only appears for someone who chose "ask every time".
- **Chat history is grouped under its project again, with a per-project new chat.**
  `groupChatsByProject` had been orphaned by the v2.3 sidebar redesign. Each project
  header carries a **+** that switches and starts a chat there directly.
- **An approval dialog can no longer outlive its decision.** `ApprovalBroker.resolve()`
  settled the promise without emitting anything — unlike the plan and preflight brokers —
  so a fail-closed timeout denied the action while the modal still offered a dead
  Approve button. `approval:resolved` now closes it, including on abort.

### Added — thinking, activity and mid-run questions

- **The assistant can ask a question mid-run and keep going.** There was no question
  primitive at all: the only way to ask was to end the turn, which *finished* the run, so
  the answer arrived as a new run with a fresh budget and no memory of the work. A new
  `ask_user` tool is handled by the orchestrator itself (never the sandbox), awaits the
  answer through `QuestionBroker` (which resolves "nobody answered" on timeout instead of
  cancelling), appends it as the tool's result and continues the same run. It is
  classified read-only, offered only when a gate exists, and also available in Plan Mode.
- **The model's own reasoning is shown instead of discarded.** The adapters read only
  `content`, so DeepSeek's `reasoning_content`, OpenAI-compatible `reasoning` and
  Anthropic `thinking` blocks were fetched and thrown away. They are now parsed
  (streaming and not), kept strictly out of `content` — a chain of thought must never be
  replayed as an assistant turn — recorded on the step, emitted on the log stream, and
  rendered as a collapsed "Thinking" row under the step that produced it.
- **The status area names the work in words.** `Running remote_shell…` became "a command
  on the server", and the live status now updates from the log stream, so "Thinking…"
  and "Starting …" appear before the first tool result instead of a generic spinner.
- **A durable "what changed" summary with per-file diffstats.** The trace says what the
  run did ("Ran 2 commands, read 3 files, edited 1 file") and lists each changed file
  with `+N`/`−M`; the record survives Apply/Reject, where the pending-changes panel
  drops the row and the answer to "what changed?" used to disappear.

### Changed

- **The localhost remote-access server is unchanged but now explained.** It is off by
  default and binds `127.0.0.1` with a bearer token; no client ships with the app, which
  is why its status-bar toggle was confusing. Recommended: keep the capability, move it
  out of the status bar into Settings → Advanced with the URL, token and examples.

### Fixed — tests

- **`goal-panel.test.tsx` is no longer flaky.** Two real races, not a tight timeout: a DOM
  assertion issued right after an I/O wait (the file lands before React commits), and a
  captured `<li>` asserted into after a re-render replaced it. Verified with 10
  consecutive parallel runs.

**Suite: 250 files / 2024 tests green; typecheck and production build clean.**


## [2.7.0] — 2026-10-14

### Added — UI & theme

- **Light ("day") theme as the default**, with the original dark palette and a
  `system` option that follows the OS. Chosen from a labelled menu in the titlebar
  or a labelled radio group in Settings — never an icon that silently cycles.
- **Semantic colour tokens.** Every colour is a CSS variable behind Tailwind, so one
  set of class names renders correctly in both themes; 82 files moved off theme-blind
  palette utilities (`text-neutral-500`, `bg-red-500/10`, ...), which are fixed hex
  values and therefore only ever right in one theme.
- A `theme-tokens` contract test that fails the build if a theme-blind utility
  reappears, and recomputes the WCAG contrast of both palettes (text ≥ 4.5:1 on every
  surface, status colours ≥ 4.5:1, accent label ≥ 4.5:1, accent fill ≥ 3:1).
- A `theme-controls` component test that drives the titlebar menu and asserts the
  preference is persisted and painted onto `<html>`.

### Security

- **The renderer sandbox is on.** `sandbox: false` ran the process that renders model output
  unsandboxed; the preload only needs `contextBridge`, `ipcRenderer` and `webUtils`.
- **The main window can no longer navigate away from the bundled renderer.** There was no
  `will-navigate`/`will-redirect` guard, so one click on a link in agent output replaced the
  app with a foreign page that still owned the `window.api` preload bridge. `shell.openExternal`
  is limited to http(s) too (the webview policy already was).
- **The local terminal passes the same guards as every remote command.** `shell:exec` had no
  deny list, no approval and no audit entry, so a compromised renderer had an unrestricted
  shell with `cwd` set to the project.
- **Remote path containment matches what executes.** `containPath` validated a path and then
  sent the raw request through SFTP, which resolves a relative path against `$HOME` — so
  `remote_write_file { path: '.bashrc' }` was checked as `<root>/.bashrc` and wrote
  `$HOME/.bashrc`. Project-scoped commands also run from the project root now (an ssh2 `exec`
  starts in the login directory), and a `..` segment is refused outright.
- **Tool classification fails closed.** Anything not on an explicit read allow-list is a write,
  so `db_migrate`, `migrate_project`, `scaffold_project`, `project_user_*` and `worktree_*`
  can no longer be auto-approved in `auto-write` mode or skip the plan gate.
- **The sudo gate is mandatory.** `sudo useradd` / `sudo userdel -r` ran with no approval when
  the optional hook was not wired.
- **Plan trust is bound to the approved step.** Auto-approval matched the action *id* only while
  `planHash` was never compared, so a later turn reusing an id was approved for a different
  tool or arguments.
- **The deny list covers power commands in command position** (`sudo reboot`,
  `systemctl poweroff`, `/sbin/reboot`), absolute-path shell pipelines, and `mount` no longer
  takes the always-allowed shortcut.
- **Redaction covers `sk-proj-*`/`sk-svcacct-*`, Google `AIza*`, Groq, HuggingFace and xAI
  keys**, and secret system paths are matched after resolving dot segments.
- **Loops, daemons and secrets:** the SSE reader cancels its body, the GitHub client has a
  timeout and reports rate limits, `FileService` refuses a junction that leaves the project,
  the Docker image reference cannot become a flag, and the CSP gains `object-src`/`base-uri`/
  `frame-ancestors`/`form-action`.

### Fixed

- **The temp-file cleanup from the audit fix never actually ran.** The writer stopped
  leaking (verified: zero new temp files on a day of launches), but the sweep that was
  supposed to clear the existing ones was only reachable from the audit log's lazy
  `load()` — i.e. on the first SSH command — and nine of the ten stores never swept at
  all. A user who never connects to a server kept the residue forever; on a real install
  that was **822 files / 361.8 MB**, still present a day after the fix shipped. The app
  now sweeps its data directory once at startup. It is deliberately non-recursive, so a
  project file named `*.tmp` inside `sandboxes/` is never touched, and files newer than
  five minutes are left alone in case a write is in flight.
- **The status bar claimed "Agent: running" next to "worker: idle".** With no worker report
  it defaulted to online — an unfounded claim — and with a live worker the two labels still
  read as a contradiction. Unknown now shows as `Agent: —`, and a live agent service reads
  `Agent: ready` while the worker's own state says whether anything is actually running.
- **The theme option labels were raw i18n keys** (`settings.themelight`) instead of
  "Light" / "Dark" / "System" — caught by the new `theme-controls` test.
- **Contrast:** light `fg-subtle` metadata was 3.25:1 and the dark accent was 4.24:1 on
  `bg-secondary`; the palettes and the accent fill token were retuned to clear 4.5:1.
- **The Windows local sandbox could not run a single agent command.** It used `cmd.exe`, which
  knows none of the POSIX tools the agent writes, so every command "succeeded" with empty
  output. It now prefers Git for Windows' `bash.exe` and reports the `cmd` dialect when there
  is no POSIX shell. This is why 17 tests failed on Windows and passed on Linux.
- **The audit log silently stopped being written** while leaving 822 temp files (361.8 MB in
  four days) on disk; every atomic write now uses a unique temp name, retries the Windows
  sharing violation, always unlinks the temp, serialises concurrent saves, and sweeps existing
  leftovers. A failed audit write is reported instead of swallowed.
- **`goal-store` destroyed every stored goal** after any read error, because the failure was
  reported as "no goals" and then written straight back.
- **Run freshness is measured from the last patch activity**, not the run start, so a run
  longer than 30 minutes no longer has all of its patches pre-expired.
- **Success claims require a real verification command.** `run_command("test -d x")` and
  `echo test-ok` no longer unlock "done".
- **LLM streaming keeps its timeout and abort wiring for the whole body**, so a stalled
  provider cannot hang a run and Stop actually cancels a stream.
- **SSH:** concurrent connects are coalesced (they leaked a connection), re-opening a terminal
  closes the previous shell, a per-server state no longer overwrites another host's status, and
  an open project's host stays connected instead of being reaped and reconnected every ~30 min.
- **Agent loop:** a `..`-free command, an unpaired tool result after a preflight note, a
  lifetime (not windowed) repeat counter, a planner alternative that dropped a planned step, an
  audit chain that could never verify again after one torn line, pinned context hints that
  defeated the character budget, an unquoted project root in crash probes, and a byte cap that
  split surrogate pairs.
- **`normalizeProjectPath` keeps POSIX paths POSIX**, and the sandbox resolves against the path
  dialect of its root, so `/tmp/x` is no longer rewritten as `C:\tmp\x` on Windows.

### Added — audit fixes

- CI (`.github/workflows/ci.yml`) running `typecheck`, `test` and `build` on **both**
  ubuntu-latest and windows-latest; the repository had no CI at all.
- `LICENSE` (MIT) — `package.json` claimed MIT with no licence file in the tree.
- Tests for the real SSH transport (`ssh2-backend.ts`, previously only the fake was exercised),
  plus coverage for the Windows shell, atomic writes, containment, plan binding, redaction and
  the renderer defects fixed in this release.

### Changed

- The unversioned `KNOWN_ISSUES.md`, `TESTING_GUIDE.md` and `FINAL_REPORT.md` are v1.0.0
  artifacts and now say so at the top; the README status line is current.
- `dependencies` holds exactly one entry (`ssh2`); the renderer libraries moved to
  `devDependencies`, matching the documented packaging invariant.

## [2.6.4] — 2026-10-13

Release v2.6.4 "Multi-Project & Polish" fixes a resumed-conversation crash, keeps
every remote project connected at once, lets an open chat move between projects,
and trims the UI's type scale.

### Critical Fixes

- **Tool-call pairing (HTTP 400).** Assistant/tool message pairs are sanitized at
  the provider boundary and every tool call the step never ran is answered, so a
  resumed or aborted conversation is no longer rejected by DeepSeek/OpenAI with
  HTTP 400.
- **Per-server VPS connection state.** The connected-server set is exposed over
  IPC and each project derives its indicator from it, so a status change on one
  host no longer reports another project as "Not connected".

### Multi-Project

- **Every remote project stays connected.** The SSH manager holds one connection
  per server, and a startup keepalive brings up every remote project's host
  without moving the chat-header selection — switching projects is instant and
  never interrupts a running one; switching never disconnects.
- **Shell isolation.** A terminal panel closing or unmounting closes only its own
  shell session; the SSH connection other projects rely on stays up, and a stale
  session id never closes the wrong shell.
- **Chat transfer on project switch.** Switching projects no longer silently
  orphans the open chat: link it into the new project and keep the context, move
  it and start fresh, or leave it and start a new chat. The choice can be
  remembered in Settings; an empty session switches silently.

### UI Polish

- **Opt-in context warning.** The composer's near-limit "context is filling up"
  nudge is off by default and enabled per user; it only matters for older models
  with a small context window.
- **Shared type scale.** One set of size tokens (`text-2xs`/`3xs`/`4xs`) replaces
  the one-off pixel font sizes across the dense UI chrome, with no layout change.

## [2.6.3] — 2026-10-13

Release v2.6.3 "Trace & Conformance" makes the agent's reasoning visible inline
in the chat, adds an auditable preflight override, and refines the chat layout to
a single centered column.

### Inline Trace

- **Decision cards in the conversation.** Agent steps render inline as
  `DecisionCard`s, with the running trace grouped by step and a live, phase-aware
  status line.
- **Tool-aware status.** The live "thinking" line names the action in progress
  (reading a file, searching, writing, running a command) instead of a generic
  spinner.
- **Conformance.** `InlineTrace` shows the newest three decisions and expands to
  thirty; raw tool rows are hidden once they are grouped into the trace.

### Preflight Override

- An interactive preflight override flows from the orchestrator to the renderer:
  a broker resolves decisions, the orchestrator applies them with cleanup, and
  each override is written to the tamper-evident audit chain.
- Tiered preflight results are surfaced in the chat so the user can review and
  override before a run proceeds.

### Chat Layout

- **One centered column.** Messages and the composer share an 820px measure with a
  `px-4` gutter; the run timeline is embedded in the column when toggled instead
  of docking as a fixed side panel, and a STATUS card shows the current phase and
  last decision at all times.
- **Responsive sidebar.** A persisted *pin* keeps the sidebar expanded down to the
  minimum chat width, while the Ctrl+B collapse always wins; squeezing side
  columns are overlaid to keep the chat readable.
- **Dismissable tree overlay.** The file tree floats over the chat with a backdrop
  and a close control whenever it cannot dock.
- **Compact tool cards.** A 13px header over 10px meta chips, one-line success
  cards, and error cards that auto-expand so the failure is visible without a click.

## [2.6.2] — 2026-10-05

Release v2.6.2 "Collaborative Design" adds session profiles, the Secret Path
Guard, Explore Mode, project goals, a tamper-evident execution trace, and a
round of UI polish.

### Session Profile (P0-5)

- **Elevation grants live in main.** The `full` approval grant, its environment
  TTL (development 60m / staging 30m / production 15m) and its (project, VPS,
  environment) scope are owned by `SessionProfileService`. A renderer reload can
  no longer silently restore `full`; a persisted `full` without a matching grant
  clamps to at most `auto-write` (harder on production). `AgentService` reads the
  effective mode from the profile, never from the renderer.

### Secret Path Guard

- Canonical guard blocks credential files (`.env`, keys, tokens) across the local
  and remote file/shell tools; `.env.example`-style templates stay allowed.

### Explore Mode

- Investigate exposes a read-only tool set, plan-only runs as the zero-tool
  sub-flag, and named diagnostics; Deploy is environment-aware and never reaches
  `full` on production.

### Goal / Plan / Run

- Per-project Goal schema + store, runs attach to the active goal, plan trust is
  scoped by project, branch and environment, and goals are managed from the UI.

### Execution Trace

- Agent steps derive auditable decisions; the Progress timeline and DecisionCard
  explain them on demand, and Settings → Advanced → Audit writes a per-project
  hash-chained JSONL with on-demand verification.

### UI Polish

- **Composer:** the always-on token counter is replaced by a near-limit context
  warning with a one-click Compact action; token accounting moved to Settings → Usage.
- **Jobs:** the background jobs panel is collapsed by default behind a sidebar
  badge, with completion toasts and a "show always" preference.
- **Shortcuts:** Ctrl+K now opens the command palette alone (chat search moved to
  Ctrl+Shift+K), Ctrl+= / Ctrl+- / Ctrl+0 zoom (persisted), Shift+Esc is an
  emergency stop, and `?` opens a shortcut cheat sheet.
- **Persian rendering:** Vazirmatn leads the font stack in Farsi, chat markdown is
  bidi-isolated, and Latin-only controls stay LTR inside RTL chrome.
- **Modals:** Git setup, migration, onboarding and code search are now
  viewport-capped so their content scrolls and actions stay reachable.

## [2.6.1] — 2026-10-05

Release v2.6.1 bundles the v2.6.0 "UI/UX Major Overhaul" with the v2.6.1
"Memory Persistence" fixes.

### Memory Fix (v2.6.1)

- **Stable session id across chat messages** — every message in a chat now
  reuses one session id, so the conversation is a single persisted transcript
  instead of a new run per message.
- **Full chat history sent to the LLM** — a follow-up message resumes the stored
  session (`resumeSessionId`), so the model sees the earlier turns.
- **Plan trust persisted per session** — a trusted plan is scoped to its chat and
  stored with the session, so it survives a restart and rehydrates.
- **Plan/Approval decisions in protected history** — approved, modified and denied
  decisions are pinned as durable system notes that context compaction cannot drop.
- **Memory visibility in Sources tab** — the workspace now shows what the chat
  remembers (turns, messages, summary, trusted plan) with a confirmed Clear option.

### UI/UX Overhaul (v2.6.0)

- Three-column layout (Projects | Chat | Output/Sources).
- Execution contract bar in the chat header.
- Compact tool cards (success collapsed, error expanded).
- Sticky modal dialogs (buttons always visible).
- Connection status with icon + text + latency.
- Danger token highlighting in approvals.
- File accordion for diffs.
- Loop stop card with clear recovery options.

### Tests

- 1322 tests pass / 1 skipped.
- 60+ new tests since v2.5.8.

## [2.5.8] — 2026-10-05

Sprint v2.5.8 "Read-Only Detection Fix" — a read-only shell chain that opened
with an environment assignment (`B=/path; …`) no longer asks for approval, and
the approval dialog is centred in the window.

### Fixed

- **Pure environment assignments are read-only** — `isReadOnlyShellCommand`
  stripped leading `VAR=value` tokens and then treated the empty remainder as a
  write, so `B=/opt/app; echo …; find "$B" …; cat "$B" …` asked for approval and
  looped. An all-assignment segment is now a read
  (`src/core/remote/command-whitelist.ts`).
- **`..` guard covers assignment values** — `=` is now a boundary in the
  parent-directory check, so `B=../secret` cannot escape the project root via a
  now-read-only assignment.
- **Approval dialog centred in the viewport** — it used `absolute inset-0`
  (anchored to the chat panel); it is now `fixed inset-0 z-50` with
  `max-h-[90vh] overflow-y-auto`, matching the other modals
  (`src/renderer/src/components/ApprovalDialog.tsx`).

## [2.5.7] — 2026-10-05

Sprint v2.5.7 "Task Planning + Loop Recovery" — a complex goal is now split into
an explicit, tracked plan instead of one long prompt, and a stuck agent is
redirected to a concrete alternative rather than stopping outright.

### Added

- **Multi-step task planner** — `TaskPlanner` turns a complex goal into ordered
  steps (`createPlan`), executes them one by one (`executePlan`), retries a
  failed step once, and records a failure reason when it gives up
  (`src/core/agent/task-planner.ts`, `src/shared/task-plan.ts`).
- **Task tracker panel in chat** — the live plan is rendered above the transcript
  with per-step status, a progress bar, and pause/resume/stop controls; plans are
  kept per run in the store (`src/renderer/src/components/TaskTracker.tsx`,
  `src/renderer/src/store.ts`).
- **Alternative strategies** — known failures (`pm2: command not found`, blocked
  paths, common `not found` errors, ...) map to a concrete alternative call
  (`src/core/agent/strategies.ts`).

### Changed

- **System prompt plans before acting** — remote runs are told to decompose a
  complex goal into steps and to prefer an alternative from the strategy table
  instead of repeating a failing call (`src/core/agent-orchestrator.ts`).
- **Loop guard redirects instead of stopping** — a blocked path/command or a
  repeatedly-failing tool now returns a `redirect` decision carrying an
  alternative; the run continues, and only a verbatim repeat of the redirected
  call is a hard stop (`src/core/agent/loop-detector.ts`). A redirect step no
  longer counts toward the failure-streak stop, and it lifts the tool block for
  the single alternative attempt.

### Notes

- The redirect is executed by the orchestrator as a tool observation
  (`code: 'redirect'`); the blocked call itself is never run.

## [2.5.6] — 2026-10-05

Sprint v2.5.6 "Crash Diagnosis + Read-Only Shell Relaxation" — the agent can now
diagnose a crash with a fixed, read-only probe set instead of guessing shell
one-liners, and read-only compound commands no longer trigger an approval prompt.

### Added

- **`diagnose_crash` tool** — a fixed, read-only probe set (process managers,
  logs, resources, network) run against the connected VPS. Evidence is reduced to
  a probable cause (`pm2_process_error` / `out_of_memory` / `disk_full` /
  `systemd_service_failed` / `unknown`) with a confidence level and concrete
  recommendations (`src/core/agent/crash-diagnosis.ts`,
  `src/core/tools/crash-diagnosis-tool.ts`).
- **Crash diagnosis prompt guidance** — remote runs expose `diagnose_crash` and
  the system prompt teaches the evidence-then-diagnosis workflow
  (`buildRemoteGuidance(..., crashDiagnosis)` / `buildSystemPrompt`).

### Changed

- **Read-only compound shell commands are allowed without approval** — `;`,
  `&&`, `||` and pipelines are accepted when every segment is read-only, with
  guards: `cd` to an absolute path only, any `..` refused, `curl`/`wget` with an
  output flag treated as a write, mutating `git` subcommands refused,
  `find -exec`/`-delete` refused, `sudo`/`sed -i` treated as writes
  (`src/core/remote/command-whitelist.ts`, `src/core/remote/path-guard.ts`).
- `diagnose_crash` is a read-only remote tool, so it never prompts for approval.

### Notes

- P0-2 path containment is unchanged; probes that touch a system path
  (`/var/log`) are skipped unless Diagnostic Mode is on.
- 30 new tests (`test/core/read-only-shell.test.ts`,
  `test/core/crash-diagnosis.test.ts`, `test/core/crash-diagnosis-prompt.test.ts`).

## [2.5.5] — 2026-10-05

Sprint v2.5.5 "Approval UX" — fewer, clearer approval prompts.

### Added

- **Trust this plan for 30 minutes** — approving a plan can store an
  `ApprovedPlan` so its own steps auto-approve for 30 minutes; a deny-listed
  command is never auto-approved (`src/core/agent/approved-plan.ts`).
- A `reason` (`outside_plan` / `write` / `dangerous` / …) is attached to prompts
  and shown in the approval dialog.

### Changed

- **Whitelisted read-only commands skip approval** — a conservative classifier
  admits a single read-only command or an all-read-only pipeline
  (`command-whitelist.ts`).
- The approval dialog now explains reason, tool, server, working dir and
  category, with clearer safety copy and a no-undo warning.

## [2.5.4] — 2026-10-05

Sprint v2.5.4 "Usage Settings + Context Preview Toggle".

### Added

- **Settings → Usage** — token accounting (input/output tokens, estimated cost)
  aggregated per run, per provider and per model, with a 7-day chart, reset and
  CSV export (`src/renderer/src/lib/usage.ts`, `SettingsUsage.tsx`).
- **Context preview toggle** (extracted `decideSend` gate in
  `src/renderer/src/lib/context-gate.ts`).

### Changed

- The lightweight live composer token counter is kept.
- The **Agent** status indicator is driven by `worker.online`.

## [2.5.2] — 2026-10-05

Sprint v2.5.2 "Rich Tool Details & Transparent Chat UI" — the chat is no longer
blind. When the agent runs a command on a VPS or local project, the transcript
now shows the exact command, the target host, stdout/stderr, the exit code, the
agent phase, and the recovery decision after a failure. Scope: Phases 1–5 only;
Phase 6 (remote diff) and Phase 7 (crash diagnosis) are deferred to the next
milestone. No security-sensitive changes — the v2.5-P0 hardening is untouched.

### Added

- **Structured tool detail** — `AgentToolResult` and `RemoteShellResult` now
  carry `command / serverId / cwd / path / stdout / stderr / exitCode` plus a
  `recovery` field, populated by the local sandbox, remote-shell and remote-fs
  executors. What the model sees (`content`/`output`) is unchanged.
- **Transparent `tool:result` event** — `src/core/agent/tool-detail.ts` redacts
  every string via `redact()` and caps output (stdout 10KB, stderr 2KB, 50
  lines) before the orchestrator streams a `tool:result` event and enriches the
  existing `action.ok/error` log with the same structured fields.
- **`ToolResultCard` in Chat** — command preview, exit-code badge and duration,
  expanding to stdout / stderr / target server / cwd / cause / recovery. The
  store builds inline `role:'tool'` messages from `tool:result` only; logs feed
  the timeline/diagnostics, never the chat.
- **Phase + recovery in the timeline** — `buildTimeline` carries the agent
  `phase` on steps and adds a `recovery` step kind for `recovery.*` logs
  (retry / switch / stop, attempts, from→to), shown as a muted second line in
  `ProgressTimeline`.
- **Context-aware LoopStop card** — `buildLoopStopModel` gives a per-reason
  hint, extracts the stuck command and VPS host from `recentActions`,
  highlights the recommended action, and disables **Continue** after a
  `failure_streak`.

### Tests

- 28 new tests (`test/core/tool-details.test.ts`, `test/core/tool-detail.test.ts`,
  `test/renderer/tool-detail-ui.test.tsx`, `test/renderer/timeline.test.ts`,
  `test/renderer/loop-stop.test.tsx`), 1044 total (1 skipped). Typecheck and
  production build pass.

### Notes

- `ToolCallView` is a superset of the legacy `{name, ok, detail}` tool-call
  shape, so stored/older messages still render.
- New devDependencies only: `@testing-library/react` and `jsdom` (no new
  runtime dependencies).
- Deferred to the next milestone: remote diff (Phase 6) and crash diagnosis
  (Phase 7).

## [2.4.2] — 2026-10-05

Sprint v2.4.2 "Loop Detector Fix" — removes two false-positive sources that
stopped a run while it was doing legitimate work. No behaviour changes beyond
the loop guard.

### Fixed

- **Loop detection is now args-aware** — the per-tool-call guard counted
  repeats by tool *name*, so a legitimate script such as `remote_shell(pwd)` →
  `remote_shell(ls)` → `remote_shell(cat)` tripped the 5-repeat STOP. The guard
  now keys on the normalised call identity (`computeLoopHash`): the command for
  shell tools, the path for filesystem tools, and the stable-serialised
  arguments otherwise. Identical repeats still warn on the 3rd and stop on the
  5th call.
- **A successful shell command counts as progress** — a successful
  `run_command` / `remote_shell` now resets the loop window, so a long run of
  distinct-but-successful shell commands no longer stops early. The step-level
  analyzer still surfaces genuinely repeated commands, so the two layers together
  cover both endless exploration and identical-command loops.

### Tests

- 9 new tests (`test/core/loop-detector.test.ts` cases 9–13 plus a rewritten
  case 8, and `test/agent/orchestrator.test.ts` shell-progress cases), 947 total.

## [2.4.1] — 2026-10-05

Sprint v2.4.1 "Wiring" — the v2.4 modules are now real agent tools, toggleable
from Settings and surfaced in the chat. Scope: wiring + simple UI + tests only
(single-user; no enterprise/multi-user/RBAC).

### Added

- **Agent tool wiring (A.1–A.4)** — `src/main/v24-tools-wiring.ts` registers
  `migrate_database`, `migrate_docker`, `scaffold_project`, `project_user_create`,
  `project_user_remove`, `worktree_create`, `worktree_list` and `worktree_remove`
  as agent tools, each with a system-prompt hint. db/docker tools are only exposed
  when a cross-host transfer is resolvable.
- **Settings → Tools (B.1)** — a toggle per tool group, stored in `localStorage`;
  `AgentRunRequest.enabledTools` carries the selection so a disabled group is never
  exposed to the model. The canonical group list lives in `src/shared/tool-toggles.ts`.
- **Chat tool result card (B.2)** — `ToolResultCard` renders each tool call inline
  (name, ok/error, expandable detail) instead of a bare pill.
- **Tests** — 24 new tests (`*wire`, `settings-tools`, `tool-result-card`,
  `v2.4.1-wiring.e2e`, `v2.4.1-smoke.e2e`), 939 total.

## [2.4.0] — 2026-10-05

Sprint v2.4 "Full Compliance" — long-running jobs, preflight/success verification,
database and Docker migration, per-project Linux users and SSH keys, git worktrees
and project scaffolding. See `SPRINT_v2.4.md` for the full task list.

## [2.3.3] — 2026-10-05

Sprint v2.3.3 "Git-Aware Agent + Self-Diagnosis" — the agent now knows whether a
remote project is a git repository, adapts its system prompt and workflow to that,
recovers from a tool that keeps failing, and can diagnose a host's environment and
install missing tooling behind an explicit approval.

### Added

- **Automatic git detection (A.1)** — a cheap `test -d .git` probe plus branch /
  remote / dirty lookups, run over the injected remote `exec`. Detection is cached
  for 30s per `server:path`. New IPC `vps:workspaceInfo` and shared
  `RemoteWorkspaceInfo`; the chat header shows a branch badge (or "No git").
- **Dynamic, git-aware system prompt (A.2)** — `buildWorkspaceSystemHint` tells the
  model to use `git status/diff/commit` on a repo and plain file tools otherwise.
- **Smarter loop detector (A.3)** — a tool that fails twice in a session is taken out
  of rotation (`action: 'block'`) and the model is told to try an alternative, instead
  of aborting the whole run.
- **Auto git setup (B.1)** — `buildGitSetupCommands` produces an ordered, previewable
  plan (`git init`, `.gitignore` from node/python/generic templates, initial commit,
  optional remote + push). Offered when a newly added remote project is not a repo.
- **Git status panel (B.2)** — `parseRemoteGitStatus`/`formatGitStatusLabel` power a
  sidebar pill (`branch · N changes · ↑a ↓b`) refreshed every 30s.
- **Environment health check (C.1)** — probes node/npm/git/docker/pm2, disk and
  memory, and derives recommendations for anything missing or a near-full disk.
- **Diagnostics panel (C.2)** — per-tool report, disk/RAM gauges and the open
  recommendations, opened from the VPS view.
- **Installation assistant (C.3)** — declarative docker/pm2/git/node recipes with a
  reviewable command preview and a mandatory, sudo-aware second confirmation.
- **Tests** — 62 tests across the v2.3.3 suites (`workspace-detect`,
  `workspace-prompt`, `loop-detector`, `git-setup`, `git-status`, `system-health`,
  `install-recipes` and the `v2.3.3-git-aware` e2e integration + security suite).

### Security

- Installs require explicit approval; sudo recipes require a separate root
  confirmation (`assertInstallAllowed`). Nothing auto-executes.
- Remote command runners abort at the first failing command and surface the exact
  error (e.g. a git push with an invalid token), never continuing blindly.

## [2.3.2] — 2026-10-05

Sprint v2.3.2 "Remote-First Architecture & Security Alignment" — a remote-first
agent that routes every tool to the VPS a project lives on, gates mutations behind
an explicit plan, and hardens the host policy against traversal.

### Added

- **Remote-first file routing (A.1)** — when the active project is `remote`, local
  file/shell tools are rewritten to their `remote_*` equivalents (relative paths are
  rebased onto the remote project root and the server id is attached) before they
  reach an executor. A remote project with no usable VPS yields a clear error instead
  of silently touching the local machine.
- **Context-aware host policy (A.3)** — a `HostPolicy` can carry `readOnlyCommands`
  and `writeCommands`. Reads never need approval, writes are gated on `staging` and
  blocked on `production`, and anything unrecognised stays fail-closed.
- **Per-command timeouts (A.4)** — ordinary commands get 60s, builds/tests 5 minutes
  and rsync/db dumps 30 minutes. A hung command is killed when its budget elapses
  instead of freezing the app.
- **Plan Mode (A.5)** — a batch containing mutating tool calls is offered as a short
  plan that must be approved, modified or cancelled before anything runs. Full access
  and read-only batches are exempt.
- **Backups before remote writes (B.1)** — an existing file is copied to
  `<path>.backup-<timestamp>` before it is overwritten, with a restore command, so a
  bad agent write can always be undone.
- **Post-deploy health checks (B.2)** — declarative process/port/HTTP/custom checks
  run after a deploy and report the first failure.
- **rsync dry-run preview (B.3)** — `migrate_project` always runs a `--dry-run` first
  and shows files/bytes/deletes before the real transfer (never `--delete`).
- **Context preview before send (B.4)** — a pre-send modal lists provider/model,
  estimated tokens, included sections and always-withheld secret-looking files.
- **`~/.ssh/config` import (B.5)** — import saved hosts (HostName/User/Port/IdentityFile
  path only; key material is never read).
- **Per-project metadata (C.1)** — projects carry environment, audit log path,
  repository, docker-compose project, ports, domains, linux user, SSH key reference,
  a policy override and a health-check config, edited from an expandable project card.
- **Project isolation UI (C.2)** — sidebar rows show an environment dot
  (🟢/🟡/🔴), a local/remote type badge, the VPS name or "local", the environment label
  and a policy-mismatch warning; the approval dialog shows an amber "outside the
  project policy" banner with **Proceed anyway** / **Cancel** before approving.

### Security

- **Path-traversal fix in `allowedPaths`.** `evaluateHostPolicy` now lexical-normalises
  `.`/`..` before containment, so `/srv/app/../../etc/passwd` no longer passes a
  `/srv/app` allow rule; a path that climbs above the root fails closed. Local
  resolution (`normalizeSandboxPath`, `FileService.resolveSafe`) already rejected `..`.
- **Policy Warning = blocked OR unknown.** A command is flagged before approval only
  when the policy blocks it or does not recognise it; known writes go through normal
  approval instead of the warning.
- Deny-list matching normalises whitespace, so padded/tabbed `rm  -rf  /` variants are
  still blocked; backgrounded commands cannot escape the per-command timeout.

### Fixed

- Sidebar project rows keep the connection dot while adding environment/type/scope
  badges, and no longer truncate the project name behind the VPS label.

### Tests

- New: `test/e2e/v2.3.2-security.e2e.test.ts` (7 integration scenarios),
  `test/security/v2.3.2.test.ts` (5 security scenarios),
  `test/renderer/sidebar-projects.test.tsx`,
  `test/renderer/chat-policy-warning.test.tsx`,
  `test/renderer/settings-projects.test.tsx`.

## [2.3.1] - 2026-10-05

Sprint v2.3.1 "Critical Fixes & Security Hardening" — a hardened agent loop,
strict local/remote separation, per-host command policy and secret redaction.

### Added

- **Per-host command policy (B.3)** — every VPS can carry a `HostPolicy`
  (`read-only` / `staging` / `production`, approval requirement, allow/deny lists
  and allowed paths). `SshManager.exec` evaluates it fail-closed (unknown commands
  count as writes) before SSH; blocked and approval-required commands are audited
  and surfaced in chat as `Blocked by policy:` / `Approval required by host policy:`.
  Edit it in **Settings → Connections → SSH → <server>**.
- **Secret redaction (B.1)** — new `core/agent/redact.ts` scrubs API keys, tokens,
  passwords and private-key material before anything reaches logs, the audit log or
  the UI.
- **DeepSeek V4 catalog + migration (A.3)** — current model list and a legacy
  migration path for stored model selections.
- **Workspace type (A.2)** — projects are explicitly `local` or `remote`; legacy
  POSIX paths saved on Windows are promoted to remote instead of failing with
  "Path not found".
- **Full Access global state (A.5)** — shared approval helpers keep the status bar
  and full-access toggle in sync across windows.

### Changed

- **Loop detection (A.1)** — fuzzy, per-tool-call sliding-window detection catches
  repeated actions even when arguments vary slightly, with warn-then-stop severity.
- **VPS connection state (A.4)** — a single centralized connection state with
  auto-reconnect and keepalive, reflected consistently in the sidebar, status bar
  and settings.

### Security

- **Mandatory host-key verification (B.2)** — first-use approval, pinned
  fingerprint persistence, and hard failure on mismatch/MITM, covered by tests.
- Policy evaluation is fail-closed: anything that cannot be proven a read is
  treated as a write on read-only/production hosts.

### Tests

- New: `test/security/redaction.test.ts`, `test/security/host-key.test.ts`,
  `test/security/policy-engine.test.ts`, `test/renderer/vps-state.test.ts`,
  `test/shared/approval.test.ts`, `test/e2e/v2.3.1-critical-fixes.e2e.test.ts`.

## [2.3.0] ‚Äî 2026-10-05

Sprint v2.3 ‚ÄúCodex-Like UX & Approval System‚Äù ‚Äî a Codex-style workspace, an approval system
that learns, and advanced chat capabilities.

### Added

- **Sidebar redesign** ‚Äî workspace switcher, projects-first list with connection status dots,
  per-project hover menu, flat Recents list (rename/duplicate/export/delete) and `Ctrl+K` search.
- **Composer redesign** ‚Äî inline model switcher with a capabilities tooltip, inline full-access
  toggle, auto-resize up to 200px, `Ctrl/Cmd+Enter` to send and active/grey send states.
- **File changes panel** ‚Äî per-file `+/-` stats with file-type icons, first-three preview,
  click-to-review split diff and Apply all / Reject all / Review individually.
- **Empty state & chat templates** ‚Äî project-aware greeting, four quick suggestions and a
  Templates menu with six built-ins plus user-saved templates.
- **Code block runner** ‚Äî fenced `bash`/`python`/`js` blocks get Copy and Run buttons; output
  and exit code render under the block (ask-mode confirms first).
- **Session fork** ‚Äî ‚ÄúFork from here‚Äù on any message creates a linked chat from that point.
- **Voice input** ‚Äî Web Speech API mic button in the composer (locale-aware, hidden if
  unsupported).
- **Multi-window** ‚Äî `Ctrl+Shift+N` opens a new window; window IPC is sender-scoped and
  settings changes broadcast to every window.
- **Progress timeline** ‚Äî collapsible vertical timeline beside the chat with animated
  active/pending steps projected from the agent log.
- **Codex-style Settings** ‚Äî grouped two-column nav (General / Integrations / Coding /
  Advanced) with Providers, API Keys, Plugins (tabs + search + directory), Browser website
  permissions (default ‚ÄúAlways ask‚Äù), Code Review per-repo auto-review, Connections
  (Control this PC / other devices / SSH), Approval Mode, Memory, Usage and Developer pages.
- **Cross-VPS project migration** — new `migrate_project` agent tool copies a project
  directory from one saved VPS to another with **rsync over SSH**
  (`source_vps_id`, `source_path`, `target_vps_id`, `target_path`).
  - **Security:** `ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new`, every argument
    `shellQuote`d, `checkDenyList` on the built command, sensitive-path and metacharacter
    rejection, and an SSH **audit log** entry per migration.
  - **Non-destructive:** no `--delete` by default, so the destination is only added to/updated.
  - Runs on the **source** host (compression + efficiency); requires source→target SSH key
    auth. Returns the rsync exit code so the agent can handle failures (e.g. `127` when rsync
    is not installed on the source).

### Notes

- Existing v2.2 features (session restore, codebase search, terminal, diff review, approval
  modes, remote SFTP tools, project memory) remain unchanged.

## [2.2.0] ‚Äî 2026-10-05

Codex-like feature pass: session restore and autosave, codebase search (`Ctrl+Shift+F`), file
tree toggle and integrated terminal, inline diff review for agent file writes, approval modes
with a plan/code switch, remote SFTP file tools for connected VPS servers, project
`AI_CONTEXT.md`/`AGENTS.md` injection with context-budget warnings, chats organized by
project, and composer slash commands.

## [2.1.0] ‚Äî 2026-10-05

UX overhaul, bilingual UI and critical bug fixes.

### Added

- **Internationalization** ‚Äî English/Persian locales with an instant RTL/LTR switch, persisted
  preference and a Settings language dropdown (i18next + react-i18next).
- **Chat history** ‚Äî file-per-chat storage with a grouped sidebar (Today / Yesterday /
  This Week / Older), search, and per-chat rename, export (JSON) and delete.
- **Command palette** (`Ctrl+K` / `Ctrl+P`) and a collapsible sidebar (`Ctrl+B`).
- **Workspace switcher** in the title bar, plus custom frameless window controls.
- **VPS selector** in the chat header so a run can target an explicit connected server, with a
  "used remote shell" badge on the answer.
- **Chat composer upgrades** ‚Äî file attachments (`@path`), live token/character estimate,
  auto-growing textarea and a scroll-to-bottom button.
- **Two-column Settings** ‚Äî General / Providers / Projects / GitHub / VPS / Advanced.
- **Toast notifications** and an onboarding VPS step.

### Fixed

- Missing project folders are now flagged (`PATH_NOT_FOUND` + `exists`) and can be re-located
  from the sidebar or Settings instead of failing silently.
- `remote_shell` is injected into the main chat runtime when a VPS is connected.
- Project paths now accept Windows drive letters when validated on POSIX hosts.
- Window maximize/restore state is reported to the renderer.

## [2.0.0] ‚Äî 2026-10-05

VPS / remote ‚Äî SSH servers from the desktop app, with a hard security boundary.

### Added

- **SSH connections** ‚Äî add VPS servers (key or password auth), connect/disconnect, and a
  live status indicator. Servers are stored locally; passwords/passphrases are encrypted with
  `safeStorage` and private keys are referenced by path (never copied).
- **Mandatory host-key verification** ‚Äî a first connection refuses to proceed until you confirm
  the presented `SHA256:` fingerprint; a changed key is always rejected as a possible MITM.
- **Live terminal** ‚Äî an xterm.js shell (write, output, resize) per connected server.
- **Remote file explorer** ‚Äî browse, read and edit files over SFTP.
- **Agent integration** ‚Äî a guarded `remote_shell` tool so the agent can run commands on a
  connected VPS.
- **Security guards** (all enforced in the main process):
  - command deny list (`rm -rf /`, `mkfs*`, `dd of=/dev/*`, fork bombs, `curl | bash`, ‚Ä¶);
  - 100 commands/minute rate limit;
  - JSON audit log of every connect/exec/blocked/rate-limited action;
  - 30-minute idle auto-disconnect;
  - a missing private key blocks the connection instead of warning.
- **VPS view** (Ctrl+6) with server list, tabs for Terminal / Files / Audit.

### Notes

- SSH is implemented with `ssh2` (added as a runtime dependency; it is the only one and is
  loaded lazily, so it is listed explicitly in `electron-builder.yml`).
- `keytar` was replaced with the existing `safeStorage` cipher to avoid a second native
  keystore dependency.

## [1.3.0] ‚Äî 2026-10-05

GitHub integration.

### Added

- **GitHub authentication** ‚Äî OAuth Device Flow (no backend or redirect URI needed): paste an
  OAuth App client id, authorise in the browser, and the access token is stored encrypted with
  `safeStorage`. The token never leaves the main process.
- **Repository operations** ‚Äî a GitHub view (Ctrl+5) shows the active project's git status
  (branch, ahead/behind, changed files) and can commit (stage all), pull (fast-forward) and
  push, plus clone. Built on the `git` CLI rather than a bundled library.
- **Pull requests and issues** ‚Äî list open PRs/issues from `api.github.com`, with links to
  GitHub; pick a repository from your account or type `owner/repo`.

### Notes

- Client ID can also come from `AI_DESKTOP_GITHUB_CLIENT_ID`. Requires a `git` binary on PATH.
- Implemented with `fetch` + the `git` CLI, so no runtime npm dependencies were added.

## [1.2.0] ‚Äî 2026-10-05

Preview and browsing.

### Added

- **Split (side-by-side) diff** ‚Äî the code viewer can compare the working draft with the file
  on disk side by side, pairing each changed line with its replacement. Reuses the existing
  LCS diff and tokenizer (no new highlighting dependency).
- **In-app Markdown preview** ‚Äî open `.md`/`.markdown`/`.mdx` files as a rendered document
  next to their source.
- **Internal browser** (Ctrl+4) ‚Äî a sandboxed `<webview>` with a URL bar, history chips and
  back/forward/reload. Navigation is restricted to `http(s)`; attached webviews never inherit a
  preload or Node access, and non-web navigation/popups are denied (`src/main/webview-policy.ts`,
  `src/shared/url.ts`).

## [1.1.0] ‚Äî 2026-10-05

UX and model improvements.

### Added

- **Model switcher in chat** ‚Äî a grouped provider/model dropdown in the chat header lets you
  choose the model for the next message (or a custom provider); the choice is sent with the
  run and the effective model is reported back on completion.
- **Central model catalog** (`src/shared/models.ts`) ‚Äî every provider's models, tags
  (`cheap`/`fast`/`powerful`) and defaults in one place; `PROVIDERS` is derived from it, and
  both the chat dropdown and Settings selects read from it.
- **Custom providers** ‚Äî add any OpenAI-compatible endpoint (base URL + model + optional
  headers). API keys are encrypted with Electron `safeStorage` and never written in plaintext
  or exposed to the renderer. Includes a live ‚ÄúTest connection‚Äù and an ‚ÄúOther‚Äù group in the
  model picker; built-in providers remain as fallback.
- **First-run onboarding** ‚Äî a four-step wizard (welcome + use-case model suggestion, connect a
  provider, add a first project, summary) that suggests a model from the catalog and can be
  skipped. Completion is persisted under the app data directory.

### Changed

- Settings' built-in provider select and the chat model picker now share the central catalog.
- `AgentService.buildProviders()` accepts a per-run model override and a selected custom
  provider (tried first, built-ins as fallback).

## [1.0.0] ‚Äî 2026-10-07

First stable release. Ships as a Windows x64 NSIS installer and a portable executable.

### Added

- **LLM layer (Stage 2)** ‚Äî provider-agnostic adapters for OpenAI, Anthropic, DeepSeek and
  Google Gemini behind a single `BaseLLMAdapter` interface (`chat`, `streamChat`,
  `getCapabilities`, `validateConfig`). Shared HTTP plumbing with timeouts, retry/backoff,
  SSE parsing and typed errors (`AuthError`, `RateLimitError`, `TimeoutError`, `NetworkError`,
  `APIError`).
- **Sandbox / code execution (Stage 3)** ‚Äî `SandboxManagerImpl` with lifecycle, concurrency
  limits and TTL/idle sweeps. Docker provider (hardened: resource limits, `--network none`,
  read-only rootfs) with local and Windows fallbacks. Path containment rejects workspace
  escapes; output is capped.
- **Agent orchestrator (Stage 4)** ‚Äî `AgentOrchestrator` running the Planning ‚Üí Execution ‚Üí
  Observation ‚Üí Reflection loop, with sandbox tools (`read_file`, `write_file`, `list_dir`,
  `run_command`), loop detection (>3 repeats, no-progress pause) and failure recovery
  (bounded retries for transient sandbox errors, provider fallback on auth/config errors).
- **Context & state (Stage 5)** ‚Äî token estimation with automatic history compaction at 80%
  of the budget, a context compressor (comment/blank-line stripping, code-block dedupe),
  on-disk JSON `SessionStore` with schema migration and resume, and a `Persistence` layer
  that encrypts API keys via Electron `safeStorage` and resolves the AppData path.
- **Renderer UI (Stage 6/7)** ‚Äî chat panel with Markdown rendering and streaming, tasks/logs
  panel, workspace file explorer, code viewer with syntax highlighting and diffs, settings,
  status bar, dark theme with Vazirmatn (RTL chat content), drag & drop and keyboard
  shortcuts. Zustand state wired to main-process events over IPC.
- **Background work & remote access** ‚Äî worker queue and a localhost remote-access server,
  all exposed through a typed, `contextIsolation`-based preload bridge.
- **Integration testing (Stage 8)** ‚Äî `test/e2e/` covers project create/run in the real local
  sandbox, file change ‚Üí renderer diff, session save/resume, and failure handling (API cut
  with bounded retries, provider fallback, unavailable sandbox, transient sandbox retry,
  path-escape rejection, context overflow with deterministic compaction fallback), plus
  performance/leak guards.

### Fixed

- Destroying a sandbox no longer deletes a caller-supplied workspace (e.g. the active
  project directory); only auto-created workspaces are removed.

### Packaging

- **electron-builder** configured for Windows x64: NSIS installer (`oneClick: false`,
  selectable install directory, desktop + start-menu shortcuts) and a Portable build.
- Application icon (`build/icon.png`, `build/icon.ico`) and product metadata.
- Optimized production build: esbuild minification and tree-shaking for main, preload and
  renderer; source maps disabled. Renderer bundle reduced from ~620 KB to ~321 KB.
- All runtime dependencies are bundled by Vite; `dependencies` is empty, so no
  `node_modules` are shipped inside the app package.
- Optional code signing via `CSC_LINK` / `CSC_KEY_PASSWORD` (skipped safely when absent).

[Unreleased]: https://github.com/Arashtahmasbi3/ai-desktop/compare/v4.1.0...HEAD
[4.3.0]: https://github.com/Arashtahmasbi3/ai-desktop/compare/v4.2.0...v4.3.0
[4.2.0]: https://github.com/Arashtahmasbi3/ai-desktop/compare/v4.1.0...v4.2.0
[4.1.0]: https://github.com/Arashtahmasbi3/ai-desktop/compare/v4.0.1...v4.1.0
[4.0.1]: https://github.com/Arashtahmasbi3/ai-desktop/compare/v4.0.0...v4.0.1
[4.0.0]: https://github.com/Arashtahmasbi3/ai-desktop/compare/v3.2.1...v4.0.0
[3.2.1]: https://github.com/Arashtahmasbi3/ai-desktop/compare/v3.2.0...v3.2.1
[3.2.0]: https://github.com/Arashtahmasbi3/ai-desktop/compare/v3.1.1...v3.2.0
[3.1.1]: https://github.com/Arashtahmasbi3/ai-desktop/compare/v3.1.0...v3.1.1
[3.1.0]: https://github.com/Arashtahmasbi3/ai-desktop/compare/v3.0.0...v3.1.0
[3.0.0]: https://github.com/Arashtahmasbi3/ai-desktop/compare/v2.9.2...v3.0.0
[2.9.2]: https://github.com/Arashtahmasbi3/ai-desktop/compare/v2.9.1...v2.9.2
[2.9.1]: https://github.com/Arashtahmasbi3/ai-desktop/compare/v2.9.0...v2.9.1
[2.9.0]: https://github.com/Arashtahmasbi3/ai-desktop/compare/v2.8.0...v2.9.0
[2.8.0]: https://github.com/Arashtahmasbi3/ai-desktop/compare/v2.7.0...v2.8.0
[2.7.0]: https://github.com/Arashtahmasbi3/ai-desktop/compare/v2.6.4...v2.7.0
[2.6.4]: https://github.com/Arashtahmasbi3/ai-desktop/compare/v2.6.3...v2.6.4
[2.6.3]: https://github.com/Arashtahmasbi3/ai-desktop/compare/v2.6.2...v2.6.3
[2.6.2]: https://github.com/Arashtahmasbi3/ai-desktop/compare/v2.6.1...v2.6.2
[2.6.1]: https://github.com/Arashtahmasbi3/ai-desktop/compare/v2.6.0...v2.6.1
[2.3.2]: https://github.com/Arashtahmasbi3/ai-desktop/compare/v2.3.1...v2.3.2
[1.0.0]: https://github.com/Arashtahmasbi3/ai-desktop/releases/tag/v1.0.0
